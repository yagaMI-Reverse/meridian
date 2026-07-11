// Thin manager around the real PostgreSQL binaries shipped by
// @embedded-postgres/windows-x64 — no Docker required.
//
// We drive pg_ctl directly instead of the embedded-postgres JS API because
// postgres.exe refuses to run under an elevated (administrator) token, while
// pg_ctl/initdb re-launch themselves with a restricted token and work fine.
// Bonus: pg_ctl-started clusters survive the launching process, so dev
// up/down are plain one-shot commands.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const NATIVE_BIN = path.join(
  __dirname,
  '..',
  'node_modules',
  '@embedded-postgres',
  process.platform === 'win32' ? 'windows-x64' : `${process.platform}-x64`,
  'native',
  'bin',
);
const EXE = process.platform === 'win32' ? '.exe' : '';
const PG_CTL = path.join(NATIVE_BIN, `pg_ctl${EXE}`);
const INITDB = path.join(NATIVE_BIN, `initdb${EXE}`);

function initCluster(dataDir, { user = 'postgres', password = 'postgres' } = {}) {
  if (fs.existsSync(path.join(dataDir, 'PG_VERSION'))) return false;
  const pwFile = path.join(os.tmpdir(), `meridian-pg-pw-${process.pid}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(pwFile, `${password}\n`);
  try {
    execFileSync(
      INITDB,
      [
        `--pgdata=${dataDir}`,
        '--auth=password',
        `--username=${user}`,
        `--pwfile=${pwFile}`,
        '--encoding=UTF8',
        '--lc-messages=C',
      ],
      { stdio: 'pipe' },
    );
  } finally {
    fs.rmSync(pwFile, { force: true });
  }
  return true;
}

function isRunning(dataDir) {
  try {
    execFileSync(PG_CTL, ['status', '-D', dataDir], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function startCluster(dataDir, port) {
  if (isRunning(dataDir)) return false;
  // stdio MUST be 'ignore' here: the postgres daemon inherits pg_ctl's stdio
  // handles on Windows, and with 'pipe' execFileSync waits for the pipes to
  // close — i.e. forever. Errors land in server.log instead.
  execFileSync(
    PG_CTL,
    ['start', '-D', dataDir, '-w', '-t', '60', '-l', path.join(dataDir, 'server.log'), '-o', `-p ${port}`],
    { stdio: 'ignore' },
  );
  return true;
}

function stopCluster(dataDir) {
  if (!isRunning(dataDir)) return false;
  execFileSync(PG_CTL, ['stop', '-D', dataDir, '-m', 'fast', '-w', '-t', '60'], { stdio: 'pipe' });
  return true;
}

async function createDatabaseIfMissing(port, name, { user = 'postgres', password = 'postgres' } = {}) {
  const { Client } = require('pg');
  const client = new Client({ host: 'localhost', port, user, password, database: 'postgres' });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rows.length === 0) {
      await client.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
      return true;
    }
    return false;
  } finally {
    await client.end();
  }
}

module.exports = { initCluster, startCluster, stopCluster, isRunning, createDatabaseIfMissing };
