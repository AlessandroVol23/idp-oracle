import { faker } from '@faker-js/faker';
import type { InvoiceFields, ContractFields, CvFields } from '@idp/schemas';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function makeInvoice(): InvoiceFields {
  const itemCount = faker.number.int({ min: 1, max: 12 });
  const lineItems = Array.from({ length: itemCount }, () => {
    const quantity = faker.number.int({ min: 1, max: 20 });
    const unitPrice = Number(faker.commerce.price({ min: 50, max: 2500 }));
    return {
      description: faker.commerce.productName(),
      quantity,
      unitPrice,
      total: Number((quantity * unitPrice).toFixed(2)),
    };
  });
  const subtotal = Number(lineItems.reduce((s, l) => s + l.total, 0).toFixed(2));
  const tax = Number((subtotal * 0.19).toFixed(2));
  const total = Number((subtotal + tax).toFixed(2));
  const invoiceDate = faker.date.recent({ days: 90 });
  const dueDate = new Date(invoiceDate.getTime() + 30 * 24 * 60 * 60 * 1000);

  return {
    envelope: {
      docType: 'invoice',
      summary: `Invoice from ${faker.company.name()}`,
      language: 'en',
      pageCount: 1,
      confidence: 1,
    },
    vendor: faker.company.name(),
    invoiceNumber: `INV-${faker.number.int({ min: 1000, max: 9999 })}`,
    invoiceDate: isoDate(invoiceDate),
    dueDate: isoDate(dueDate),
    currency: 'USD',
    subtotal,
    tax,
    total,
    lineItems,
  };
}

const CLAUSE_POOL: { label: string; text: string }[] = [
  {
    label: 'Term and Termination',
    text:
      'This Agreement shall commence on the Effective Date and continue for the duration set forth herein, unless terminated earlier by either party upon thirty (30) days written notice for convenience or immediately for material breach not cured within fifteen (15) days of written notice.',
  },
  {
    label: 'Confidentiality',
    text:
      'Each party agrees to maintain the confidentiality of all proprietary information disclosed by the other party and shall not disclose such information to any third party without prior written consent, except as required by law.',
  },
  {
    label: 'Indemnification',
    text:
      'Each party shall indemnify and hold harmless the other party from any third-party claims arising out of its negligence or willful misconduct in performing this Agreement, subject to the limitations set forth herein.',
  },
  {
    label: 'Limitation of Liability',
    text:
      'Neither party shall be liable for any indirect, incidental, consequential, or punitive damages, and total aggregate liability shall not exceed the fees paid in the twelve (12) months preceding the claim.',
  },
  {
    label: 'Governing Law and Venue',
    text:
      'This Agreement is governed by the laws specified, and any disputes shall be resolved exclusively in the courts of that jurisdiction.',
  },
  {
    label: 'Assignment',
    text:
      'Neither party may assign this Agreement without the prior written consent of the other party, except in connection with a merger, acquisition, or sale of substantially all assets.',
  },
  {
    label: 'Force Majeure',
    text:
      'Neither party shall be liable for any failure or delay in performance under this Agreement due to causes beyond its reasonable control, including acts of God, war, terrorism, civil disturbance, or natural disaster.',
  },
  {
    label: 'Payment Terms',
    text:
      'All fees are due within thirty (30) days of invoice date. Late payments shall bear interest at the lesser of 1.5% per month or the maximum rate permitted by law.',
  },
  {
    label: 'Intellectual Property',
    text:
      'All intellectual property created in the performance of this Agreement shall be owned by the party that created it, subject to any licenses expressly granted herein.',
  },
  {
    label: 'Entire Agreement',
    text:
      'This Agreement constitutes the entire understanding between the parties and supersedes all prior agreements, written or oral, relating to its subject matter.',
  },
];

export function makeContract(): ContractFields {
  const partyA = faker.company.name();
  const partyB = faker.company.name();
  const effectiveDate = faker.date.recent({ days: 180 });
  const clauseCount = faker.number.int({ min: 3, max: 10 });
  const keyClauses = faker.helpers.arrayElements(CLAUSE_POOL, clauseCount);
  const hasValue = faker.datatype.boolean();

  return {
    envelope: {
      docType: 'contract',
      summary: `Master Services Agreement between ${partyA} and ${partyB}`,
      language: 'en',
      pageCount: 1,
      confidence: 1,
    },
    parties: [
      { name: partyA, role: 'Client' },
      { name: partyB, role: 'Provider' },
    ],
    effectiveDate: isoDate(effectiveDate),
    term: faker.helpers.arrayElement(['12 months', '24 months', '36 months', '1 year auto-renewing']),
    contractValue: hasValue ? faker.number.int({ min: 25_000, max: 500_000 }) : null,
    governingLaw: faker.helpers.arrayElement([
      'State of Delaware, USA',
      'State of California, USA',
      'England and Wales',
      'Republic of Ireland',
      'Federal Republic of Germany',
    ]),
    keyClauses,
  };
}

const SKILL_POOL_BY_LEVEL: Record<'entry' | 'mid' | 'senior', string[]> = {
  entry: ['JavaScript', 'HTML', 'CSS', 'React', 'Git', 'Python', 'SQL'],
  mid: [
    'TypeScript', 'React', 'Node.js', 'PostgreSQL', 'AWS', 'Docker',
    'REST APIs', 'Git', 'CI/CD', 'Unit Testing', 'Python',
  ],
  senior: [
    'TypeScript', 'Distributed Systems', 'Kubernetes', 'AWS', 'Terraform',
    'PostgreSQL', 'Oracle', 'Kafka', 'gRPC', 'System Design',
    'Mentoring', 'Architecture', 'Performance Optimization',
  ],
};

const DEGREE_POOL = [
  'B.Sc. Computer Science',
  'M.Sc. Software Engineering',
  'B.A. Mathematics',
  'M.Sc. Data Science',
  'B.Eng. Information Systems',
];

export function makeCv(): CvFields {
  const level = faker.helpers.arrayElement(['entry', 'mid', 'senior'] as const);
  const yearsExperience =
    level === 'entry'
      ? faker.number.int({ min: 0, max: 2 })
      : level === 'mid'
        ? faker.number.int({ min: 3, max: 7 })
        : faker.number.int({ min: 8, max: 20 });
  const skillCount = level === 'entry' ? 4 : level === 'mid' ? 7 : 10;
  const skills = faker.helpers.arrayElements(SKILL_POOL_BY_LEVEL[level], skillCount);

  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const name = `${firstName} ${lastName}`;
  const email = faker.internet.email({ firstName, lastName }).toLowerCase();

  const jobCount = level === 'entry' ? 1 : level === 'mid' ? 2 : 3;
  let cursor = new Date();
  cursor.setFullYear(cursor.getFullYear() - yearsExperience);
  const workHistory = Array.from({ length: jobCount }, (_, idx) => {
    const start = new Date(cursor);
    const tenure = faker.number.int({ min: 1, max: Math.max(2, Math.floor(yearsExperience / jobCount)) });
    const end = new Date(cursor);
    end.setFullYear(end.getFullYear() + tenure);
    cursor = new Date(end);
    return {
      company: faker.company.name(),
      title: faker.person.jobTitle(),
      start: isoDate(start),
      end: idx === jobCount - 1 ? null : isoDate(end),
      summary: faker.lorem.sentence({ min: 12, max: 24 }),
    };
  });

  const gradYear = new Date().getFullYear() - yearsExperience;
  const education = [
    {
      degree: faker.helpers.arrayElement(DEGREE_POOL),
      institution: faker.company.name() + ' University',
      year: gradYear,
    },
  ];

  return {
    envelope: {
      docType: 'cv',
      summary: `${level} engineer with ${yearsExperience} years of experience`,
      language: 'en',
      pageCount: 1,
      confidence: 1,
    },
    name,
    email,
    phone: faker.phone.number(),
    location: `${faker.location.city()}, ${faker.location.countryCode()}`,
    yearsExperience,
    skills,
    education,
    workHistory,
  };
}
