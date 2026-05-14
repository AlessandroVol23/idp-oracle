import { createPool } from '@idp/db';
import { logger } from '@idp/logger';

export interface AppConfig {
  oracle: {
    connectString: string;
    user: string;
    password: string;
  };
  bedrock: {
    modelId: string;
    region: string;
  };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} env var is required`);
  return v;
}

export function readConfig(): AppConfig {
  return {
    oracle: {
      connectString: required('ORACLE_CONNECT_STRING'),
      user: required('ORACLE_USER'),
      password: required('ORACLE_PASSWORD'),
    },
    bedrock: {
      modelId: required('BEDROCK_MODEL_ID'),
      region: process.env.AWS_REGION ?? 'us-east-1',
    },
  };
}

let initialized = false;

export async function initConfig(): Promise<AppConfig> {
  const cfg = readConfig();
  if (!initialized) {
    await createPool(cfg.oracle);
    initialized = true;
    logger.info('app config initialized', {
      modelId: cfg.bedrock.modelId,
      region: cfg.bedrock.region,
    });
  }
  return cfg;
}
