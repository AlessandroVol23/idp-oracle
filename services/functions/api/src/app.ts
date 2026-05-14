import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { DocumentsRepo, FieldsRepo } from '@idp/db';
import { ingestDocument, initConfig } from '@idp/core';
import { logger } from '@idp/logger';
import { requestLogger, jsonError } from '@idp/hono';
import { MAX_UPLOAD_BYTES, type DocType, type DocStatus, DOC_TYPES, DOC_STATUSES } from '@idp/shared';

export function createApp() {
  const app = new Hono();

  app.use('*', cors());
  app.use('*', requestLogger());

  app.use('*', async (c, next) => {
    await initConfig();
    await next();
  });

  app.get('/health', (c) => c.json({ ok: true }));

  app.post('/documents', async (c) => {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) {
      return jsonError(c, 400, 'missing_file', 'multipart field "file" is required');
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return jsonError(
        c,
        413,
        'file_too_large',
        `File exceeds ${MAX_UPLOAD_BYTES} bytes`,
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const id = await DocumentsRepo.insert({
      originalFilename: file.name,
      mimeType: file.type || 'application/pdf',
      bytes: buffer,
    });
    logger.info('document received', { id, filename: file.name, bytes: buffer.length });

    await ingestDocument(id);
    const final = await DocumentsRepo.findById(id);
    return c.json(final, 201);
  });

  app.get('/documents', async (c) => {
    const docTypeParam = c.req.query('docType');
    const statusParam = c.req.query('status');
    const limit = Math.min(Number(c.req.query('limit') ?? 25), 100);
    const offset = Number(c.req.query('offset') ?? 0);

    if (docTypeParam && !DOC_TYPES.includes(docTypeParam as DocType)) {
      return jsonError(c, 400, 'invalid_doc_type', `unknown docType: ${docTypeParam}`);
    }
    if (statusParam && !DOC_STATUSES.includes(statusParam as DocStatus)) {
      return jsonError(c, 400, 'invalid_status', `unknown status: ${statusParam}`);
    }

    const items = await DocumentsRepo.list({
      docType: docTypeParam as DocType | undefined,
      status: statusParam as DocStatus | undefined,
      limit,
      offset,
    });
    return c.json({ items, limit, offset });
  });

  app.get('/documents/:id', async (c) => {
    const id = c.req.param('id');
    const doc = await DocumentsRepo.findById(id);
    if (!doc) return jsonError(c, 404, 'not_found', 'document not found');

    let fields: object | null = null;
    if (doc.docType === 'invoice') fields = await FieldsRepo.getInvoice(id);
    else if (doc.docType === 'contract') fields = await FieldsRepo.getContract(id);
    else if (doc.docType === 'cv') fields = await FieldsRepo.getCv(id);

    const { extractedText: _omit, ...rest } = doc;
    return c.json({ ...rest, fields });
  });

  app.get('/documents/:id/file', async (c) => {
    const id = c.req.param('id');
    const blob = await DocumentsRepo.streamBlob(id);
    if (!blob) return jsonError(c, 404, 'not_found', 'document not found');
    c.header('Content-Type', blob.mimeType);
    c.header('Content-Disposition', `inline; filename="${blob.filename}"`);
    c.header('Content-Length', String(blob.byteSize));
    const chunks: Buffer[] = [];
    for await (const chunk of blob.stream) {
      chunks.push(chunk as Buffer);
    }
    return c.body(Buffer.concat(chunks));
  });

  app.get('/documents/:id/similar', async (c) => {
    const id = c.req.param('id');
    const k = Math.min(Number(c.req.query('k') ?? 5), 20);
    const items = await DocumentsRepo.findSimilar(id, k);
    return c.json({ items });
  });

  app.onError((err, c) => {
    logger.error('unhandled error', { error: err.message, stack: err.stack });
    return jsonError(c, 500, 'internal_error', 'an internal error occurred');
  });

  return app;
}
