'use client';

import { useState } from 'react';
import { deleteClient } from '@/lib/actions';

/**
 * Delete is offered only for clients who have never been invoiced; everyone
 * else shows why not. Confirming requires typing the client's name.
 */
export function DeleteClientForm({
  clientId,
  clientName,
  invoiceCount,
}: {
  clientId: string;
  clientName: string;
  invoiceCount: number;
}) {
  const [open, setOpen] = useState(false);

  if (invoiceCount > 0) {
    return (
      <span
        className="text-xs text-slate-500"
        title={`${clientName} has ${invoiceCount} invoice${invoiceCount === 1 ? '' : 's'} — archive instead.`}
      >
        Invoiced — archive only
      </span>
    );
  }

  if (!open) {
    return (
      <button type="button" className="btn-danger" onClick={() => setOpen(true)}>
        Delete
      </button>
    );
  }

  return (
    <form action={deleteClient} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={clientId} />
      <input
        name="confirmName"
        className="input w-44"
        placeholder={`Type “${clientName}”`}
        aria-label={`Type ${clientName} to confirm deletion`}
        autoFocus
        required
      />
      <button type="submit" className="btn-danger">
        Confirm delete
      </button>
      <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}
