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
