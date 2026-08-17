export interface CurrencyOption {
  code: string;
  symbol: string;
  name: string;
}

/** Currencies offered in the UI. Any other ISO code still works — see currencyOptionsWith. */
export const CURRENCIES: CurrencyOption[] = [
  { code: 'GBP', symbol: '£', name: 'Pound Sterling' },
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc' },
  { code: 'SEK', symbol: 'kr', name: 'Swedish Krona' },
  { code: 'NOK', symbol: 'kr', name: 'Norwegian Krone' },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar' },
  { code: 'AED', symbol: 'AED', name: 'UAE Dirham' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

/**
 * Locale whose conventions suit each currency, so symbols and grouping render
 * the way a recipient in that market expects. Formatting USD under 'en-GB'
 * would print "US$1,234.56"; formatting GBP under 'en-US' prints US grouping.
 */
const LOCALE_BY_CURRENCY: Record<string, string> = {
  GBP: 'en-GB',
  USD: 'en-US',
  EUR: 'en-IE',
  AUD: 'en-AU',
  CAD: 'en-CA',
  CHF: 'de-CH',
  SEK: 'sv-SE',
  NOK: 'nb-NO',
  NZD: 'en-NZ',
  AED: 'en-AE',
  INR: 'en-IN',
  ZAR: 'en-ZA',
};

export function normalizeCurrency(code: string): string {
  return (code ?? '').trim().toUpperCase();
}

export function isKnownCurrency(code: string): boolean {
  return BY_CODE.has(normalizeCurrency(code));
}

export function currencySymbol(code: string): string {
  const c = normalizeCurrency(code);
  return BY_CODE.get(c)?.symbol ?? c;
}

/**
 * Options for a currency <select> given the currently stored value: the
 * catalogue, plus the stored code itself when it predates the catalogue —
 * otherwise saving the form would silently rewrite the client's currency.
 */
export function currencyOptionsWith(code: string): CurrencyOption[] {
  const c = normalizeCurrency(code);
  if (!c || BY_CODE.has(c)) return CURRENCIES;
  return [...CURRENCIES, { code: c, symbol: c, name: c }];
}

/** Money for display. Falls back to "CODE 12.34" for anything Intl rejects. */
export function formatMoney(amount: number, currency: string): string {
  const code = normalizeCurrency(currency);
  try {
    return new Intl.NumberFormat(LOCALE_BY_CURRENCY[code] ?? 'en-GB', {
      style: 'currency',
      currency: code,
    }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}
