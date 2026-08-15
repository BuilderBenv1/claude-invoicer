'use client';

import { useState } from 'react';
import { CURRENCIES, DEFAULT_ACCOUNT_KEY } from '@claude-invoicer/core';
import { deletePaymentAccount, savePaymentAccount } from '@/lib/actions';

interface AccountRow {
  currency: string;
  accountName: string | null;
  bankName: string | null;
  sortCode: string | null;
  accountNumber: string | null;
  iban: string | null;
  bic: string | null;
  routingNumber: string | null;
  notes: string | null;
}

const FIELDS: { name: keyof AccountRow; label: string; placeholder?: string }[] = [
  { name: 'accountName', label: 'Account name' },
  { name: 'bankName', label: 'Bank' },
  { name: 'sortCode', label: 'Sort code', placeholder: '04-00-04' },
  { name: 'accountNumber', label: 'Account number' },
  { name: 'iban', label: 'IBAN' },
  { name: 'bic', label: 'BIC / SWIFT' },
  { name: 'routingNumber', label: 'Routing number' },
];

function AccountFields({ account }: { account: AccountRow }) {
  return (
    <>
      {FIELDS.map((f) => (
        <div key={f.name}>
          <label className="label">{f.label}</label>
          <input
            name={f.name}
            defaultValue={(account[f.name] as string | null) ?? ''}
            placeholder={f.placeholder}
            className="input"
          />
        </div>
      ))}
      <div className="sm:col-span-2">
        <label className="label">Payment note (optional)</label>
        <input
          name="notes"
          defaultValue={account.notes ?? ''}
          placeholder="Wise: wise.com/pay/… — or any instruction for the client"
          className="input"
        />
      </div>
    </>
  );
}

/**
 * Bank details printed on invoices. The DEFAULT row is used for any currency
 * without its own; only the fields you fill in are printed.
 */
export function PaymentAccountsForm({ accounts }: { accounts: AccountRow[] }) {
  const existing = new Set(accounts.map((a) => a.currency));
  const [adding, setAdding] = useState('');
  const available = CURRENCIES.filter((c) => !existing.has(c.code));
  const blank: AccountRow = {
    currency: '',
    accountName: null,
    bankName: null,
    sortCode: null,
    accountNumber: null,
    iban: null,
    bic: null,
    routingNumber: null,
    notes: null,
  };

  return (
    <div className="space-y-4">
      {!existing.has(DEFAULT_ACCOUNT_KEY) && (
        <form action={savePaymentAccount} className="card grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="currency" value={DEFAULT_ACCOUNT_KEY} />
          <div className="sm:col-span-2 text-sm font-semibold text-slate-300">
            Default details — used for any currency without its own
          </div>
          <AccountFields account={blank} />
          <div className="sm:col-span-2">
            <button className="btn-primary" type="submit">Save default details</button>
          </div>
        </form>
      )}

      {accounts.map((a) => (
        <div key={a.currency} className="card space-y-3">
          <div className="text-sm font-semibold text-slate-300">
            {a.currency === DEFAULT_ACCOUNT_KEY
              ? 'Default details — used for any currency without its own'
              : `${a.currency} details`}
          </div>
          {/* Save and Remove are sibling forms, not nested — HTML forbids nesting,
              and React 18 has no formAction, so one form cannot host both actions. */}
          <form action={savePaymentAccount} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="currency" value={a.currency} />
            <AccountFields account={a} />
            <div className="sm:col-span-2">
              <button className="btn-primary" type="submit">Save</button>
            </div>
          </form>
          <form action={deletePaymentAccount}>
            <input type="hidden" name="currency" value={a.currency} />
            <button className="btn-danger" type="submit">
              Remove {a.currency === DEFAULT_ACCOUNT_KEY ? 'default' : a.currency} details
            </button>
          </form>
        </div>
      ))}

      {available.length > 0 && (
        <form action={savePaymentAccount} className="card grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Add details for another currency</label>
            <select
              name="currency"
              className="input"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              required
            >
              <option value="" disabled>Pick a currency…</option>
              {available.map((c) => (
                <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
              ))}
            </select>
          </div>
          {adding !== '' && (
            <>
              <AccountFields account={blank} />
              <div className="sm:col-span-2">
                <button className="btn-primary" type="submit">Add {adding} details</button>
              </div>
            </>
          )}
        </form>
      )}
    </div>
  );
}
