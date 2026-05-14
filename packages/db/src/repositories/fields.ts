import oracledb from 'oracledb';
import { withConnection } from '../pool.js';
import type {
  InvoiceFields,
  ContractFields,
  CvFields,
} from '@idp/schemas';

async function upsertFields(documentId: string, payload: object): Promise<void> {
  await withConnection(async (conn) => {
    await conn.execute(
      `MERGE INTO document_fields f
       USING (SELECT HEXTORAW(:id) AS doc_id FROM dual) src
       ON (f.document_id = src.doc_id)
       WHEN MATCHED THEN UPDATE SET payload = :payload
       WHEN NOT MATCHED THEN INSERT (document_id, payload)
         VALUES (src.doc_id, :payload)`,
      { id: documentId, payload: JSON.stringify(payload) },
    );
  });
}

interface DualityFieldsRow {
  ID: Buffer;
  DOC_TYPE: string;
  PAYLOAD: string;
}

async function fetchFieldsView(view: string, documentId: string): Promise<object | null> {
  return withConnection(async (conn) => {
    const result = await conn.execute<DualityFieldsRow>(
      `SELECT JSON_SERIALIZE(${view}.DATA RETURNING VARCHAR2 PRETTY) AS PAYLOAD
       FROM ${view}
       WHERE JSON_VALUE(${view}.DATA, '$._id') = :id`,
      { id: documentId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = result.rows?.[0];
    if (!row) return null;
    return JSON.parse(row.PAYLOAD);
  });
}

export const FieldsRepo = {
  upsertInvoice(id: string, fields: InvoiceFields): Promise<void> {
    return upsertFields(id, fields);
  },
  upsertContract(id: string, fields: ContractFields): Promise<void> {
    return upsertFields(id, fields);
  },
  upsertCv(id: string, fields: CvFields): Promise<void> {
    return upsertFields(id, fields);
  },

  getInvoice(id: string): Promise<object | null> {
    return fetchFieldsView('invoice_dv', id);
  },
  getContract(id: string): Promise<object | null> {
    return fetchFieldsView('contract_dv', id);
  },
  getCv(id: string): Promise<object | null> {
    return fetchFieldsView('cv_dv', id);
  },
};
