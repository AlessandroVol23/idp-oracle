import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { logger } from '@idp/logger';
import { getBedrockClient, getModelId } from './client.js';

interface AnthropicMessageResponse {
  content: { type: string; text?: string }[];
}

export async function invokeClaude(args: {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: args.maxTokens ?? 2048,
    temperature: args.temperature ?? 0,
    system: args.systemPrompt,
    messages: [{ role: 'user', content: args.userPrompt }],
  };

  const command = new InvokeModelCommand({
    modelId: getModelId(),
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  });

  const attempt = async (): Promise<string> => {
    const response = await getBedrockClient().send(command);
    const decoded = new TextDecoder().decode(response.body);
    const parsed = JSON.parse(decoded) as AnthropicMessageResponse;
    const text = parsed.content.find((c) => c.type === 'text')?.text;
    if (!text) {
      throw new Error('Bedrock response had no text content');
    }
    return text;
  };

  try {
    return await attempt();
  } catch (err) {
    logger.warn('bedrock invoke failed, retrying once', { error: String(err) });
    return await attempt();
  }
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]!.trim() : trimmed;
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error(`No JSON object found in model output: ${text.slice(0, 200)}`);
  }
  return JSON.parse(candidate.slice(first, last + 1));
}
