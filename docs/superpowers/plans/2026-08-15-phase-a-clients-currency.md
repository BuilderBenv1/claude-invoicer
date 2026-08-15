# Phase A — Client management & currency — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user delete or archive a client without opening it, pick a currency from a real list instead of typing it, and see exactly how much existing Claude work a folder brings with it when assigning one to a new client.

**Architecture:** All decidable logic (currency catalogue, money formatting, PDF text safety, deletion rules) moves into `packages/core`, which is the only workspace with a test runner — so the rules that must not be wrong are unit-tested. The web app keeps its existing server-action + server-component shape; three duplicated `money()` helpers collapse into one core function.

**Tech Stack:** TypeScript, Next.js 15 App Router (server actions, server components), Drizzle ORM + Neon Postgres, pdf-lib, Tailwind, vitest (core only).

**Spec:** `docs/superpowers/specs/2026-08-14-agency-overhaul-design.md` (sections A1–A4)

## Global Constraints

- **No database migration in this phase.** Every change here uses existing columns. If a task seems to need a new column, stop and re-read the spec — it belongs to Phase B or D.
- **PDF rendering is pdf-lib only.** Never reintroduce `@react-pdf/renderer`; it fails on Next 15 Vercel serverless both bundled and external.
- **Invoices snapshot identity at issue time.** Never write a change that alters an already-issued invoice's stored `currency`, `businessName`, `clientName`, etc.
- **`packages/core` must stay pure** — no DB, no React, no Node built-ins. It is imported by the web app, the PDF renderer, and the local agent.
- **Archived clients stay excluded** from the dashboard stats, weekly billing and the cron. Only the new "Archived" section may show them.
- **No FX conversion.** A client bills in exactly one currency.
- Run `npm test` from the repo root for core tests; `npm --prefix apps/web run typecheck` and `npm --prefix apps/web run build` for the web app.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ
  ```

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/currency.ts` | **Create.** Currency catalogue, code normalisation, money formatting. |
| `packages/core/src/text.ts` | **Create.** `toWinAnsi` — makes arbitrary text safe for pdf-lib's standard fonts. |
| `packages/core/src/client-rules.ts` | **Create.** Delete-vs-archive rule and typed-name confirmation. |
| `packages/core/src/index.ts` | **Modify.** Re-export the three new modules. |
| `packages/core/test/currency.test.ts`, `text.test.ts`, `client-rules.test.ts` | **Create.** Tests for the above. |
| `apps/web/lib/format.ts` | **Modify.** Drop its local `formatMoney`, re-export core's. |
| `apps/web/lib/pdf/render.ts` | **Modify.** Drop its local `money()`; sanitise all drawn text. |
| `apps/web/components/manual-invoice-form.tsx` | **Modify.** Drop its local `money()`. |
| `apps/web/components/currency-select.tsx` | **Create.** The shared currency `<select>`. |
| `apps/web/components/delete-client-form.tsx` | **Create.** Inline typed-name delete confirmation. |
| `apps/web/components/add-client-form.tsx` | **Create.** Add-client form with folder picker and bill-from choice. |
| `apps/web/lib/actions.ts` | **Modify.** `deleteClient`, `unarchiveClient`, extended `createClient`. |
| `apps/web/lib/queries.ts` | **Modify.** Expose `invoiceCount` per client and list archived clients. |
| `apps/web/app/page.tsx` | **Modify.** Card actions, Archived section, new add-client form. |
| `apps/web/app/clients/[id]/page.tsx` | **Modify.** Currency select, Archive + Delete row. |
| `apps/web/app/settings/page.tsx` | **Modify.** Currency select. |

---

### Task 1: Currency catalogue and one shared money formatter

Three copies of `money()` exist today — `lib/format.ts:17`, `lib/pdf/render.ts:17`, `components/manual-invoice-form.tsx:19` — all hardcoding locale `en-US`, so GBP and EUR render with American conventions. This task creates one tested implementation in core and deletes the copies.

**Files:**
- Create: `packages/core/src/currency.ts`
- Create: `packages/core/test/currency.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/web/lib/format.ts:17-23`
- Modify: `apps/web/lib/pdf/render.ts:17-23` (and its call sites at lines 171, 172, 180, 224)
- Modify: `apps/web/components/manual-invoice-form.tsx:19-25`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CURRENCIES: CurrencyOption[]` where `CurrencyOption = { code: string; symbol: string; name: string }`
  - `normalizeCurrency(code: string): string`
  - `isKnownCurrency(code: string): boolean`
  - `currencySymbol(code: string): string`
  - `currencyOptionsWith(code: string): CurrencyOption[]`
  - `formatMoney(amount: number, currency: string): string`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/currency.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  CURRENCIES,
  currencyOptionsWith,
  currencySymbol,
  formatMoney,
  isKnownCurrency,
  normalizeCurrency,
} from '../src/currency.js';

describe('normalizeCurrency', () => {
  it('trims and upper-cases', () => {
    expect(normalizeCurrency(' gbp ')).toBe('GBP');
  });
  it('handles empty input', () => {
    expect(normalizeCurrency('')).toBe('');
  });
});

describe('isKnownCurrency', () => {
  it('knows catalogue codes regardless of case', () => {
    expect(isKnownCurrency('gbp')).toBe(true);
  });
  it('does not know codes outside the catalogue', () => {
    expect(isKnownCurrency('JPY')).toBe(false);
  });
});

describe('currencySymbol', () => {
  it('returns the catalogue symbol', () => {
    expect(currencySymbol('GBP')).toBe('£');
  });
  it('falls back to the code itself', () => {
    expect(currencySymbol('JPY')).toBe('JPY');
  });
});

describe('formatMoney', () => {
  it('renders GBP with a pound sign and UK grouping', () => {
    expect(formatMoney(1234.56, 'GBP')).toBe('£1,234.56');
  });
  it('renders USD with a bare dollar sign, not a country prefix', () => {
    expect(formatMoney(1234.56, 'USD')).toBe('$1,234.56');
  });
  it('accepts lower-case codes', () => {
    expect(formatMoney(10, 'gbp')).toBe(formatMoney(10, 'GBP'));
  });
  it('falls back to "CODE amount" when Intl rejects the currency', () => {
    expect(formatMoney(10, 'NOTACURRENCY')).toBe('NOTACURRENCY 10.00');
  });
  it('renders negative amounts without losing the sign', () => {
    expect(formatMoney(-50, 'GBP')).toContain('50.00');
    expect(formatMoney(-50, 'GBP')).toContain('-');
  });
});

describe('currencyOptionsWith', () => {
  it('returns the catalogue for a known code', () => {
    expect(currencyOptionsWith('GBP')).toHaveLength(CURRENCIES.length);
  });
  it('returns the catalogue for an empty code', () => {
    expect(currencyOptionsWith('')).toHaveLength(CURRENCIES.length);
  });
  it('appends an unknown stored code so editing never rewrites it silently', () => {
    const opts = currencyOptionsWith('JPY');
    expect(opts).toHaveLength(CURRENCIES.length + 1);
    expect(opts.at(-1)).toEqual({ code: 'JPY', symbol: 'JPY', name: 'JPY' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../src/currency.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/currency.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all currency tests green, the existing 39 tests still green.

- [ ] **Step 5: Export from core's index**

In `packages/core/src/index.ts`, add after the `matcher.js` export block:

```ts
export {
  CURRENCIES,
  normalizeCurrency,
  isKnownCurrency,
  currencySymbol,
  currencyOptionsWith,
  formatMoney,
  type CurrencyOption,
} from './currency.js';
```

- [ ] **Step 6: Replace the web app's copy**

In `apps/web/lib/format.ts`, delete the whole local `formatMoney` function (lines 17-23) and add at the top of the file:

```ts
export { formatMoney } from '@claude-invoicer/core';
```

Every existing `import { formatMoney } from '@/lib/format'` keeps working.

- [ ] **Step 7: Replace the PDF renderer's copy**

In `apps/web/lib/pdf/render.ts`, delete the local `money()` function (lines 17-23) and add `formatMoney` to the existing core import:

```ts
import { formatMoney, type WeekProjectDayGrid } from '@claude-invoicer/core';
```

Then replace every `money(` call with `formatMoney(` — there are four, at lines 171, 172, 180 and 224.

- [ ] **Step 8: Replace the manual invoice form's copy**

In `apps/web/components/manual-invoice-form.tsx`, delete the local `money()` function (lines 19-25) and add:

```ts
import { formatMoney } from '@claude-invoicer/core';
```

Then change the one call site (line 140) from `money(total, currency)` to `formatMoney(total, currency)`.

- [ ] **Step 9: Verify the web app compiles**

Run: `npm --prefix apps/web run typecheck`
Expected: no errors.

Run: `npm --prefix apps/web run build`
Expected: build succeeds.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/currency.ts packages/core/test/currency.test.ts packages/core/src/index.ts apps/web/lib/format.ts apps/web/lib/pdf/render.ts apps/web/components/manual-invoice-form.tsx
git commit -m "feat(core): one tested money formatter with a currency catalogue

Collapses three duplicated en-US money() helpers into a single core
function that picks a locale suited to each currency, and adds the
currency catalogue the selectors will use.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 2: Make PDF text safe for pdf-lib's standard fonts

pdf-lib's `StandardFonts.Helvetica` encodes WinAnsi (cp1252) and **throws** on anything outside it. Task 1 makes `formatMoney` emit locale-correct output, and some locales (sv-SE, nb-NO, fr-FR) insert a no-break or narrow no-break space — which would crash PDF generation. Client names and addresses are free text and can already contain anything. One sanitiser at the drawing layer fixes both.

**Files:**
- Create: `packages/core/src/text.ts`
- Create: `packages/core/test/text.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/web/lib/pdf/render.ts` (the `draw` helper at lines 36-49 and the `fit` helper at lines 52-57)

**Interfaces:**
- Consumes: nothing.
- Produces: `toWinAnsi(text: string): string`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/text.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toWinAnsi } from '../src/text.js';

describe('toWinAnsi', () => {
  it('leaves plain ASCII untouched', () => {
    expect(toWinAnsi('Invoice INV-0007')).toBe('Invoice INV-0007');
  });
  it('replaces the no-break spaces Intl emits in some locales', () => {
    expect(toWinAnsi('1\u00A0234,56\u00A0kr')).toBe('1 234,56 kr');
    expect(toWinAnsi('1\u202F234,56')).toBe('1 234,56');
  });
  it('keeps cp1252 characters: accents, curly quotes, dashes, the euro sign', () => {
    expect(toWinAnsi('Café — €10 \u201Cquoted\u201D')).toBe('Café — €10 \u201Cquoted\u201D');
  });
  it('spells out currency symbols cp1252 cannot encode', () => {
    expect(toWinAnsi('₹100')).toBe('INR 100');
  });
  it('replaces anything else it cannot encode', () => {
    expect(toWinAnsi('日本')).toBe('??');
  });
  it('handles an empty string', () => {
    expect(toWinAnsi('')).toBe('');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../src/text.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/text.ts`:

```ts
/** Characters cp1252 adds above ASCII that WinAnsiEncoding can represent. */
const CP1252_EXTRAS =
  '\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D' +
  '\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178';

/** Symbols with no cp1252 representation, spelled out rather than lost. */
const FALLBACKS: [string, string][] = [
  ['\u20B9', 'INR '], // ₹
  ['\u20AA', 'ILS '], // ₪
  ['\u20A9', 'KRW '], // ₩
  ['\u20BA', 'TRY '], // ₺
  ['\u20B4', 'UAH '], // ₴
  ['\u20A6', 'NGN '], // ₦
  ['\u062F.\u0625', 'AED '], // د.إ
];

/** No-break / thin spaces that Intl money formatting inserts. */
const SPACE_LIKE = /[\u00A0\u2007\u2009\u202F\u2060]/g;

/**
 * Make text safe for pdf-lib's StandardFonts, which encode WinAnsi (cp1252)
 * only and THROW on anything else. Applied at the drawing layer so it covers
 * money strings, client names and addresses alike.
 */
export function toWinAnsi(text: string): string {
  let s = text.replace(SPACE_LIKE, ' ');
  for (const [from, to] of FALLBACKS) s = s.split(from).join(to);
  return s.replace(/[^\x20-\x7E\xA1-\xFF]/g, (ch) => (CP1252_EXTRAS.includes(ch) ? ch : '?'));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Export from core's index**

In `packages/core/src/index.ts`, add:

```ts
export { toWinAnsi } from './text.js';
```

- [ ] **Step 6: Apply it in the PDF renderer**

In `apps/web/lib/pdf/render.ts`, add `toWinAnsi` to the core import, then sanitise at the two places text enters the page. In `draw`, replace the body's first line so it reads:

```ts
function draw(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color = INK,
  rightAlignTo?: number,
) {
  const safe = toWinAnsi(text);
  let drawX = x;
  if (rightAlignTo !== undefined) drawX = rightAlignTo - font.widthOfTextAtSize(safe, size);
  page.drawText(safe, { x: drawX, y, size, font, color });
}
```

And in `fit`, sanitise before measuring so the truncation width matches what is drawn:

```ts
function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  let s = toWinAnsi(text);
  if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
  while (s.length > 1 && font.widthOfTextAtSize(s + '…', size) > maxWidth) s = s.slice(0, -1);
  return s + '…';
}
```

- [ ] **Step 7: Verify**

Run: `npm test`
Expected: PASS.

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/text.ts packages/core/test/text.test.ts packages/core/src/index.ts apps/web/lib/pdf/render.ts
git commit -m "fix(pdf): sanitise drawn text to WinAnsi so PDF generation cannot throw

pdf-lib's standard fonts throw on any character outside cp1252. Locale
money formatting emits no-break spaces and client names are free text,
so both could crash invoice rendering.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 3: Currency selector in every form that sets a currency

Three forms currently take a free-text currency: add-client (`app/page.tsx:122`), client settings (`app/clients/[id]/page.tsx:278`), and global defaults (`app/settings/page.tsx:35`). A typo there silently produces an invoice in a currency `Intl` cannot render.

**Files:**
- Create: `apps/web/components/currency-select.tsx`
- Modify: `apps/web/app/page.tsx:120-123`
- Modify: `apps/web/app/clients/[id]/page.tsx:276-279`
- Modify: `apps/web/app/settings/page.tsx:33-36`

**Interfaces:**
- Consumes: `currencyOptionsWith`, `CurrencyOption` from `@claude-invoicer/core` (Task 1).
- Produces: `<CurrencySelect name={string} defaultValue={string} className?={string} />` — a plain server component rendering a `<select>`; safe to use inside client components too, since it imports nothing server-only.

- [ ] **Step 1: Create the component**

Create `apps/web/components/currency-select.tsx`:

```tsx
import { currencyOptionsWith } from '@claude-invoicer/core';

/**
 * Currency picker. `defaultValue` is the stored code; if it predates the
 * catalogue it is appended as an option so saving cannot silently change it.
 */
export function CurrencySelect({
  name,
  defaultValue,
  className = 'input',
}: {
  name: string;
  defaultValue: string;
  className?: string;
}) {
  const options = currencyOptionsWith(defaultValue);
  return (
    <select name={name} defaultValue={defaultValue || 'GBP'} className={className}>
      {options.map((c) => (
        <option key={c.code} value={c.code}>
          {c.symbol === c.code ? c.code : `${c.code} ${c.symbol}`} — {c.name}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Use it in the global settings form**

In `apps/web/app/settings/page.tsx`, add the import:

```tsx
import { CurrencySelect } from '@/components/currency-select';
```

and replace the default-currency block (lines 33-36) with:

```tsx
        <div>
          <label className="label">Default currency</label>
          <CurrencySelect name="defaultCurrency" defaultValue={s.defaultCurrency} />
          <p className="mt-1 text-xs text-slate-500">Used for new clients. Existing clients keep their own.</p>
        </div>
```

- [ ] **Step 3: Use it in the client settings form**

In `apps/web/app/clients/[id]/page.tsx`, add the same import, then replace the currency block (lines 276-279) with:

```tsx
          <div>
            <label className="label">Currency</label>
            <CurrencySelect name="currency" defaultValue={client.currency} />
            <p className="mt-1 text-xs text-slate-500">
              Invoices already issued keep the currency they were issued in.
            </p>
          </div>
```

- [ ] **Step 4: Use it in the add-client form**

In `apps/web/app/page.tsx`, add the same import, then replace the currency block (lines 120-123) with:

```tsx
          <div>
            <label className="label">Currency</label>
            <CurrencySelect name="currency" defaultValue={settings.defaultCurrency} />
          </div>
```

(Task 7 replaces this whole form; this step keeps the page correct in between.)

- [ ] **Step 5: Verify**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/currency-select.tsx apps/web/app/page.tsx apps/web/app/clients/[id]/page.tsx apps/web/app/settings/page.tsx
git commit -m "feat(web): pick currency from a list instead of typing it

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 4: Deletion rules in core

The rule that protects billing history — a client with invoices can only be archived — must not live only in a UI condition. It goes in core with tests, and the server action calls it.

**Files:**
- Create: `packages/core/src/client-rules.ts`
- Create: `packages/core/test/client-rules.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type DeleteCheck = { allowed: true } | { allowed: false; reason: string }`
  - `canDeleteClient(clientName: string, invoiceCount: number): DeleteCheck`
  - `confirmationMatches(typed: string, clientName: string): boolean`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/client-rules.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canDeleteClient, confirmationMatches } from '../src/client-rules.js';

describe('canDeleteClient', () => {
  it('allows deleting a client who has never been invoiced', () => {
    expect(canDeleteClient('Acme', 0)).toEqual({ allowed: true });
  });
  it('blocks a client with one invoice, in the singular', () => {
    const res = canDeleteClient('Acme', 1);
    expect(res.allowed).toBe(false);
    expect(res.allowed === false && res.reason).toContain('1 invoice —');
    expect(res.allowed === false && res.reason).toContain('Acme');
  });
  it('blocks a client with several invoices, in the plural', () => {
    const res = canDeleteClient('Acme', 3);
    expect(res.allowed === false && res.reason).toContain('3 invoices');
  });
});

describe('confirmationMatches', () => {
  it('accepts the exact name', () => {
    expect(confirmationMatches('Acme Ltd', 'Acme Ltd')).toBe(true);
  });
  it('forgives case and surrounding whitespace', () => {
    expect(confirmationMatches('  acme ltd  ', 'Acme Ltd')).toBe(true);
  });
  it('forgives collapsed inner whitespace', () => {
    expect(confirmationMatches('Acme   Ltd', 'Acme Ltd')).toBe(true);
  });
  it('rejects a different name', () => {
    expect(confirmationMatches('Acme', 'Acme Ltd')).toBe(false);
  });
  it('rejects an empty confirmation even for an empty name', () => {
    expect(confirmationMatches('', '')).toBe(false);
    expect(confirmationMatches('   ', 'Acme')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../src/client-rules.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/client-rules.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Export from core's index**

In `packages/core/src/index.ts`, add:

```ts
export { canDeleteClient, confirmationMatches, type DeleteCheck } from './client-rules.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/client-rules.ts packages/core/test/client-rules.test.ts packages/core/src/index.ts
git commit -m "feat(core): delete-vs-archive rule and typed-name confirmation

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 5: Delete a client from the dashboard

**Files:**
- Modify: `apps/web/lib/queries.ts` (`ClientStat` at 180-188, `getOverview` at 198-226, `ClientDetail` at 228-238, `getClientDetail` at 240-264)
- Modify: `apps/web/lib/actions.ts` (add `deleteClient` after `archiveClient` at line 73)
- Create: `apps/web/components/delete-client-form.tsx`
- Modify: `apps/web/app/page.tsx` (client card, around lines 33-77)
- Modify: `apps/web/app/clients/[id]/page.tsx` (the archive form at lines 303-308)

**Interfaces:**
- Consumes: `canDeleteClient`, `confirmationMatches` from `@claude-invoicer/core` (Task 4).
- Produces:
  - `deleteClient(fd: FormData): Promise<void>` — server action; form fields `id`, `confirmName`.
  - `ClientStat.invoiceCount: number` and `ClientDetail.invoiceCount: number`.
  - `<DeleteClientForm clientId={string} clientName={string} invoiceCount={number} />`

- [ ] **Step 1: Expose the invoice count from the queries**

In `apps/web/lib/queries.ts`, add `invoiceCount: number;` to the `ClientStat` interface and to the `ClientDetail` interface.

In `getOverview`, inside the `clientRows.map` callback, add before the `return`:

```ts
    const invoiceCount = invoiceRows.filter((inv) => inv.clientId === client.id).length;
```

and add `invoiceCount,` to the returned object.

In `getClientDetail`, add before its `return`:

```ts
  const invoiceCount = invoiceRows.filter((inv) => inv.clientId === clientId).length;
```

and add `invoiceCount,` to the returned object.

- [ ] **Step 2: Write the server action**

In `apps/web/lib/actions.ts`, extend the core import on line 6 to include the rules:

```ts
import { canDeleteClient, confirmationMatches, normalizePath, round2, weekRange } from '@claude-invoicer/core';
```

Then add after `archiveClient`:

```ts
/**
 * Permanently delete a client. Only clients who have never been invoiced can be
 * deleted; anyone else must be archived so the billing record survives. Folder
 * mappings, one-off charges and week adjustments cascade; the raw activity
 * intervals are kept and their folders simply return to the unassigned pool.
 */
export async function deleteClient(fd: FormData): Promise<void> {
  const id = str(fd, 'id');
  if (!id) throw new Error('Missing client id');
  const db = getDb();

  await db.transaction(async (tx) => {
    const [client] = await tx.select().from(clients).where(eq(clients.id, id));
    if (!client) throw new Error('Client not found');

    const clientInvoices = await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.clientId, id));
    const check = canDeleteClient(client.name, clientInvoices.length);
    if (!check.allowed) throw new Error(check.reason);

    if (!confirmationMatches(str(fd, 'confirmName'), client.name)) {
      throw new Error(`Type “${client.name}” exactly to confirm deletion.`);
    }

    // An invoice created between the check and this delete makes the foreign
    // key reject the statement, which is the safe outcome.
    await tx.delete(clients).where(eq(clients.id, id));
  });

  revalidatePath('/');
  redirect('/');
}
```

- [ ] **Step 3: Build the confirmation component**

Create `apps/web/components/delete-client-form.tsx`:

```tsx
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
```

- [ ] **Step 4: Put the actions on the dashboard client card**

In `apps/web/app/page.tsx`, add the imports:

```tsx
import { issueInvoice, createClient, archiveClient } from '@/lib/actions';
import { DeleteClientForm } from '@/components/delete-client-form';
```

Destructure `invoiceCount` in the card map — the callback signature becomes:

```tsx
            {stats.map(({ client, thisWeekMs, thisWeekAmount, thisWeekBilled, unbilledWeeks, oneOffTotal, invoiceCount }) => (
```

and replace the card's footer row (currently lines 71-76) with:

```tsx
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span>{oneOffTotal > 0 ? `+ ${formatMoney(oneOffTotal, client.currency)} one-off charges` : ''}</span>
                  <div className="flex items-center gap-2">
                    <Link href={`/clients/${client.id}`} className="hover:underline">
                      All weeks →
                    </Link>
                    <form action={archiveClient}>
                      <input type="hidden" name="id" value={client.id} />
                      <button className="btn-ghost" type="submit">
                        Archive
                      </button>
                    </form>
                    <DeleteClientForm
                      clientId={client.id}
                      clientName={client.name}
                      invoiceCount={invoiceCount}
                    />
                  </div>
                </div>
```

- [ ] **Step 5: Put the same actions on the client detail page**

In `apps/web/app/clients/[id]/page.tsx`, add `import { DeleteClientForm } from '@/components/delete-client-form';`, destructure `invoiceCount` from `detail` on line 26, and replace the standalone archive form (lines 303-308) with:

```tsx
        <div className="flex flex-wrap items-center gap-3">
          <form action={archiveClient}>
            <input type="hidden" name="id" value={client.id} />
            <button className="btn-ghost" type="submit">
              Archive client
            </button>
          </form>
          <DeleteClientForm clientId={client.id} clientName={client.name} invoiceCount={invoiceCount} />
        </div>
```

- [ ] **Step 6: Verify**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed.

- [ ] **Step 7: Manual check against a preview deploy**

Phase A needs no migration, so push the branch and let Vercel build a preview. On it: create a throwaway client, confirm **Delete** appears on its dashboard card, confirm typing the wrong name is rejected, confirm typing the right name removes it. Then confirm an invoiced client shows "Invoiced — archive only" instead of a Delete button.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/queries.ts apps/web/lib/actions.ts apps/web/components/delete-client-form.tsx apps/web/app/page.tsx "apps/web/app/clients/[id]/page.tsx"
git commit -m "feat(web): delete a client from the dashboard, guarded by invoice history

Delete is offered inline on the client card and detail page, enabled only
for clients who have never been invoiced, and requires typing the client
name. Everyone else is archive-only.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 6: Archive is currently a one-way trip — add restore

`archiveClient` sets `archived = 1` and every query filters `archived = 0`, so an archived client disappears with no way back.

**Files:**
- Modify: `apps/web/lib/queries.ts` (`OverviewData` at 190-196, `getOverview` at 198-226)
- Modify: `apps/web/lib/actions.ts` (after `archiveClient`)
- Modify: `apps/web/app/page.tsx` (new section after the clients section)

**Interfaces:**
- Consumes: `deleteClient` and `<DeleteClientForm>` (Task 5).
- Produces:
  - `unarchiveClient(fd: FormData): Promise<void>` — form field `id`.
  - `OverviewData.archived: { client: Client; invoiceCount: number }[]`

- [ ] **Step 1: Return archived clients from the overview query**

In `apps/web/lib/queries.ts`, add to the `OverviewData` interface:

```ts
  archived: { client: Client; invoiceCount: number }[];
```

In `getOverview`, after the `stats` computation and before the `return`, add:

```ts
  const db = getDb();
  const archivedRows = await db.select().from(clients).where(eq(clients.archived, 1)).orderBy(clients.name);
  const archived = archivedRows.map((client) => ({
    client,
    invoiceCount: invoiceRows.filter((inv) => inv.clientId === client.id).length,
  }));
```

and add `archived,` to the returned object.

- [ ] **Step 2: Write the restore action**

In `apps/web/lib/actions.ts`, add after `archiveClient`:

```ts
export async function unarchiveClient(fd: FormData): Promise<void> {
  const id = str(fd, 'id');
  if (!id) throw new Error('Missing client id');
  const db = getDb();
  await db.update(clients).set({ archived: 0 }).where(eq(clients.id, id));
  revalidatePath('/');
  revalidatePath('/clients/' + id);
}
```

- [ ] **Step 3: Render the archived section**

In `apps/web/app/page.tsx`, destructure `archived` from `getOverview()`, import `unarchiveClient`, and add this section immediately after the closing `</section>` of the Clients block:

```tsx
      {/* Archived clients */}
      {archived.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Archived ({archived.length})
          </h2>
          <p className="text-xs text-slate-500">
            Archived clients are excluded from billing, the dashboard totals and the weekly auto-send.
          </p>
          <div className="space-y-2">
            {archived.map(({ client, invoiceCount }) => (
              <div key={client.id} className="card flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link href={`/clients/${client.id}`} className="truncate hover:underline">
                    {client.name}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {invoiceCount > 0 ? `${invoiceCount} invoice${invoiceCount === 1 ? '' : 's'}` : 'never invoiced'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <form action={unarchiveClient}>
                    <input type="hidden" name="id" value={client.id} />
                    <button className="btn-ghost" type="submit">
                      Restore
                    </button>
                  </form>
                  <DeleteClientForm
                    clientId={client.id}
                    clientName={client.name}
                    invoiceCount={invoiceCount}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
```

- [ ] **Step 4: Verify**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed.

- [ ] **Step 5: Manual check**

On the preview deploy: archive a client, confirm it leaves the Clients grid and appears under Archived, confirm Restore returns it to the grid with its weeks intact.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/queries.ts apps/web/lib/actions.ts apps/web/app/page.tsx
git commit -m "feat(web): archived clients are listed and can be restored

Archiving was a one-way trip with no UI to undo it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

### Task 7: Assign a folder while adding the client, and show what it picks up

Assigning a folder already bills all of its history and every subfolder — `matchClientId` is longest-prefix, the agent uploads every folder regardless of mapping, and `billFromMs` defaults to 0. The gap is that the add-client form has no folder field, so the user adds a client and then has to hunt through the unassigned list. This task puts the picker in the form, annotated with the time each folder brings.

**Files:**
- Create: `apps/web/components/add-client-form.tsx`
- Modify: `apps/web/lib/actions.ts` (`createClient` at lines 29-45)
- Modify: `apps/web/app/page.tsx` (the add-client section at lines 108-130)

**Interfaces:**
- Consumes: `<CurrencySelect>` (Task 3), `formatDuration` and `formatDate` from `@/lib/format`, `OverviewData.unassigned` (existing).
- Produces:
  - `createClient` additionally accepts `path`, `label`, `billFrom` (`'all' | 'today'`) and redirects to the new client's page.
  - `<AddClientForm unassigned={{ cwd: string; activeMs: number; lastSeenMs: number }[]} defaultCurrency={string} timezone={string} />`

- [ ] **Step 1: Extend the createClient action**

In `apps/web/lib/actions.ts`, replace `createClient` (lines 29-45) with:

```ts
/**
 * Create a client, optionally mapping a folder in the same transaction. The
 * mapping picks up every interval already tracked under that folder and its
 * subfolders; `billFrom=today` sets a cutoff so only future work is billed.
 */
export async function createClient(fd: FormData): Promise<void> {
  const name = str(fd, 'name');
  if (!name) throw new Error('Client name is required');
  const rawPath = str(fd, 'path');
  const db = getDb();
  const s = await getSettings();
  const id = newId();

  await db.transaction(async (tx) => {
    await tx.insert(clients).values({
      id,
      name,
      hourlyRate: num(fd, 'hourlyRate'),
      currency: str(fd, 'currency') || s.defaultCurrency,
      email: str(fd, 'email') || null,
      address: str(fd, 'address') || null,
    });

    if (rawPath) {
      const billFromMs = str(fd, 'billFrom') === 'today' ? Date.now() : 0;
      const label = str(fd, 'label') || null;
      await tx
        .insert(folderMappings)
        .values({ id: newId(), clientId: id, path: normalizePath(rawPath), label, billFromMs })
        .onConflictDoUpdate({
          target: folderMappings.path,
          set: { clientId: id, label, billFromMs },
        });
    }
  });

  revalidatePath('/');
  revalidatePath('/clients/' + id);
  redirect('/clients/' + id);
}
```

- [ ] **Step 2: Build the form component**

Create `apps/web/components/add-client-form.tsx`:

```tsx
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
          <input name="path" placeholder="C:\\Users\\you\\work\\acme" className="input" required />
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
              Bill from today only — earlier time in this folder is excluded
            </label>
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
```

Note the `name={choice === TYPE_IT ? undefined : 'path'}` on the select: when "Type a folder path…" is chosen the select stops submitting a value, so the text input owns the `path` field and the sentinel never reaches the server.

- [ ] **Step 3: Use it on the dashboard**

In `apps/web/app/page.tsx`, import it:

```tsx
import { AddClientForm } from '@/components/add-client-form';
```

and replace the whole "Add a client" section (lines 108-130) with:

```tsx
      {/* Add client */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Add a client</h2>
        <p className="text-xs text-slate-500">
          Assigning a folder picks up everything already tracked in it and its subfolders.
        </p>
        <AddClientForm
          unassigned={unassigned}
          defaultCurrency={settings.defaultCurrency}
          timezone={settings.timezone}
        />
      </section>
```

- [ ] **Step 4: Verify**

Run: `npm --prefix apps/web run typecheck && npm --prefix apps/web run build`
Expected: both succeed.

- [ ] **Step 5: Manual check**

On the preview deploy: add a client choosing a folder that has tracked time, confirm the radio shows that folder's hours, confirm you land on the new client's page and its weeks are already populated with the historical work. Repeat with "Bill from today only" and confirm the client page shows the folder's "excluding time before …" note and no historical weeks.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/add-client-form.tsx apps/web/lib/actions.ts apps/web/app/page.tsx
git commit -m "feat(web): assign a folder while adding a client, showing what it picks up

The folder picker lists unassigned folders with the time already tracked
in each, and a bill-from choice decides whether that history is billed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JmizUQGN7diFmwtTA6wPnZ"
```

---

## Phase A completion checklist

- [ ] `npm test` — core tests green (39 existing + the new currency, text and client-rules suites)
- [ ] `npm --prefix apps/web run typecheck` — clean
- [ ] `npm --prefix apps/web run build` — clean
- [ ] No `money(` helper remains in `apps/web` (`grep -rn "style: 'currency'" apps/web` returns nothing)
- [ ] Preview deploy verified: delete a never-invoiced client; delete blocked for an invoiced one; archive + restore; add a client with a folder and see its history
- [ ] No SQL migration was needed — confirm `apps/web/drizzle/` is unchanged
