// Boots a REAL PostgreSQL (embedded binaries, no Docker) for the e2e suite,
// applies the actual migrations (including RLS policies and the append-only
// trigger), and points the app at it via env. Tests exercise the same
// database engine and security model as production.
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { initCluster, startCluster, stopCluster, createDatabaseIfMissing } = require('../scripts/pg.cjs');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, '.pgdata-test');
const PORT = 5434;
const DB = 'meridian_test';

module.exports = async function globalSetup() {
  // Fresh cluster every run: stop a leftover instance, wipe, re-init.
  try {
    stopCluster(DATA_DIR);
  } catch {
    /* not running */
  }
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  initCluster(DATA_DIR);
  startCluster(DATA_DIR, PORT);
  await createDatabaseIfMissing(PORT, DB);

  const systemUrl = `postgresql://postgres:postgres@localhost:${PORT}/${DB}`;
  execFileSync(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'],
    { cwd: ROOT, env: { ...process.env, DATABASE_URL: systemUrl }, stdio: 'inherit' },
  );

  // Test workers inherit these; they take precedence over .env values.
  process.env.DATABASE_URL = `${systemUrl}?connection_limit=5`;
  process.env.APP_DATABASE_URL = `postgresql://meridian_app:app_password@localhost:${PORT}/${DB}?connection_limit=5`;
  process.env.JWT_SECRET = 'e2e-test-secret';
};
