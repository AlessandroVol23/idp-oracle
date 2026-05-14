import type { CvFields } from '@idp/schemas';
import { Card } from '../../components/ui';

export function CvView({ fields }: { fields: CvFields }) {
  return (
    <>
      <Card>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Candidate
        </h3>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Name" value={fields.name} />
          <Field label="Email" value={fields.email} />
          <Field label="Phone" value={fields.phone ?? '—'} />
          <Field label="Location" value={fields.location ?? '—'} />
          <Field label="Years experience" value={String(fields.yearsExperience)} />
        </dl>
        <h4 className="mb-2 mt-4 text-xs uppercase tracking-wide text-slate-500">Skills</h4>
        <div className="flex flex-wrap gap-1">
          {fields.skills.map((s) => (
            <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
              {s}
            </span>
          ))}
        </div>
      </Card>
      <Card>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Work history
        </h3>
        <ul className="space-y-3 text-sm">
          {fields.workHistory.map((w, i) => (
            <li key={i}>
              <div className="font-medium">
                {w.title} <span className="text-slate-500">at</span> {w.company}
              </div>
              <div className="text-xs text-slate-500">
                {w.start} – {w.end ?? 'present'}
              </div>
              <p className="mt-1 text-slate-700">{w.summary}</p>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Education
        </h3>
        <ul className="space-y-2 text-sm">
          {fields.education.map((e, i) => (
            <li key={i}>
              <span className="font-medium">{e.degree}</span>
              <span className="text-slate-500"> — {e.institution}, {e.year}</span>
            </li>
          ))}
        </ul>
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
