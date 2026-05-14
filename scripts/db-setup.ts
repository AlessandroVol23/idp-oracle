import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import oracledb from 'oracledb';

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
  'db',
  'migrations',
);

function splitStatements(sql: string): string[] {
  const lines = sql.split('\n');
  const out: string[] = [];
  let current = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '/') {
      if (current.trim()) {
        out.push(current.trim());
        current = '';
      }
      continue;
    }
    current += line + '\n';
    if (trimmed.endsWith(';') && !current.toUpperCase().includes('BEGIN')) {
      out.push(current.trim().replace(/;\s*$/, ''));
      current = '';
    }
  }
  if (current.trim()) out.push(current.trim().replace(/;\s*$/, ''));
  return out.filter((s) => s.length > 0 && !s.startsWith('--'));
}

async function runFile(conn: oracledb.Connection, path: string): Promise<void> {
  const sql = await readFile(path, 'utf-8');
  const statements = splitStatements(sql);
  console.log(`\n→ ${path} (${statements.length} statements)`);
  for (const stmt of statements) {
    try {
      await conn.execute(stmt);
      console.log(`  ✓ ${stmt.slice(0, 70).replace(/\s+/g, ' ')}…`);
    } catch (err) {
      const code = (err as { errorNum?: number }).errorNum;
      if (code === 955 || code === 1921 || code === 1418 || code === 29879) {
        console.log(`  · already exists (ORA-${code}), continuing`);
        continue;
      }
      throw err;
    }
  }
}

async function main() {
  const skipBootstrap = process.argv.includes('--skip-bootstrap');
  const required = ['ORACLE_CONNECT_STRING', 'ORACLE_USER', 'ORACLE_PASSWORD'];
  for (const name of required) {
    if (!process.env[name]) throw new Error(`${name} env var is required`);
  }

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => !skipBootstrap || !f.startsWith('000_'))
    .sort();

  const conn = await oracledb.getConnection({
    user: process.env.ORACLE_USER!,
    password: process.env.ORACLE_PASSWORD!,
    connectString: process.env.ORACLE_CONNECT_STRING!,
  });
  conn.callTimeout = 60_000;

  try {
    for (const f of files) {
      await runFile(conn, join(MIGRATIONS_DIR, f));
    }
    await conn.commit();
    console.log('\nAll migrations applied.');
  } finally {
    await conn.close();
  }
}

main().catch((err) => {
  console.error('db-setup failed:', err);
  process.exit(1);
});
