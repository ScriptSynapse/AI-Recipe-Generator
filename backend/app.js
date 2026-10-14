/**
 * app.js -- builds the Express application WITHOUT starting a server, so
 * tests can run the real app on an ephemeral port. server.js is the thin
 * entry point that calls createApp() and listens.
 *
 * Architecture recap:
 *   Browser --> Express --> security headers --> requestId --> CORS --> authenticate (who?)
 *            --> rate limit (per tier)
 *            --> routes/auth.js        --> AuthService
 *            --> requirePermission (RBAC, per route)
 *            --> routes/recipes.js     --> controllers/recipeController.js
 *            --> routes/ai.js          --> controllers/aiController.js (AI Model Lab)
 *            --> routes/admin.js       --> (admin-only endpoints)
 *            --> services/cppBridge.js --spawns--> cpp-core/recipe_engine
 */
const path = require('path');
const express = require('express');
const cors = require('cors');

const { loadConfig } = require('./config');
const { RateLimiter } = require('./ratelimit/RateLimiter');
const { LoginThrottle } = require('./ratelimit/LoginThrottle');
const { AuditGate } = require('./ratelimit/AuditGate');
const { buildPolicies } = require('./ratelimit/policies');
const { createRateLimit } = require('./middleware/rateLimit');
const { createSecurityHeaders } = require('./middleware/securityHeaders');
const { createRequestLogger } = require('./middleware/requestLogger');

const { createRecipeRouter } = require('./routes/recipes');
const { createAdminRouter } = require('./routes/admin');
const { UsageStore, recordUsage, fromRecipeResponse, fromComparisonResponse } = require('./usage/UsageStore');
const { createUsageRouter } = require('./routes/usage');
const { createSecurityRouter } = require('./routes/security');
const { createSecurityController } = require('./controllers/securityController');
const { createRecipeController } = require('./controllers/recipeController');
const { createAuditController } = require('./controllers/auditController');
const { createAiController } = require('./controllers/aiController');
const { createAiRouter } = require('./routes/ai');
const { ModelAnalyticsStore } = require('./ai/ModelAnalyticsStore');
const requestId = require('./middleware/requestId');
const { SecurityAuditLog } = require('./audit/SecurityAuditLog');
const { attachAuditLogger } = require('./audit/auditLogger');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { createAuthModule } = require('./authentication');
const { AuthorizationService } = require('./authorization/authorizationService');
const { createRequirePermission } = require('./middleware/authorize');
const { runEngine: defaultRunEngine } = require('./services/cppBridge');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data');

/**
 * @param {object}   [options]
 * @param {string}   [options.dataDir]   where users.json / sessions.json live
 * @param {object}   [options.auth]      overrides for createAuthModule (tests)
 * @param {object}   [options.audit]     overrides for SecurityAuditLog, e.g. maxBytes (tests)
 * @param {Function} [options.runEngine] (command, payload) => Promise<response>;
 *                                       defaults to the real C++ bridge, tests inject a fake
 * @param {object}   [options.env]       environment for loadConfig (tests); default process.env
 * @param {Function} [options.now]       clock for rate limiting (tests)
 * @param {Function} [options.logSink]   receives one JSON access-log line per API request;
 *                                       omit for no access log
 */
function createApp({
  dataDir = DEFAULT_DATA_DIR, auth = {}, runEngine = defaultRunEngine, audit = {},
  env = process.env, now = () => Date.now(), logSink = null,
} = {}) {
  const config = loadConfig(env);
  const app = express();
  app.disable('x-powered-by');
  app.locals.config = config;
  // Only trust X-Forwarded-For when told how many proxies sit in front;
  // otherwise req.ip is the TCP peer and clients can't choose their bucket.
  app.set('trust proxy', config.trustProxyHops);

  app.use(createSecurityHeaders({ hsts: config.hsts }));

  // First, so that everything after it -- including every audit event --
  // can be tied to one request.
  app.use(requestId);

  // Rate limiting. One limiter, shared by every endpoint class; the bus is
  // created by the auth module, so build the limiter pieces first and give
  // the auth module only what it needs.
  const limiter = new RateLimiter({ now });
  const policies = buildPolicies(config.rateLimits);
  const events = auth.events || new (require('events').EventEmitter)();
  const rateLimit = createRateLimit({ limiter, policies, events, now });
  const loginThrottle = new LoginThrottle({
    maxPerAccountIp: config.rateLimits.loginMaxFailuresPerAccountIp,
    maxPerIp: config.rateLimits.loginMaxFailuresPerIp,
    windowMs: config.rateLimits.loginWindowMinutes * 60 * 1000,
    now,
  });
  app.locals.limiter = limiter;

  const authModule = createAuthModule({
    dataDir, events, loginThrottle, auditGate: new AuditGate({ now }),
    authLimit: rateLimit('auth', { byIpOnly: true }), ...auth,
  });
  app.locals.auth = authModule;

  // Audit trail (Observer pattern): producers publish events on one shared
  // bus; the AuditLogger subscribes and writes them to a bounded,
  // secret-scrubbed log file.
  app.locals.events = authModule.events;
  const auditLog = new SecurityAuditLog({ filePath: path.join(dataDir, 'security-audit.jsonl'), ...audit });
  attachAuditLogger({ events: authModule.events, auditLog });
  app.locals.auditLog = auditLog;

  // Authorization (RBAC). Shares the auth module's event bus, so denials
  // reach the same audit-log subscribers (Phase M) as login failures.
  const authorizationService = new AuthorizationService();
  const requirePermission = createRequirePermission({ authorizationService, events: authModule.events });
  app.locals.authorization = authorizationService;

  const recipeController = createRecipeController({ runEngine });

  // CORS is closed by default: with no CORS_ORIGINS configured, no CORS
  // headers are sent and browsers keep the API same-origin. Listed origins
  // are matched exactly (never reflected, never "*"), because requests carry
  // a session cookie.
  const allowed = new Set(config.corsOrigins);
  app.use(cors({
    origin: (origin, cb) => cb(null, Boolean(origin) && allowed.has(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }));
  app.use(express.json({ limit: config.jsonBodyLimit }));

  // The landing page is the front door; the dashboard is index.html. Declared
  // before the static handler so "/" does not fall through to the dashboard.
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'landing.html')));

  // Serve the static frontend (HTML/CSS/JS) directly from Express so the
  // whole app can be demoed from a single `npm start`.
  app.use(express.static(path.join(__dirname, '..', 'frontend')));

  // Identify the caller for every API request. Never rejects by itself.
  app.use('/api', authModule.authenticate);
  if (logSink) app.use('/api', createRequestLogger({ sink: logSink }));

  // General per-caller limit for every API route (after authenticate, so
  // the tier -- anonymous / user / admin -- is known).
  app.use('/api', rateLimit('api'));

  // REST API
  const usageStore = new UsageStore({ filePath: path.join(dataDir, 'usage.json'), now });
  app.use('/api/auth', authModule.router);
  app.use('/api/recipes', createRecipeRouter({ controller: recipeController, requirePermission, generateLimit: rateLimit('generate'),
    recordGenerated: recordUsage(usageStore, fromRecipeResponse),
  }));
  const aiController = createAiController({
    runEngine, analytics: new ModelAnalyticsStore({ filePath: path.join(dataDir, 'model-analytics.json') }),
  });
  app.use('/api/ai', createAiRouter({ controller: aiController, requirePermission, compareLimit: rateLimit('compare'),
    recordCompared: recordUsage(usageStore, fromComparisonResponse),
  }));
  app.use('/api/usage', createUsageRouter({ usageStore, requirePermission }));
  app.use('/api/admin', createAdminRouter({
    controller: recipeController, auditController: createAuditController({ auditLog }), aiController, requirePermission,
    benchmarkLimit: rateLimit('benchmark'),
  }));

  app.use('/api/security', createSecurityRouter({
    controller: createSecurityController({ auditLog, now }),
    auditController: createAuditController({ auditLog }),
    requirePermission,
  }));

  // Public liveness check: runs through the C++ core, so one request
  // confirms the whole pipeline (Node -> C++ -> data dir) is wired up, but
  // reports only "ok". The detailed report is admin-only: /api/admin/health.
  app.get('/api/health', recipeController.healthCheck);

  // Consistent JSON 404 for unknown API routes (does not echo the URL).
  app.use('/api', notFoundHandler);

  // Central error handler: client-safe messages only; detail is logged.
  app.use(errorHandler);

  return app;
}

module.exports = { createApp, DEFAULT_DATA_DIR };
