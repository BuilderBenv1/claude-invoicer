export type DeleteCheck = { allowed: true } | { allowed: false; reason: string };

/**
 * A client who has been invoiced can only be archived — deleting them would
 * destroy billing history that has to survive for the accounts.
 */
export function canDeleteClient(clientName: string, invoiceCount: number): DeleteCheck {
  if (invoiceCount > 0) {
    const plural = invoiceCount === 1 ? 'invoice' : 'invoices';
    return {
      allowed: false,
      reason: `${clientName} has ${invoiceCount} ${plural} — archive them instead so the billing record survives.`,
    };
  }
  return { allowed: true };
}

/** Typed-name confirmation: forgiving about case and whitespace, nothing else. */
export function confirmationMatches(typed: string, clientName: string): boolean {
  const norm = (s: string) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const t = norm(typed);
  return t !== '' && t === norm(clientName);
}
