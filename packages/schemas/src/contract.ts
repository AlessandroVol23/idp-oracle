import { z } from 'zod';
import { commonEnvelope } from './common.js';

export const contractParty = z.object({
  name: z.string(),
  role: z.string(),
});

export const contractClause = z.object({
  label: z.string(),
  text: z.string(),
});

export const contractFields = z.object({
  envelope: commonEnvelope,
  parties: z.array(contractParty).min(2),
  effectiveDate: z.string(),
  term: z.string(),
  contractValue: z.number().nullable(),
  governingLaw: z.string(),
  keyClauses: z.array(contractClause),
});

export type ContractFields = z.infer<typeof contractFields>;
export type ContractParty = z.infer<typeof contractParty>;
export type ContractClause = z.infer<typeof contractClause>;
