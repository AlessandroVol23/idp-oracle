import 'dotenv/config';
import oracledb from 'oracledb';

const expected = {
  TABLE: ['DOCUMENTS', 'DOCUMENT_FIELDS'],
  INDEX: ['DOCUMENTS_LIST_IDX', 'DOCUMENTS_EMBEDDING_IDX', 'DOCUMENTS_TEXT_IDX'],
  VIEW: ['INVOICE_DV', 'CONTRACT_DV', 'CV_DV', 'DOCUMENT_DV'],
  TRIGGER: ['DOCUMENTS_UPDATED_AT_TRG', 'DOCUMENT_FIELDS_UPDATED_AT_TRG'],
};

async function main() {
  const conn = await oracledb.getConnection({
    user: process.env.ORACLE_USER!,
    password: process.env.ORACLE_PASSWORD!,
    connectString: process.env.ORACLE_CONNECT_STRING!,
    walletLocation: process.env.ORACLE_WALLET_LOCATION,
    walletPassword: process.env.ORACLE_WALLET_PASSWORD,
  });
  try {
    const r = await conn.execute<{ OBJECT_NAME: string; OBJECT_TYPE: string }>(
      `SELECT object_name, object_type FROM user_objects ORDER BY object_type, object_name`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const byType: Record<string, string[]> = {};
    for (const row of r.rows ?? []) {
      (byType[row.OBJECT_TYPE] ??= []).push(row.OBJECT_NAME);
    }
    console.log('Objects in idp schema:');
    for (const [type, names] of Object.entries(byType)) {
      console.log(`  ${type}: ${names.join(', ')}`);
    }
    console.log('\nExpected vs actual:');
    let ok = true;
    for (const [type, names] of Object.entries(expected)) {
      const found = new Set(byType[type] ?? []);
      for (const n of names) {
        const present = found.has(n);
        if (!present) ok = false;
        console.log(`  ${present ? 'OK' : 'MISSING'}  ${type} ${n}`);
      }
    }
    if (!ok) process.exitCode = 1;
  } finally {
    await conn.close();
  }
}

main().catch((err) => {
  console.error('verify failed:', err.message ?? err);
  process.exit(1);
});
