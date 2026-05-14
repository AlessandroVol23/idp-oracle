import { DocumentsRepo, FieldsRepo } from '@idp/db';
import { classify, extractFields } from '@idp/bedrock';
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
      await DocumentsRepo.updateStatus(documentId, 'text_extracted');
      doc = (await DocumentsRepo.findById(documentId))!;
    }

    if (doc.status === 'text_extracted') {
      log.info('classifying with bedrock');
      const result = await classify(doc.extractedText ?? '');
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
      } else if (doc.docType === 'invoice') {
        log.info('extracting invoice fields with bedrock');
        const fields = await extractFields(text, 'invoice');
        await FieldsRepo.upsertInvoice(documentId, fields);
        await DocumentsRepo.updateStatus(documentId, 'fields_extracted');
      } else if (doc.docType === 'contract') {
        log.info('extracting contract fields with bedrock');
        const fields = await extractFields(text, 'contract');
        await FieldsRepo.upsertContract(documentId, fields);
        await DocumentsRepo.updateStatus(documentId, 'fields_extracted');
      } else if (doc.docType === 'cv') {
        log.info('extracting cv fields with bedrock');
        const fields = await extractFields(text, 'cv');
        await FieldsRepo.upsertCv(documentId, fields);
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
