'use client';

import { useState } from 'react';
import { assignFolder } from '@/lib/actions';

export function AssignFolderForm({
  path,
  clients,
}: {
  path: string;
  clients: { id: string; name: string }[];
}) {
  const [isNew, setIsNew] = useState(false);

  return (
    <form action={assignFolder} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="path" value={path} />
      <select
        name="clientId"
        defaultValue=""
        onChange={(e) => setIsNew(e.target.value === '__new__')}
        className="input w-44"
        required
      >
        <option value="" disabled>
          Assign to…
        </option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value="__new__">+ New client…</option>
      </select>
      {isNew && (
        <>
          <input name="newClientName" placeholder="New client name" className="input w-40" required />
          <input
            name="hourlyRate"
            type="number"
            step="0.01"
            placeholder="Rate/hr"
            className="input w-24"
          />
        </>
      )}
      <button type="submit" className="btn-ghost">
        Assign
      </button>
    </form>
  );
}
