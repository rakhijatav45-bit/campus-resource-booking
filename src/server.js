import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const server = createApp({ config, db });

if (config.usingDefaultSecret) {
  console.warn('JWT_SECRET is not set, using an insecure development secret.');
}

server.listen(config.port, () => {
  console.log(`CampusBook is running at http://localhost:${config.port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
