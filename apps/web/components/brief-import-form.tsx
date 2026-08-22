'use client';

import { useState, useTransition } from 'react';
import { createBrief, parseBriefUpload } from '@/lib/actions';
import { CurrencySelect } from '@/components/currency-select';

interface Row {
  section: string;
  title: string;
  hoursLow: string;
  hoursHigh: string;
  amountLow: string;
  amountHigh: string;
}

const n = (v: string) => Number(v) || 0;

/**
 * Upload or paste an estimate, then confirm what was found before anything is
 * saved. The parse is deliberately never trusted: a document it reads badly is
 * still a couple of minutes of editing, and a wrong milestone becomes a wrong
 * invoice later.
 */
export function BriefImportForm({
  clientId,
  defaultCurrency,
  defaultRate,
  folders,
}: {
  clientId: string;
  defaultCurrency: string;
  defaultRate: number;
  folders: { id: string; label: string }[];
}) {
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [title, setTitle] = useState('');
  const [rate, setRate] = useState(String(defaultRate));
  const [currency, setCurrency] = useState(defaultCurrency);
  const [sourceText, setSourceText] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');

  const parse = (fd: FormData) =>
    start(async () => {
      setError('');
      const res = await parseBriefUpload(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setTitle(res.title);
      setCurrency(res.currency || defaultCurrency);
      if (res.ratePerHour) setRate(String(res.ratePerHour));
      setWarnings(res.warnings);
      // The server returns the text it actually parsed (paste, or extracted
      // file contents) — read that instead of the paste textarea, which is
      // empty for every file upload and would otherwise wipe sourceText.
      setSourceText(res.sourceText ?? '');
      setRows(
        res.items.map((i) => ({
          section: i.section,
          title: i.title,
          hoursLow: String(i.hoursLow),
          hoursHigh: String(i.hoursHigh),
          amountLow: String(i.amountLow),
          amountHigh: String(i.amountHigh),
        })),
      );
    });

  const update = (i: number, key: keyof Row, v: string) =>
    setRows((rs) => (rs ? rs.map((r, j) => (j === i ? { ...r, [key]: v } : r)) : rs));

  if (!rows) {
    return (
      <form action={parse} className="card space-y-3">
        <div>
          <label className="label">Upload an estimate</label>
          <input type="file" name="file" accept=".docx,.txt,.md,.csv" className="input" />
          <p className="mt-1 text-xs text-slate-500">
            Word (.docx), plain text, Markdown or CSV. Nothing is saved until you confirm what was found.
          </p>
        </div>
        <div>
          <label className="label">…or paste the text</label>
          <textarea name="text" rows={6} className="input font-mono text-xs" />
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
        <button className="btn-primary" type="submit" disabled={pending}>
          {pending ? 'Reading…' : 'Read estimate'}
        </button>
      </form>
    );
  }

  // items is the save set (blank-title rows dropped); totals is derived from
  // it rather than from the raw rows so a blanked title visibly stops
  // counting instead of still appearing in the numbers the user is asked to
  // check against the estimate they sent the client.
  const items = rows
    .filter((r) => r.title.trim())
    .map((r) => ({
      section: r.section,
      title: r.title,
      deliverable: '',
      amount: n(r.amountHigh),
      hoursLow: n(r.hoursLow),
      hoursHigh: n(r.hoursHigh),
      amountLow: n(r.amountLow),
      amountHigh: n(r.amountHigh),
    }));

  const totals = items.reduce(
    (a, r) => ({
      hoursLow: a.hoursLow + r.hoursLow,
      hoursHigh: a.hoursHigh + r.hoursHigh,
      amountLow: a.amountLow + r.amountLow,
      amountHigh: a.amountHigh + r.amountHigh,
    }),
    { hoursLow: 0, hoursHigh: 0, amountLow: 0, amountHigh: 0 },
  );

  return (
    <form action={createBrief} className="card space-y-4">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <input type="hidden" name="sourceText" value={sourceText} />

      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-900/50 bg-amber-950/30 p-3 text-xs text-amber-200">
          {warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label className="label">Brief title</label>
          <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} className="input" required />
        </div>
        <div>
          <label className="label">Currency</label>
          <CurrencySelect name="currency" defaultValue={currency} />
        </div>
        <div>
          <label className="label">Rate / hr</label>
          <input
            name="ratePerHour"
            type="number"
            step="0.01"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="input"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Billing</label>
          <select name="billingMode" defaultValue="time" className="input">
            <option value="time">Time &amp; materials — bill the hours actually tracked</option>
            <option value="fixed">Fixed price — bill each milestone&apos;s agreed amount</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Folder (optional)</label>
          <select name="folderMappingId" defaultValue="" className="input">
            <option value="">Not linked to a folder yet</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-slate-400">
            <tr className="text-left">
              <th className="pb-2">Work</th>
              <th className="pb-2 text-right">Hours low</th>
              <th className="pb-2 text-right">Hours high</th>
              <th className="pb-2 text-right">Cost low</th>
              <th className="pb-2 text-right">Cost high</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-800">
                <td className="py-1">
                  <input className="input" value={r.title} onChange={(e) => update(i, 'title', e.target.value)} />
                  {r.section && <div className="mt-1 text-xs text-slate-500">{r.section}</div>}
                </td>
                <td className="py-1">
                  <input
                    className="input w-20 text-right"
                    type="number"
                    min="0"
                    step="0.25"
                    value={r.hoursLow}
                    onChange={(e) => update(i, 'hoursLow', e.target.value)}
                  />
                </td>
                <td className="py-1">
                  <input
                    className="input w-20 text-right"
                    type="number"
                    min="0"
                    step="0.25"
                    value={r.hoursHigh}
                    onChange={(e) => update(i, 'hoursHigh', e.target.value)}
                  />
                </td>
                <td className="py-1">
                  <input
                    className="input w-24 text-right"
                    type="number"
                    min="0"
                    step="0.01"
                    value={r.amountLow}
                    onChange={(e) => update(i, 'amountLow', e.target.value)}
                  />
                </td>
                <td className="py-1">
                  <input
                    className="input w-24 text-right"
                    type="number"
                    min="0"
                    step="0.01"
                    value={r.amountHigh}
                    onChange={(e) => update(i, 'amountHigh', e.target.value)}
                  />
                </td>
                <td className="py-1">
                  <button
                    type="button"
                    className="btn-ghost px-2"
                    onClick={() => setRows((rs) => (rs ? rs.filter((_, j) => j !== i) : rs))}
                    aria-label="Remove row"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-700 font-semibold">
              <td className="pt-2">{items.length} items</td>
              <td className="pt-2 text-right">{totals.hoursLow}</td>
              <td className="pt-2 text-right">{totals.hoursHigh}</td>
              <td className="pt-2 text-right">{totals.amountLow}</td>
              <td className="pt-2 text-right">{totals.amountHigh}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <button
        type="button"
        className="btn-ghost"
        onClick={() =>
          setRows((rs) => [
            ...(rs ?? []),
            { section: '', title: '', hoursLow: '', hoursHigh: '', amountLow: '', amountHigh: '' },
          ])
        }
      >
        + Add row
      </button>

      <p className="text-xs text-slate-500">
        Check these against the estimate you sent the client before saving — especially the totals.
      </p>

      <div className="flex gap-2">
        <button className="btn-primary" type="submit" disabled={items.length === 0}>
          Save brief
        </button>
        <button type="button" className="btn-ghost" onClick={() => setRows(null)}>
          Start over
        </button>
      </div>
    </form>
  );
}
