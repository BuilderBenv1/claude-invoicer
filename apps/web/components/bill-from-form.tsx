'use client';

import { useState } from 'react';
import { setFolderBillFrom } from '@/lib/actions';

/**
 * Sets a single folder's "bill from" cutoff. The datetime-local value is
 * converted to epoch ms in the user's own browser timezone, so the cutoff is
 * accurate regardless of the dashboard's configured timezone.
 */
export function BillFromForm({ mappingId, clientId }: { mappingId: string; clientId: string }) {
  const [ms, setMs] = useState('');

  return (
    <form action={setFolderBillFrom} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="mappingId" value={mappingId} />
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="ms" value={ms} />
      <div>
        <label className="label">Exclude time before</label>
        <input
          type="datetime-local"
          className="input"
          onChange={(e) => setMs(e.target.value ? String(new Date(e.target.value).getTime()) : '')}
        />
      </div>
      <button className="btn-ghost" type="submit" name="mode" value="set" disabled={!ms}>
        Set
      </button>
      <button className="btn-ghost" type="submit" name="mode" value="now">
        Now
      </button>
      <button className="btn-danger" type="submit" name="mode" value="clear">
        Clear
      </button>
    </form>
  );
}
