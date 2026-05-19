import 'dotenv/config';
import oracledb from 'oracledb';

const ONNX_URL =
  process.env.ONNX_MODEL_URL ??
  'https://adwc4pm.objectstorage.us-ashburn-1.oci.customer-oci.com/p/iPX9W0MZeRkwJKWdFmdJCemmN-iKAl_bFvNGYLW7YqIrw4kKsukL24J2q93Beb9S/n/adwc4pm/b/OML-ai-models/o/all_MiniLM_L12_v2.onnx';
const FILE_NAME = process.env.ONNX_MODEL_FILE ?? 'all_MiniLM_L12_v2.onnx';

async function main() {
  const conn = await oracledb.getConnection({
    user: 'ADMIN',
    password: process.env.ORACLE_ADMIN_PASSWORD ?? process.env.ORACLE_PASSWORD!,
    connectString: process.env.ORACLE_CONNECT_STRING!,
    walletLocation: process.env.ORACLE_WALLET_LOCATION,
    walletPassword: process.env.ORACLE_WALLET_PASSWORD,
  });
  conn.callTimeout = 300_000;
  try {
    console.log(`Fetching ${ONNX_URL}`);
    console.log(`  → DATA_PUMP_DIR/${FILE_NAME}`);
    await conn.execute(
      `BEGIN
         DBMS_CLOUD.GET_OBJECT(
           object_uri      => :url,
           directory_name  => 'DATA_PUMP_DIR',
           file_name       => :fname
         );
       END;`,
      { url: ONNX_URL, fname: FILE_NAME },
    );

    const r = await conn.execute<{ OBJECT_NAME: string; BYTES: number }>(
      `SELECT object_name, bytes FROM dbms_cloud.list_files('DATA_PUMP_DIR') WHERE object_name = :fname`,
      { fname: FILE_NAME },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = r.rows?.[0];
    if (!row) throw new Error(`File ${FILE_NAME} not visible in DATA_PUMP_DIR after upload`);
    console.log(`OK. ${row.OBJECT_NAME} = ${row.BYTES} bytes in DATA_PUMP_DIR`);
  } finally {
    await conn.close();
  }
}

main().catch((err) => {
  console.error('download-onnx failed:', err.message ?? err);
  process.exit(1);
});
