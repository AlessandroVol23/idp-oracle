import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { faker } from '@faker-js/faker';
import { renderToBuffer } from '@react-pdf/renderer';
import { createElement } from 'react';
import { InvoicePDF } from './templates/InvoicePDF.js';
import { ContractPDF } from './templates/ContractPDF.js';
import { CvPDF } from './templates/CvPDF.js';
import { makeInvoice, makeContract, makeCv } from './templates/factories.js';

interface Args {
  count: number;
  type: 'invoice' | 'contract' | 'cv' | 'all';
  seed: number;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    count: 10,
    type: 'all',
    seed: 42,
    out: join(dirname(fileURLToPath(import.meta.url)), '..', 'samples'),
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const val = argv[i + 1];
    if (!key || val === undefined) break;
    if (key === '--count') args.count = Number(val);
    else if (key === '--type') args.type = val as Args['type'];
    else if (key === '--seed') args.seed = Number(val);
    else if (key === '--out') args.out = val;
  }
  return args;
}

const CONTRACT_TITLES = [
  'Master Services Agreement',
  'Software Licensing Agreement',
  'Mutual Non-Disclosure Agreement',
  'Statement of Work',
  'Reseller Agreement',
];

async function writePdf(node: React.ReactElement, outPath: string): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true });
  const buffer = await renderToBuffer(node);
  await writeFile(outPath, buffer);
}

async function generateOne(type: 'invoice' | 'contract' | 'cv', idx: number, outDir: string): Promise<string> {
  const padded = String(idx + 1).padStart(2, '0');
  if (type === 'invoice') {
    const data = makeInvoice();
    const file = join(outDir, 'invoices', `invoice-${padded}.pdf`);
    await writePdf(createElement(InvoicePDF, { data }), file);
    return file;
  }
  if (type === 'contract') {
    const data = makeContract();
    const title = faker.helpers.arrayElement(CONTRACT_TITLES);
    const file = join(outDir, 'contracts', `contract-${padded}.pdf`);
    await writePdf(createElement(ContractPDF, { data, title }), file);
    return file;
  }
  const data = makeCv();
  const file = join(outDir, 'cvs', `cv-${padded}.pdf`);
  await writePdf(createElement(CvPDF, { data }), file);
  return file;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  faker.seed(args.seed);
  const types: ('invoice' | 'contract' | 'cv')[] =
    args.type === 'all' ? ['invoice', 'contract', 'cv'] : [args.type];

  console.log(`generating ${args.count} of each [${types.join(', ')}] with seed ${args.seed}`);
  for (const t of types) {
    for (let i = 0; i < args.count; i++) {
      const path = await generateOne(t, i, args.out);
      console.log(`  ${path}`);
    }
  }
  console.log('done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
