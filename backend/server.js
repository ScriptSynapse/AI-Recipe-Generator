/**
 * server.js
 * ---------------------------------------------------------------------
 * Express application entry point. Wires up middleware, static frontend
 * serving, the /api/recipes router, and a top-level /api/health route.
 *
 * Architecture recap:
 *   Browser --> Express (this file) --> routes/recipes.js
 *            --> controllers/recipeController.js
 *            --> services/cppBridge.js --spawns--> cpp-core/recipe_engine
 */

require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

const recipeRoutes = require('./routes/recipes');
const { runEngine } = require('./services/cppBridge');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Serve the static frontend (HTML/CSS/JS) directly from Express so the
// whole app can be demoed from a single `npm start`.
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// REST API
app.use('/api/recipes', recipeRoutes);

// Top-level health check, proxies straight through to the C++ core so a
// single request confirms the entire pipeline (Node -> C++ -> data dir)
// is wired up correctly.
app.get('/api/health', async (req, res) => {
  try {
    const result = await runEngine('health', {});
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'ENGINE_UNAVAILABLE', message: err.message },
    });
  }
});

// Consistent JSON 404 for unknown API routes (frontend routes fall
// through to static files / index.html instead).
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `No API route: ${req.method} ${req.originalUrl}` },
  });
});

// Central error handler as a safety net for anything that throws
// synchronously inside a route handler.
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
  });
});

app.listen(PORT, () => {
  console.log(`AI Recipe Generator backend running at http://localhost:${PORT}`);
  console.log(`Frontend served from /frontend, API mounted at /api/recipes`);
});
