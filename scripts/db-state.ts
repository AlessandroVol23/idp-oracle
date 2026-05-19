import 'dotenv/config';
import oracledb from 'oracledb';

async function main() {
  const conn = await oracledb.getConnection({
    user: process.env.ORACLE_USER!,
    password: process.env.ORACLE_PASSWORD!,
    connectString: process.env.ORACLE_CONNECT_STRING!,
    walletLocation: process.env.ORACLE_WALLET_LOCATION,
    walletPassword: process.env.ORACLE_WALLET_PASSWORD,
  });
  try {
    const r = await conn.execute<{ STATUS: string; DOC_TYPE: string; N: number }>(
      `SELECT status, doc_type, COUNT(*) AS n FROM documents GROUP BY status, doc_type ORDER BY status, doc_type`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    console.log('Documents by status/type:');
    for (const row of r.rows ?? []) {
      console.log(`  ${row.STATUS.padEnd(20)} ${row.DOC_TYPE.padEnd(12)} ${row.N}`);
    }
    const f = await conn.execute<{ N: number }>(`SELECT COUNT(*) AS n FROM document_fields`, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    console.log(`\ndocument_fields rows: ${f.rows?.[0]?.N}`);
    const e = await conn.execute<{ N: number }>(`SELECT COUNT(*) AS n FROM documents WHERE embedding IS NOT NULL`, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    console.log(`documents with embedding: ${e.rows?.[0]?.N}`);
  } finally {
    await conn.close();
  }
}

main().catch((err) => {
  console.error('failed:', err.message ?? err);
  process.exit(1);
});
