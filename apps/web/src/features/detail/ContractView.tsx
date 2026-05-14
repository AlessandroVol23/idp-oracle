import type { ContractFields } from '@idp/schemas';
import { Card } from '../../components/ui';

export function ContractView({ fields }: { fields: ContractFields }) {
  return (
    <>
      <Card>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Contract
        </h3>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Effective date" value={fields.effectiveDate} />
          <Field label="Term" value={fields.term} />
          <Field
            label="Value"
            value={fields.contractValue == null ? '—' : `$${fields.contractValue.toLocaleString()}`}
          />
          <Field label="Governing law" value={fields.governingLaw} />
        </dl>
        <h4 className="mb-2 mt-4 text-xs uppercase tracking-wide text-slate-500">Parties</h4>
        <ul className="space-y-1 text-sm">
          {fields.parties.map((p, i) => (
            <li key={i}>
              <span className="font-medium">{p.name}</span>{' '}
              <span className="text-slate-500">— {p.role}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Key clauses
        </h3>
        <div className="space-y-3">
          {fields.keyClauses.map((c, i) => (
            <details key={i} className="rounded border border-slate-200 p-2 text-sm">
              <summary className="cursor-pointer font-medium">{c.label}</summary>
              <p className="mt-2 text-slate-700">{c.text}</p>
            </details>
          ))}
        </div>
      </Card>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
