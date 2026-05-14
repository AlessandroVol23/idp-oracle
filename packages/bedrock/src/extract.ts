import {
  getFieldsSchema,
  getJsonSchemaForType,
  type ExtractableDocType,
  type FieldsByType,
} from '@idp/schemas';
import { invokeClaude, extractJsonObject } from './invoke.js';

const SYSTEM_PROMPT_PREFIX = `You extract structured fields from a document. Respond with a single JSON object that matches the provided JSON Schema exactly. Fill missing fields with null where the schema allows; otherwise use a best-effort value. No prose, no markdown.`;

export async function extractFields<T extends ExtractableDocType>(
  text: string,
  docType: T,
): Promise<FieldsByType[T]> {
  const schema = getFieldsSchema(docType);
  const jsonSchema = getJsonSchemaForType(docType);
  const systemPrompt = `${SYSTEM_PROMPT_PREFIX}\n\nDocument type: ${docType}\nJSON Schema:\n${JSON.stringify(jsonSchema)}`;
  const userPrompt = `Document text:\n\n${text}`;

  const raw = await invokeClaude({
    systemPrompt,
    userPrompt,
    maxTokens: 4096,
  });
  const obj = extractJsonObject(raw);
  return schema.parse(obj) as FieldsByType[T];
}
