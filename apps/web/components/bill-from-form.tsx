'use client';

import { useState } from 'react';
import { setBillFrom } from '@/lib/actions';

/**
 * Sets a client's "bill from" cutoff. The datetime-local value is converted to
 * epoch ms in the user's own browser timezone, so the cutoff is accurate
 * regardless of the dashboard's configured timezone.
 */
export function BillFromForm({ clientId }: { clientId: string }) {
  const [ms, setMs] = useState('');

  return (
    <form action={setBillFrom} className="card flex flex-wrap items-end gap-2">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="ms" value={ms} />
      <div className="flex-1 min-w-[14rem]">
        <label className="label">Exclude all time before</label>
        <input
          type="datetime-local"
          className="input"
          onChange={(e) => setMs(e.target.value ? String(new Date(e.target.value).getTime()) : '')}
        />
      </div>
      <button className="btn-ghost" type="submit" name="mode" value="set" disabled={!ms}>
        Set cutoff
      </button>
      <button className="btn-primary" type="submit" name="mode" value="now">
        Use now
      </button>
      <button className="btn-danger" type="submit" name="mode" value="clear">
        Clear
      </button>
    </form>
  );
}
