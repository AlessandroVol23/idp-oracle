import oracledb from 'oracledb';
import { Readable } from 'node:stream';
import { withConnection } from '../pool.js';
import { EMBEDDING_MODEL_NAME } from '@idp/shared';
import type { DocStatus, DocType } from '@idp/shared';

export interface DocumentRow {
  id: string;
  docType: DocType;
  status: DocStatus;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  pageCount: number | null;
  language: string | null;
  failedReason: string | null;
  createdAt: string;
  updatedAt: string;
  extractedText: string | null;
}

export interface DocumentListItem {
  id: string;
  docType: DocType;
  status: DocStatus;
  originalFilename: string;
  byteSize: number;
  createdAt: string;
}

export interface SimilarDocument {
  id: string;
  docType: DocType;
  originalFilename: string;
  distance: number;
}

function uuidHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function rowToDocument(row: Record<string, unknown>): DocumentRow {
  return {
    id: (row.ID as Buffer).toString('hex').toUpperCase(),
    docType: row.DOC_TYPE as DocType,
    status: row.STATUS as DocStatus,
    originalFilename: row.ORIGINAL_FILENAME as string,
    mimeType: row.MIME_TYPE as string,
    byteSize: Number(row.BYTE_SIZE),
    pageCount: row.PAGE_COUNT == null ? null : Number(row.PAGE_COUNT),
    language: (row.LANGUAGE as string | null) ?? null,
    failedReason: (row.FAILED_REASON as string | null) ?? null,
    createdAt: (row.CREATED_AT as Date).toISOString(),
    updatedAt: (row.UPDATED_AT as Date).toISOString(),
    extractedText: (row.EXTRACTED_TEXT as string | null) ?? null,
  };
}

export const DocumentsRepo = {
  async insert(input: {
    originalFilename: string;
    mimeType: string;
    bytes: Buffer;
  }): Promise<string> {
    const id = uuidHex();
    await withConnection(async (conn) => {
      await conn.execute(
        `INSERT INTO documents (id, original_filename, mime_type, byte_size, file_blob)
         VALUES (HEXTORAW(:id), :filename, :mimeType, :byteSize, :blob)`,
        {
          id,
          filename: input.originalFilename,
          mimeType: input.mimeType,
          byteSize: input.bytes.length,
          blob: input.bytes,
        },
      );
    });
    return id;
  },

  async findById(id: string): Promise<DocumentRow | null> {
    return withConnection(async (conn) => {
      const result = await conn.execute<Record<string, unknown>>(
        `SELECT id, doc_type, status, original_filename, mime_type, byte_size,
                page_count, language, failed_reason, created_at, updated_at,
                extracted_text
         FROM documents
         WHERE id = HEXTORAW(:id)`,
        { id },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const row = result.rows?.[0];
      return row ? rowToDocument(row) : null;
    });
  },

  async list(filters: {
    docType?: DocType;
    status?: DocStatus;
    limit?: number;
    offset?: number;
  }): Promise<DocumentListItem[]> {
    const limit = filters.limit ?? 25;
    const offset = filters.offset ?? 0;
    return withConnection(async (conn) => {
      const result = await conn.execute<Record<string, unknown>>(
        `SELECT id, doc_type, status, original_filename, byte_size, created_at
         FROM documents
         WHERE (:docType IS NULL OR doc_type = :docType)
           AND (:statusFilter IS NULL OR status = :statusFilter)
         ORDER BY created_at DESC
         OFFSET :offset ROWS FETCH NEXT :lim ROWS ONLY`,
        {
          docType: filters.docType ?? null,
          statusFilter: filters.status ?? null,
          offset,
          lim: limit,
        },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return (result.rows ?? []).map((row) => ({
        id: (row.ID as Buffer).toString('hex').toUpperCase(),
        docType: row.DOC_TYPE as DocType,
        status: row.STATUS as DocStatus,
        originalFilename: row.ORIGINAL_FILENAME as string,
        byteSize: Number(row.BYTE_SIZE),
        createdAt: (row.CREATED_AT as Date).toISOString(),
      }));
    });
  },

  async updateStatus(
    id: string,
    status: DocStatus,
    failedReason?: string,
  ): Promise<void> {
    await withConnection(async (conn) => {
      await conn.execute(
        `UPDATE documents
         SET status = :status, failed_reason = :failedReason
         WHERE id = HEXTORAW(:id)`,
        { id, status, failedReason: failedReason ?? null },
      );
    });
  },

  async updateDocType(id: string, docType: DocType): Promise<void> {
    await withConnection(async (conn) => {
      await conn.execute(
        `UPDATE documents SET doc_type = :docType WHERE id = HEXTORAW(:id)`,
        { id, docType },
      );
    });
  },

  async extractText(id: string): Promise<string> {
    return withConnection(async (conn) => {
      await conn.execute(
        `UPDATE documents
         SET extracted_text = DBMS_VECTOR_CHAIN.UTL_TO_TEXT(file_blob)
         WHERE id = HEXTORAW(:id)`,
        { id },
      );
      const result = await conn.execute<{ EXTRACTED_TEXT: string | null }>(
        `SELECT extracted_text FROM documents WHERE id = HEXTORAW(:id)`,
        { id },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return result.rows?.[0]?.EXTRACTED_TEXT ?? '';
    });
  },

  async setEmbedding(id: string): Promise<void> {
    await withConnection(async (conn) => {
      await conn.execute(
        `UPDATE documents
         SET embedding = VECTOR_EMBEDDING(${EMBEDDING_MODEL_NAME} USING extracted_text AS data)
         WHERE id = HEXTORAW(:id)`,
        { id },
      );
    });
  },

  async streamBlob(id: string): Promise<{
    stream: Readable;
    mimeType: string;
    filename: string;
    byteSize: number;
  } | null> {
    return withConnection(async (c) => {
      const result = await c.execute<{
        FILE_BLOB: oracledb.Lob;
        MIME_TYPE: string;
        ORIGINAL_FILENAME: string;
        BYTE_SIZE: number;
      }>(
        `SELECT file_blob, mime_type, original_filename, byte_size
         FROM documents WHERE id = HEXTORAW(:id)`,
        { id },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const row = result.rows?.[0];
      if (!row) return null;
      const lob = row.FILE_BLOB;
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        lob.on('data', (chunk: Buffer) => chunks.push(chunk));
        lob.on('end', resolve);
        lob.on('error', reject);
      });
      return {
        stream: Readable.from(Buffer.concat(chunks)),
        mimeType: row.MIME_TYPE,
        filename: row.ORIGINAL_FILENAME,
        byteSize: Number(row.BYTE_SIZE),
      };
    });
  },

  async findSimilar(id: string, k: number): Promise<SimilarDocument[]> {
    return withConnection(async (conn) => {
      const result = await conn.execute<Record<string, unknown>>(
        `SELECT id, doc_type, original_filename,
                VECTOR_DISTANCE(embedding, src.embedding, COSINE) AS distance
         FROM documents,
              (SELECT embedding FROM documents WHERE id = HEXTORAW(:id)) src
         WHERE documents.id != HEXTORAW(:id)
           AND embedding IS NOT NULL
         ORDER BY distance
         FETCH FIRST :k ROWS ONLY`,
        { id, k },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return (result.rows ?? []).map((row) => ({
        id: (row.ID as Buffer).toString('hex').toUpperCase(),
        docType: row.DOC_TYPE as DocType,
        originalFilename: row.ORIGINAL_FILENAME as string,
        distance: Number(row.DISTANCE),
      }));
    });
  },
};
