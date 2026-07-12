'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Locale } from '@/lib/i18n';
import { t } from '@/lib/i18n';

export interface ReportFormClient {
  id: string;
  name: string;
  projects: { id: string; name: string }[];
}

function toDateInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function ReportForm({
  clients,
  locale,
  initial,
}: {
  clients: ReportFormClient[];
  locale: Locale;
  initial: { clientId: string; projectId: string; fromMs: number; toMs: number };
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState(initial.clientId);
  const [projectId, setProjectId] = useState(initial.projectId);
  const [from, setFrom] = useState(toDateInput(initial.fromMs));
  const [to, setTo] = useState(toDateInput(initial.toMs - 1));

  const projects = useMemo(() => clients.find((c) => c.id === clientId)?.projects ?? [], [clients, clientId]);

  function go(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) return;
    const fromMs = new Date(`${from}T00:00:00`).getTime();
    const toMs = new Date(`${to}T00:00:00`).getTime() + 24 * 3600 * 1000;
    const q = new URLSearchParams({ clientId, from: String(fromMs), to: String(toMs) });
    if (projectId) q.set('projectId', projectId);
    router.push(`/reports?${q.toString()}`);
  }

  function setMonth(offset: number) {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
    setFrom(toDateInput(first.getTime()));
    setTo(toDateInput(last.getTime()));
  }

  return (
    <form onSubmit={go} className="card grid gap-3 md:grid-cols-4">
      <div>
        <label className="label">{t(locale, 'client')}</label>
        <select
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
        <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!clientId}>
          <option value="">{t(locale, 'allCases')}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">{t(locale, 'from')}</label>
        <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <div>
        <label className="label">{t(locale, 'to')}</label>
        <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <div className="md:col-span-4 flex items-center gap-2 flex-wrap">
        <button type="submit" className="btn-primary">
          {t(locale, 'report')}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setMonth(0)}>
          {t(locale, 'thisMonth')}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setMonth(-1)}>
          {locale === 'he' ? 'חודש שעבר' : 'Last month'}
        </button>
      </div>
    </form>
  );
}
