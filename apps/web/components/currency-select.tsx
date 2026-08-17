import { currencyOptionsWith, normalizeCurrency } from '@claude-invoicer/core';

/**
 * Currency picker. `defaultValue` is the stored code; if it predates the
 * catalogue it is appended as an option so saving cannot silently change it.
 * The `<select>` is given the normalised (trimmed, upper-cased) value so it
 * always matches an `<option>` — every rendered option is normalised too,
 * and an unmatched value would make the browser silently fall back to the
 * first option (GBP), which the next save would then overwrite the real
 * stored currency with.
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
    <select name={name} defaultValue={normalizeCurrency(defaultValue) || 'GBP'} className={className}>
      {options.map((c) => (
        <option key={c.code} value={c.code}>
          {c.symbol === c.code ? c.code : `${c.code} ${c.symbol}`} — {c.name}
        </option>
      ))}
    </select>
  );
}
