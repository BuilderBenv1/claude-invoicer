import type { WeekProjectDayGrid } from '@claude-invoicer/core';

/** Read-only per-project × per-day hours grid for a week (informational; hours are actual active time). */
export function WeekHoursGrid({ grid }: { grid: WeekProjectDayGrid }) {
  if (grid.rows.length === 0) return null;
  const cell = (n: number) => (n === 0 ? <span className="text-slate-600">·</span> : n.toFixed(2));
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Hours by day</h2>
      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-slate-400">
            <tr className="text-left">
              <th className="pb-2 pr-3">Project</th>
              {grid.columns.map((c) => (
                <th key={c.dayKey} className="px-2 pb-2 text-right">
                  {c.weekday}
                  <div className="text-[10px] font-normal text-slate-500">{c.dayKey.slice(5)}</div>
                </th>
              ))}
              <th className="pb-2 pl-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((r) => (
              <tr key={r.label} className="border-t border-slate-800">
                <td className="py-2 pr-3">{r.label}</td>
                {r.hoursByDay.map((h, i) => (
                  <td key={i} className="px-2 py-2 text-right tabular-nums">{cell(h)}</td>
                ))}
                <td className="py-2 pl-2 text-right font-medium tabular-nums">{r.total.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-700">
              <td className="pt-2 pr-3 font-semibold">Total</td>
              {grid.dayTotals.map((h, i) => (
                <td key={i} className="px-2 pt-2 text-right tabular-nums">{cell(h)}</td>
              ))}
              <td className="pt-2 pl-2 text-right font-semibold tabular-nums">{grid.grandTotal.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
