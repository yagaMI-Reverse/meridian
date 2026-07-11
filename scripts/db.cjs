// Local dev database CLI: `node scripts/db.cjs up|down|status`
const path = require('node:path');
const { initCluster, startCluster, stopCluster, isRunning, createDatabaseIfMissing } = require('./pg.cjs');

const DATA_DIR = path.resolve(__dirname, '..', '.pgdata');
const PORT = Number(process.env.PGPORT ?? 5433);
const DB_NAME = process.env.PGDATABASE ?? 'meridian';

async function main() {
  const cmd = process.argv[2] ?? 'up';
  if (cmd === 'up') {
    if (initCluster(DATA_DIR)) console.log(`[db] initialised cluster in ${DATA_DIR}`);
    if (startCluster(DATA_DIR, PORT)) console.log(`[db] started PostgreSQL on localhost:${PORT}`);
    else console.log(`[db] PostgreSQL already running on localhost:${PORT}`);
    if (await createDatabaseIfMissing(PORT, DB_NAME)) console.log(`[db] created database "${DB_NAME}"`);
    console.log(`[db] ready: postgresql://postgres:***@localhost:${PORT}/${DB_NAME}`);
  } else if (cmd === 'down') {
    console.log(stopCluster(DATA_DIR) ? '[db] stopped' : '[db] not running');
  } else if (cmd === 'status') {
    console.log(isRunning(DATA_DIR) ? '[db] running' : '[db] not running');
  } else {
    console.error(`Unknown command: ${cmd} (expected up|down|status)`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[db] failed:', err.stderr?.toString?.() ?? err);
  process.exit(1);
});
