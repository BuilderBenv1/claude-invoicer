'use client';

import { useState } from 'react';
import { createClient } from '@/lib/actions';
import { CurrencySelect } from '@/components/currency-select';
import { formatDate, formatDuration } from '@/lib/format';

interface UnassignedFolder {
  cwd: string;
  activeMs: number;
  lastSeenMs: number;
}

const TYPE_IT = '__type__';

/** Midnight today in the browser's own timezone — the server (UTC) cannot know this. */
function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Add a client and, optionally, their folder in one go. Folders are listed with
 * the time already tracked in them, so the user can see what the new client
 * picks up before saving.
 */
export function AddClientForm({
  unassigned,
  defaultCurrency,
  timezone,
}: {
  unassigned: UnassignedFolder[];
  defaultCurrency: string;
  timezone: string;
}) {
  const [choice, setChoice] = useState('');
  const picked = unassigned.find((f) => f.cwd === choice);

  return (
    <form action={createClient} className="card grid gap-3 sm:grid-cols-4">
      <div className="sm:col-span-2">
        <label className="label">Name</label>
        <input name="name" className="input" required />
      </div>
      <div>
        <label className="label">Rate / hr</label>
        <input name="hourlyRate" type="number" step="0.01" defaultValue={0} className="input" />
      </div>
      <div>
        <label className="label">Currency</label>
        <CurrencySelect name="currency" defaultValue={defaultCurrency} />
      </div>

      <div className="sm:col-span-4">
        <label className="label">Folder (optional)</label>
        <select
          className="input"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          name={choice === TYPE_IT ? undefined : 'path'}
        >
          <option value="">No folder yet — assign one later</option>
          {unassigned.map((f) => (
            <option key={f.cwd} value={f.cwd}>
              {f.cwd} · {formatDuration(f.activeMs)} tracked · last {formatDate(f.lastSeenMs, timezone)}
            </option>
          ))}
          <option value={TYPE_IT}>Type a folder path…</option>
        </select>
      </div>

      {choice === TYPE_IT && (
        <div className="sm:col-span-4">
          <label className="label">Folder path</label>
          <input name="path" placeholder="C:\Users\you\work\acme" className="input" required />
        </div>
      )}

      {choice !== '' && (
        <>
          <div className="sm:col-span-4">
            <label className="label">Folder label (optional)</label>
            <input name="label" placeholder="Website rebuild" className="input" />
          </div>
          <fieldset className="sm:col-span-4 space-y-1">
            <legend className="label">Existing work in this folder</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="billFrom" value="all" defaultChecked />
              Bill all past work
              {picked ? ` — ${formatDuration(picked.activeMs)} already tracked` : ''}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="billFrom" value="today" />
              Bill from the start of today — earlier time in this folder is excluded
            </label>
            <input type="hidden" name="todayStartMs" value={startOfTodayMs()} />
          </fieldset>
        </>
      )}

      <div className="sm:col-span-4">
        <button className="btn-primary" type="submit">
          Add client
        </button>
      </div>
    </form>
  );
}
