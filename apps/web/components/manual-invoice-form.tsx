'use client';

import { useMemo, useState } from 'react';
import { createManualInvoice } from '@/lib/actions';

interface ClientOption {
  id: string;
  name: string;
  currency: string;
  hourlyRate: number;
}
interface Row {
  label: string;
  hours: string;
  rate: string;
  amount: string;
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

const blankRow = (): Row => ({ label: '', hours: '', rate: '', amount: '' });

export function ManualInvoiceForm({ clients }: { clients: ClientOption[] }) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [issuedAt, setIssuedAt] = useState('');
  const [number, setNumber] = useState('');
  const [markPaid, setMarkPaid] = useState(false);
  const [paidAt, setPaidAt] = useState('');
  const [rows, setRows] = useState<Row[]>([blankRow()]);

  const currency = clients.find((c) => c.id === clientId)?.currency ?? 'USD';

  const computed = useMemo(
    () =>
      rows.map((r) => {
        const hours = Number(r.hours) || 0;
        const rate = Number(r.rate) || 0;
        // Amount = explicit override if given, else hours × rate.
        const amount = r.amount !== '' ? Number(r.amount) || 0 : Math.round(hours * rate * 100) / 100;
        return { label: r.label.trim(), hours, ratePerHour: rate, amount };
      }),
    [rows],
  );
  const total = Math.round(computed.reduce((s, r) => s + (r.label ? r.amount : 0), 0) * 100) / 100;
  const linesJson = JSON.stringify(computed.filter((r) => r.label && r.amount !== 0));

  const update = (i: number, key: keyof Row, val: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: val } : r)));

  return (
    <form action={createManualInvoice} className="space-y-6">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="lines" value={linesJson} />
      <input type="hidden" name="markPaid" value={markPaid ? '1' : '0'} />

      <div className="card grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label">Client</label>
          <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
            {clients.length === 0 && <option value="">No clients — add one first</option>}
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.currency})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Issue date (optional)</label>
          <input type="date" name="issuedAt" className="input" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
        </div>
        <div>
          <label className="label">Invoice # (optional override)</label>
          <input name="number" className="input" placeholder="auto" value={number} onChange={(e) => setNumber(e.target.value)} />
        </div>
      </div>

      <div className="card space-y-2">
        <div className="hidden gap-2 text-xs uppercase tracking-wide text-slate-400 sm:grid sm:grid-cols-[1fr_5rem_6rem_7rem_2rem]">
          <span>Description</span>
          <span className="text-right">Hours</span>
          <span className="text-right">Rate</span>
          <span className="text-right">Amount</span>
          <span />
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_5rem_6rem_7rem_2rem]">
            <input
              className="input"
              placeholder="Work description"
              value={r.label}
              onChange={(e) => update(i, 'label', e.target.value)}
            />
            <input
              className="input text-right"
              type="number"
              step="0.01"
              placeholder="0"
              value={r.hours}
              onChange={(e) => update(i, 'hours', e.target.value)}
            />
            <input
              className="input text-right"
              type="number"
              step="0.01"
              placeholder="0"
              value={r.rate}
              onChange={(e) => update(i, 'rate', e.target.value)}
            />
            <input
              className="input text-right"
              type="number"
              step="0.01"
              placeholder={computed[i] ? computed[i]!.amount.toFixed(2) : '0.00'}
              value={r.amount}
              onChange={(e) => update(i, 'amount', e.target.value)}
            />
            <button
              type="button"
              className="btn-ghost px-2"
              onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs))}
              aria-label="Remove line"
            >
              ×
            </button>
          </div>
        ))}
        <div className="flex items-center justify-between pt-2">
          <button type="button" className="btn-ghost" onClick={() => setRows((rs) => [...rs, blankRow()])}>
            + Add line
          </button>
          <div className="text-right">
            <div className="label">Total</div>
            <div className="text-lg font-semibold">{money(total, currency)}</div>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Enter Hours × Rate for hourly work, or leave them blank and type an Amount for a flat fee.
        </p>
      </div>

      <div className="card space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={markPaid} onChange={(e) => setMarkPaid(e.target.checked)} />
          Mark as already paid (issues a receipt immediately)
        </label>
        {markPaid && (
          <div className="w-48">
            <label className="label">Paid date (optional)</label>
            <input type="date" name="paidAt" className="input" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </div>
        )}
      </div>

      <button type="submit" className="btn-primary" disabled={!clientId || !linesJson || linesJson === '[]'}>
        Create invoice
      </button>
    </form>
  );
}
