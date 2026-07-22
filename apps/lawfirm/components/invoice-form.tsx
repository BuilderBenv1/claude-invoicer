'use client';

import { useMemo, useState } from 'react';
import { createInvoice } from '@/lib/actions';
import type { ReportFormClient } from '@/components/report-form';
import type { Locale } from '@/lib/i18n';
import { t } from '@/lib/i18n';

function toDateInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface ManualLine {
  label: string;
  amount: string;
}

export function InvoiceForm({
  clients,
  locale,
  preselect,
}: {
  clients: ReportFormClient[];
  locale: Locale;
  preselect?: { clientId?: string; projectId?: string };
}) {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [clientId, setClientId] = useState(preselect?.clientId ?? '');
  const [projectId, setProjectId] = useState(preselect?.projectId ?? '');
  const [includeHours, setIncludeHours] = useState(true);
  const [from, setFrom] = useState(toDateInput(firstOfMonth));
  const [to, setTo] = useState(toDateInput(lastOfMonth));
  const [lines, setLines] = useState<ManualLine[]>([]);

  const projects = useMemo(() => clients.find((c) => c.id === clientId)?.projects ?? [], [clients, clientId]);

  const fromMs = new Date(`${from}T00:00:00`).getTime();
  const toMs = new Date(`${to}T00:00:00`).getTime() + 24 * 3600 * 1000;

  const cleanLines = lines
    .map((l) => ({ label: l.label.trim(), amount: Number(l.amount) || 0 }))
    .filter((l) => l.label && l.amount !== 0);

  return (
    <form action={createInvoice} className="space-y-5">
      <input type="hidden" name="from" value={fromMs} />
      <input type="hidden" name="to" value={toMs} />
      <input type="hidden" name="lines" value={JSON.stringify(cleanLines)} />

      <div className="card grid gap-3 md:grid-cols-2">
        <div>
          <label className="label">{t(locale, 'client')}</label>
          <select
            name="clientId"
            className="input"
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setProjectId('');
            }}
            required
          >
            <option value="">{t(locale, 'pickClient')}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t(locale, 'case')}</label>
          <select name="projectId" className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!clientId}>
            <option value="">{t(locale, 'allCases')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tracked hours */}
      <div className="card space-y-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="includeHours" value="1" checked={includeHours} onChange={(e) => setIncludeHours(e.target.checked)} className="w-4 h-4" />
          {t(locale, 'includeHours')}
        </label>
        {includeHours && (
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label">{t(locale, 'from')}</label>
              <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="label">{t(locale, 'to')}</label>
              <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        )}
      </div>

      {/* One-off flat lines */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-medium">{t(locale, 'oneOffLine')}</div>
          <button type="button" className="btn-ghost" onClick={() => setLines((ls) => [...ls, { label: '', amount: '' }])}>
            ＋ {t(locale, 'addLine')}
          </button>
        </div>
        {lines.length === 0 ? <p className="text-xs text-slate-500">—</p> : null}
        {lines.map((l, i) => (
          <div key={i} className="grid gap-2 grid-cols-[1fr_140px_auto]">
            <input
              className="input"
              placeholder={t(locale, 'lineLabel')}
              value={l.label}
              onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            />
            <input
              className="input"
              type="number"
              step="0.01"
              placeholder={t(locale, 'lineAmount')}
              value={l.amount}
              onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
            />
            <button type="button" className="btn-ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="card">
        <label className="label">{t(locale, 'notes')}</label>
        <textarea name="notes" className="input" rows={2} />
      </div>

      <button className="btn-primary" type="submit" disabled={!clientId || (!includeHours && cleanLines.length === 0)}>
        {t(locale, 'createInvoice')}
      </button>
    </form>
  );
}
