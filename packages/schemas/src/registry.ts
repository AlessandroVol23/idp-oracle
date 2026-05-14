import type { DocType } from '@idp/shared';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import { invoiceFields } from './invoice.js';
import { contractFields } from './contract.js';
import { cvFields } from './cv.js';

export const fieldsSchemaByType = {
  invoice: invoiceFields,
  contract: contractFields,
  cv: cvFields,
} as const;

export type ExtractableDocType = keyof typeof fieldsSchemaByType;

export type FieldsByType = {
  invoice: z.infer<typeof invoiceFields>;
  contract: z.infer<typeof contractFields>;
  cv: z.infer<typeof cvFields>;
};

export function getFieldsSchema<T extends ExtractableDocType>(
  docType: T,
): (typeof fieldsSchemaByType)[T] {
  return fieldsSchemaByType[docType];
}

export function getJsonSchemaForType(docType: ExtractableDocType): object {
  return zodToJsonSchema(fieldsSchemaByType[docType], {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  });
}

export function isExtractable(docType: DocType): docType is ExtractableDocType {
  return docType === 'invoice' || docType === 'contract' || docType === 'cv';
}
