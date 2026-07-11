const path = require('node:path');
const fs = require('node:fs');
const { stopCluster } = require('../scripts/pg.cjs');

const DATA_DIR = path.resolve(__dirname, '..', '.pgdata-test');

module.exports = async function globalTeardown() {
  try {
    stopCluster(DATA_DIR);
  } finally {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
};
