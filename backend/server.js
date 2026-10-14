/**
 * server.js
 * ---------------------------------------------------------------------
 * Entry point: loads configuration, builds the app (see app.js) and
 * starts listening.
 */

require('dotenv').config();

const { createApp } = require('./app');

const { loadConfig } = require('./config');

const config = loadConfig();
const PORT = config.port;
const app = createApp({ logSink: (line) => console.log(line) });

const server = app.listen(PORT, () => {
  console.log(`AI Recipe Generator backend running at http://localhost:${PORT}`);
  console.log('Frontend served from /frontend, API mounted at /api (auth: /api/auth, recipes: /api/recipes)');
});

// Bound how long a connection can hold server resources (slow-loris style
// clients): time to send headers, time to send a whole request, keep-alive.
server.headersTimeout = config.timeouts.headersMs;
server.requestTimeout = config.timeouts.requestMs;
server.keepAliveTimeout = config.timeouts.keepAliveMs;
