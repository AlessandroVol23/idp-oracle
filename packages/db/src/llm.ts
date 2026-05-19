import oracledb from 'oracledb';
import { z } from 'zod';
import { withConnection } from './pool.js';
import {
  classificationResult,
  getFieldsSchema,
  getJsonSchemaForType,
  type ExtractableDocType,
  type FieldsByType,
} from '@idp/schemas';
import type { DocType } from '@idp/shared';

const CREDENTIAL_NAME = 'OCI_CRED';
const CLASSIFY_MAX_TOKENS = 200;
const EXTRACT_MAX_TOKENS = 4096;
const CONFIDENCE_THRESHOLD = 0.7;

function generationParams(maxTokens: number): string {
  const region = process.env.OCI_GENAI_REGION ?? 'eu-frankfurt-1';
  const model = process.env.OCI_GENAI_MODEL ?? 'cohere.command-r-plus-08-2024';
  return JSON.stringify({
    provider: 'ocigenai',
    credential_name: CREDENTIAL_NAME,
    url: `https://inference.generativeai.${region}.oci.oraclecloud.com/20231130/actions/chat`,
    model,
    chatRequest: { maxTokens, temperature: 0 },
  });
}

async function generate(prompt: string, maxTokens: number): Promise<string> {
  return withConnection(async (conn) => {
    conn.callTimeout = 60_000;
    const result = await conn.execute<{ OUT: string }>(
      `SELECT DBMS_VECTOR_CHAIN.UTL_TO_GENERATE_TEXT(:input, JSON(:params)) AS OUT FROM DUAL`,
      { input: prompt, params: generationParams(maxTokens) },
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        fetchInfo: { OUT: { type: oracledb.STRING } },
      },
    );
    return (result.rows?.[0]?.OUT ?? '').trim();
  });
}

function extractJsonObject(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? raw).trim();
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(`LLM response is not JSON: ${raw.slice(0, 200)}`);
  }
  return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
}

const CLASSIFY_PROMPT_PREFIX = `You classify business documents. Respond with a single JSON object and nothing else.

Schema:
{ "docType": "invoice" | "contract" | "cv" | "unknown", "confidence": number between 0 and 1 }

Definitions:
- "invoice": billing document with vendor, line items, totals
- "contract": legal agreement between parties with terms and clauses
- "cv": resume listing a person's work history and skills
- "unknown": none of the above with confidence >= 0.7

Document text (first 4000 chars):
`;

export interface ClassifyResult {
  docType: DocType;
  confidence: number;
}

export async function classifyInDb(text: string): Promise<ClassifyResult> {
  const prompt = CLASSIFY_PROMPT_PREFIX + text.slice(0, 4000);
  const raw = await generate(prompt, CLASSIFY_MAX_TOKENS);
  const obj = extractJsonObject(raw);
  const parsed = classificationResult.parse(obj);
  const confidence = parsed.confidence ?? 1;
  const docType = confidence < CONFIDENCE_THRESHOLD ? 'unknown' : parsed.docType;
  return { docType, confidence };
}

export async function extractFieldsInDb<T extends ExtractableDocType>(
  text: string,
  docType: T,
): Promise<FieldsByType[T]> {
  const schema = getFieldsSchema(docType);
  const jsonSchema = getJsonSchemaForType(docType);
  const prompt = `You extract structured fields from a document. Respond with a single JSON object that matches the provided JSON Schema exactly. Fill missing fields with null where the schema allows; otherwise use a best-effort value. No prose, no markdown fences.

Document type: ${docType}
JSON Schema:
${JSON.stringify(jsonSchema)}

Document text:
${text}`;
  const raw = await generate(prompt, EXTRACT_MAX_TOKENS);
  const obj = extractJsonObject(raw);
  return (schema as z.ZodTypeAny).parse(obj) as FieldsByType[T];
}
