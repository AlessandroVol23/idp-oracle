import 'dotenv/config';
import oracledb from 'oracledb';

async function main() {
  const conn = await oracledb.getConnection({
    user: 'ADMIN',
    password: process.env.ORACLE_ADMIN_PASSWORD ?? process.env.ORACLE_PASSWORD!,
    connectString: process.env.ORACLE_CONNECT_STRING!,
    ...(process.env.ORACLE_WALLET_LOCATION
      ? { walletLocation: process.env.ORACLE_WALLET_LOCATION }
      : {}),
    ...(process.env.ORACLE_WALLET_PASSWORD
      ? { walletPassword: process.env.ORACLE_WALLET_PASSWORD }
      : {}),
  });
  try {
    const r = await conn.execute<{ V: string }>(
      `SELECT BANNER_FULL AS V FROM v$version FETCH FIRST 1 ROWS ONLY`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    console.log('Connected. Version:', r.rows?.[0]?.V);
  } finally {
    await conn.close();
  }
}

main().catch((err) => {
  console.error('ping failed:', err.message ?? err);
  process.exit(1);
});
