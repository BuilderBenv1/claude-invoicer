'use client';

import { useState } from 'react';
import { setFolderBillFrom } from '@/lib/actions';

/**
 * Sets a single folder's "bill from" cutoff. Date is required; time is optional
 * and defaults to start of day (00:00). The cutoff is computed to epoch ms in the
 * user's own browser timezone. Separate forms per action keep `mode` an explicit
 * hidden field (reliable across server actions).
 */
export function BillFromForm({ mappingId, clientId }: { mappingId: string; clientId: string }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  // Blank time => midnight of the chosen day, so a date alone is enough.
  const ms = date ? String(new Date(`${date}T${time || '00:00'}`).getTime()) : '';

  return (
    <div className="flex flex-wrap items-end gap-2">
      <form action={setFolderBillFrom} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="mappingId" value={mappingId} />
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="mode" value="set" />
        <input type="hidden" name="ms" value={ms} />
        <div>
          <label className="label">Exclude before — date</label>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="label">time (optional)</label>
          <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <button className="btn-ghost" type="submit" disabled={!date}>
          Set
        </button>
      </form>

      <form action={setFolderBillFrom}>
        <input type="hidden" name="mappingId" value={mappingId} />
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="mode" value="now" />
        <button className="btn-ghost" type="submit">
          Now
        </button>
      </form>

      <form action={setFolderBillFrom}>
        <input type="hidden" name="mappingId" value={mappingId} />
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="mode" value="clear" />
        <button className="btn-danger" type="submit">
          Clear
        </button>
      </form>
    </div>
  );
}
