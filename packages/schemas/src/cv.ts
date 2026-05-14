import { z } from 'zod';
import { commonEnvelope } from './common.js';

export const cvEducation = z.object({
  degree: z.string(),
  institution: z.string(),
  year: z.number().int(),
});

export const cvWorkHistory = z.object({
  company: z.string(),
  title: z.string(),
  start: z.string(),
  end: z.string().nullable(),
  summary: z.string(),
});

export const cvFields = z.object({
  envelope: commonEnvelope,
  name: z.string(),
  email: z.string().email(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  yearsExperience: z.number().int().min(0),
  skills: z.array(z.string()),
  education: z.array(cvEducation),
  workHistory: z.array(cvWorkHistory),
});

export type CvFields = z.infer<typeof cvFields>;
export type CvEducation = z.infer<typeof cvEducation>;
export type CvWorkHistory = z.infer<typeof cvWorkHistory>;
