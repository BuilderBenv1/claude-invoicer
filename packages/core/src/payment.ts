import { normalizeCurrency } from './currency.js';

/** The `currency` value of the fallback account used when a currency has no own details. */
export const DEFAULT_ACCOUNT_KEY = 'DEFAULT';

export interface PaymentAccount {
  /** An ISO currency code, or DEFAULT_ACCOUNT_KEY for the fallback. */
  currency: string;
  accountName?: string | null;
  bankName?: string | null;
  sortCode?: string | null;
  accountNumber?: string | null;
  iban?: string | null;
  bic?: string | null;
  routingNumber?: string | null;
  /** Free text, e.g. a Wise link or payment instructions. */
  notes?: string | null;
}

/** Exact currency match, then the default account, then nothing. */
export function resolvePaymentAccount(
  accounts: PaymentAccount[],
  currency: string,
): PaymentAccount | null {
  const want = normalizeCurrency(currency);
  return (
    accounts.find((a) => normalizeCurrency(a.currency) === want) ??
    accounts.find((a) => normalizeCurrency(a.currency) === DEFAULT_ACCOUNT_KEY) ??
    null
  );
}

/**
 * The pay-to block as newline-separated display lines. Blank fields are omitted
 * so no invoice ever prints an empty label, and the payment reference is always
 * last — it is what lets the business match the money to the invoice.
 */
export function renderPaymentBlock(account: PaymentAccount | null, reference: string): string {
  if (!account) return '';
  const lines: string[] = [];
  const push = (label: string, value: string | null | undefined) => {
    const v = (value ?? '').trim();
    if (v) lines.push(label ? `${label}: ${v}` : v);
  };
  push('', account.accountName);
  push('', account.bankName);
  push('Sort code', account.sortCode);
  push('Account number', account.accountNumber);
  push('IBAN', account.iban);
  push('BIC', account.bic);
  push('Routing number', account.routingNumber);
  push('', account.notes);
  push('Payment reference', reference);
  return lines.join('\n');
}
