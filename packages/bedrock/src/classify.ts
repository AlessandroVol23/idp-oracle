import { classificationResult } from '@idp/schemas';
import type { DocType } from '@idp/shared';
import { invokeClaude, extractJsonObject } from './invoke.js';

export interface ClassifyResult {
  docType: DocType;
  confidence: number;
}

const SYSTEM_PROMPT = `You classify business documents. Respond with a single JSON object and nothing else.

Schema:
{
  "docType": "invoice" | "contract" | "cv" | "unknown",
  "confidence": number between 0 and 1
}

Definitions:
- "invoice": billing document with vendor, line items, totals
- "contract": legal agreement between parties with terms and clauses
- "cv": resume / curriculum vitae listing a person's work history and skills
- "unknown": none of the above with confidence >= 0.7`;

const CONFIDENCE_THRESHOLD = 0.7;

export async function classify(text: string): Promise<ClassifyResult> {
  const userPrompt = `Document text (first 4000 chars):\n\n${text.slice(0, 4000)}`;
  const raw = await invokeClaude({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 100,
  });
  const obj = extractJsonObject(raw);
  const parsed = classificationResult.parse(obj);
  const docType = parsed.confidence < CONFIDENCE_THRESHOLD ? 'unknown' : parsed.docType;
  return { docType, confidence: parsed.confidence };
}
