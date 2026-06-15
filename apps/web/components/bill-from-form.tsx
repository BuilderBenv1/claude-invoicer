'use client';

import { useState } from 'react';
import { setFolderBillFrom } from '@/lib/actions';

/**
 * Sets a single folder's "bill from" cutoff. Uses separate forms per action so
 * the `mode` is an explicit hidden field (not dependent on which submit button
 * was clicked, which doesn't reliably reach a server action). The datetime-local
 * value is converted to epoch ms in the user's own browser timezone.
 */
export function BillFromForm({ mappingId, clientId }: { mappingId: string; clientId: string }) {
  const [ms, setMs] = useState('');

  return (
    <div className="flex flex-wrap items-end gap-2">
      <form action={setFolderBillFrom} className="flex items-end gap-2">
        <input type="hidden" name="mappingId" value={mappingId} />
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="mode" value="set" />
        <input type="hidden" name="ms" value={ms} />
        <div>
          <label className="label">Exclude time before</label>
          <input
            type="datetime-local"
            className="input"
            onChange={(e) => setMs(e.target.value ? String(new Date(e.target.value).getTime()) : '')}
          />
        </div>
        <button className="btn-ghost" type="submit" disabled={!ms}>
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
