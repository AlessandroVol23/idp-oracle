import { DocumentsRepo, FieldsRepo, classifyInDb, extractFieldsInDb } from '@idp/db';
import { logger } from '@idp/logger';
import { isExtractable } from '@idp/schemas';
import type { DocStatus } from '@idp/shared';

const MIN_TEXT_LENGTH = 50;

export async function ingestDocument(documentId: string): Promise<DocStatus> {
  const log = logger.child({ documentId });

  let doc = await DocumentsRepo.findById(documentId);
  if (!doc) throw new Error(`document ${documentId} not found`);

  try {
    if (doc.status === 'pending') {
      log.info('extracting text via UTL_TO_TEXT');
      const text = await DocumentsRepo.extractText(documentId);
      if (text.trim().length < MIN_TEXT_LENGTH) {
        await DocumentsRepo.updateStatus(documentId, 'failed', 'no_text_extracted');
        return 'failed';
      }
      try {
        log.info('summarizing via UTL_TO_SUMMARY');
        await DocumentsRepo.generateSummary(documentId);
      } catch (err) {
        log.warn('UTL_TO_SUMMARY failed, continuing without summary', {
          error: (err as Error).message,
        });
      }
      await DocumentsRepo.updateStatus(documentId, 'text_extracted');
      doc = (await DocumentsRepo.findById(documentId))!;
    }

    if (doc.status === 'text_extracted') {
      log.info('classifying via UTL_TO_GENERATE_TEXT');
      const result = await classifyInDb(doc.extractedText ?? '');
      log.info('classified', { docType: result.docType, confidence: result.confidence });
      await DocumentsRepo.updateDocType(documentId, result.docType);
      await DocumentsRepo.updateStatus(documentId, 'classified');
      doc = (await DocumentsRepo.findById(documentId))!;
    }

    if (doc.status === 'classified') {
      const text = doc.extractedText ?? '';
      if (!isExtractable(doc.docType)) {
        log.warn('document is unknown type; skipping field extraction');
        await DocumentsRepo.updateStatus(documentId, 'fields_extracted');
      } else {
        log.info(`extracting ${doc.docType} fields via UTL_TO_GENERATE_TEXT`);
        if (doc.docType === 'invoice') {
          const fields = await extractFieldsInDb(text, 'invoice');
          await FieldsRepo.upsertInvoice(documentId, fields);
        } else if (doc.docType === 'contract') {
          const fields = await extractFieldsInDb(text, 'contract');
          await FieldsRepo.upsertContract(documentId, fields);
        } else if (doc.docType === 'cv') {
          const fields = await extractFieldsInDb(text, 'cv');
          await FieldsRepo.upsertCv(documentId, fields);
        }
        await DocumentsRepo.updateStatus(documentId, 'fields_extracted');
      }
      doc = (await DocumentsRepo.findById(documentId))!;
    }

    if (doc.status === 'fields_extracted') {
      log.info('generating embedding via DBMS_VECTOR_CHAIN');
      await DocumentsRepo.setEmbedding(documentId);
      await DocumentsRepo.updateStatus(documentId, 'embedded');
      doc = (await DocumentsRepo.findById(documentId))!;
    }

    if (doc.status === 'embedded') {
      await DocumentsRepo.updateStatus(documentId, 'done');
      log.info('ingest done');
      return 'done';
    }

    return doc.status;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('ingest failed', { error: message });
    await DocumentsRepo.updateStatus(documentId, 'failed', message.slice(0, 500));
    return 'failed';
  }
}
