'use client';

import { useEffect, useMemo, useState } from 'react';
import { startTimer, stopTimer, cancelTimer } from '@/lib/actions';
import type { ClientTreeNode } from '@/lib/queries';
import type { Locale } from '@/lib/i18n';
import { t } from '@/lib/i18n';
import { formatClock } from '@/lib/time';

interface RunningProps {
  entryId: string;
  startMs: number;
  clientName: string;
  projectName: string;
  taskName: string | null;
}

export function TimerWidget({
  tree,
  running,
  locale,
}: {
  tree: ClientTreeNode[];
  running: RunningProps | null;
  locale: Locale;
}) {
  if (running) return <RunningTimer running={running} locale={locale} />;
  return <IdleTimer tree={tree} locale={locale} />;
}

function RunningTimer({ running, locale }: { running: RunningProps; locale: Locale }) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.max(0, now - running.startMs);

  return (
    <div className="card border-emerald-700/60 bg-emerald-950/20">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-medium mb-1">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            {t(locale, 'running')}
          </div>
          <div className="text-lg font-semibold">
            {running.clientName} · {running.projectName}
            {running.taskName ? <span className="text-slate-400"> · {running.taskName}</span> : null}
          </div>
        </div>
        <div className="num text-4xl font-bold tabular-nums tracking-tight text-emerald-300">{formatClock(elapsed)}</div>
        <div className="flex gap-2">
          <form action={stopTimer}>
            <input type="hidden" name="entryId" value={running.entryId} />
            <button className="btn-green" type="submit">
              {t(locale, 'stopTimer')}
            </button>
          </form>
          <form action={cancelTimer}>
            <input type="hidden" name="entryId" value={running.entryId} />
            <button className="btn-ghost" type="submit">
              {t(locale, 'cancel')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function IdleTimer({ tree, locale }: { tree: ClientTreeNode[]; locale: Locale }) {
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [taskId, setTaskId] = useState('');

  const projects = useMemo(() => tree.find((c) => c.id === clientId)?.projects ?? [], [tree, clientId]);
  const currentProject = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);
  const tasks = currentProject?.tasks ?? [];
  const canStart = clientId && projectId;

  return (
    <div className="card">
      <div className="flex items-center gap-2 text-slate-400 text-xs font-medium mb-3">{t(locale, 'noRunningTimer')}</div>
      <form action={startTimer} className="grid gap-3 md:grid-cols-4">
        <div>
          <label className="label">{t(locale, 'client')}</label>
          <select
            name="clientId"
            className="input"
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setProjectId('');
              setTaskId('');
            }}
            required
          >
            <option value="">{t(locale, 'pickClient')}</option>
            {tree.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t(locale, 'case')}</label>
          <select
            name="projectId"
            className="input"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setTaskId('');
            }}
            disabled={!clientId}
            required
          >
            <option value="">{t(locale, 'pickCase')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t(locale, 'task')}</label>
          <select
            name="taskId"
            className="input"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            disabled={!projectId || tasks.length === 0}
          >
            <option value="">{t(locale, 'pickTask')}</option>
            {tasks.map((tk) => (
              <option key={tk.id} value={tk.id}>
                {tk.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button className="btn-green w-full" type="submit" disabled={!canStart}>
            ▶ {t(locale, 'startTimer')}
          </button>
        </div>
        <div className="md:col-span-4">
          <input name="description" className="input" placeholder={t(locale, 'whatWorkingOn')} />
        </div>
      </form>
    </div>
  );
}
