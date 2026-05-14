import 'dotenv/config';
import oracledb from 'oracledb';
import { EMBEDDING_MODEL_NAME } from '@idp/shared';

const MODEL_FILE = process.env.ONNX_MODEL_FILE ?? 'all_MiniLM_L6_v2.onnx';

async function main() {
  const required = ['ORACLE_CONNECT_STRING', 'ORACLE_USER', 'ORACLE_PASSWORD'];
  for (const name of required) {
    if (!process.env[name]) throw new Error(`${name} env var is required`);
  }

  const conn = await oracledb.getConnection({
    user: process.env.ORACLE_USER!,
    password: process.env.ORACLE_PASSWORD!,
    connectString: process.env.ORACLE_CONNECT_STRING!,
  });

  try {
    console.log(`Dropping any existing model "${EMBEDDING_MODEL_NAME}"…`);
    try {
      await conn.execute(
        `BEGIN DBMS_VECTOR.DROP_ONNX_MODEL(model_name => :name, force => TRUE); END;`,
        { name: EMBEDDING_MODEL_NAME },
      );
    } catch (err) {
      const code = (err as { errorNum?: number }).errorNum;
      if (code !== 40286) throw err;
    }

    console.log(`Loading "${MODEL_FILE}" from DATA_PUMP_DIR as model "${EMBEDDING_MODEL_NAME}"…`);
    await conn.execute(
      `BEGIN
         DBMS_VECTOR.LOAD_ONNX_MODEL(
           directory  => 'DATA_PUMP_DIR',
           file_name  => :file,
           model_name => :model
         );
       END;`,
      { file: MODEL_FILE, model: EMBEDDING_MODEL_NAME },
    );

    console.log('Verifying with a sample VECTOR_EMBEDDING call…');
    const r = await conn.execute<{ DIM: number }>(
      `SELECT VECTOR_DIMENSION(VECTOR_EMBEDDING(${EMBEDDING_MODEL_NAME} USING 'hello world' AS data)) AS DIM FROM DUAL`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    console.log(`OK. Embedding dimension = ${r.rows?.[0]?.DIM}`);
  } finally {
    await conn.close();
  }
}

main().catch((err) => {
  console.error('onnx upload failed:', err);
  process.exit(1);
});
