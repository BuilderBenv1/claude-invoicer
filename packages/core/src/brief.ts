import { round2 } from './billing.js';

export interface ParsedItem {
  section: string;
  title: string;
  hoursLow: number;
  hoursHigh: number;
  amountLow: number;
  amountHigh: number;
}

export interface ParsedBrief {
  title: string;
  currency: string;
  ratePerHour: number;
  items: ParsedItem[];
  /** Rows deliberately skipped, and why — surfaced so nothing vanishes silently. */
  warnings: string[];
}

const DASH = '[\\u2013\\u2014-]';
const SYMBOL_CURRENCY: [string, string][] = [['£', 'GBP'], ['$', 'USD'], ['€', 'EUR']];

/** A row that restates other rows rather than describing work of its own. */
const AGGREGATE_ROW = /^(sub)?total\b|^overall\b|^estimated\s+(time|cost)\b|^area\b|^work$|^hours$/i;
/** A heading after which everything restates what came before. */
const SUMMARY_HEADING = /^(overall estimate|summary)\b/i;
/** "1. Moving to the Free + Pro Plans" */
const SECTION_HEADING = /^\d+\.\s+\S/;

function num(raw: string): number {
  return round2(Number(raw.replace(/,/g, '')));
}

const HOURS_UNIT = 'h(?:rs?|ours?)?\\b';

/** Low/high hours from "2-3 hrs", "2 to 3 hrs" or "4 hrs". Null when absent. */
function hoursRange(text: string): { low: number; high: number } | null {
  const both = new RegExp(`([\\d.,]+)\\s*(?:${DASH}|to)\\s*([\\d.,]+)\\s*${HOURS_UNIT}`, 'i').exec(text);
  if (both) return { low: num(both[1]!), high: num(both[2]!) };
  const one = new RegExp(`([\\d.,]+)\\s*${HOURS_UNIT}`, 'i').exec(text);
  if (!one) return null;
  const v = num(one[1]!);
  return { low: v, high: v };
}

/** Money ranges: "$60-$90", "60-90", "$1,200". Null when absent. */
function moneyRange(text: string): { low: number; high: number } | null {
  const both = new RegExp(
    `[\\u00a3$\\u20ac]\\s*([\\d.,]+)\\s*(?:${DASH}|to)\\s*[\\u00a3$\\u20ac]?\\s*([\\d.,]+)`,
  ).exec(text);
  if (both) return { low: num(both[1]!), high: num(both[2]!) };
  const one = /[£$€]\s*([\d.,]+)/.exec(text);
  if (one) return { low: num(one[1]!), high: num(one[1]!) };
  const bare = new RegExp(`(?:^|\\s)([\\d.,]+)\\s*(?:${DASH}|to)\\s*([\\d.,]+)\\s*$`).exec(text);
  if (bare) return { low: num(bare[1]!), high: num(bare[2]!) };
  const single = /(?:^|\s)([\d.,]+)\s*$/.exec(text);
  return single ? { low: num(single[1]!), high: num(single[1]!) } : null;
}

/**
 * Pull work items out of an estimate. Deterministic — no model call.
 *
 * Real estimates are Word tables of `Work | Estimated time | Estimated cost`
 * with ranges, numbered sections, subtotal rows and a summary table that
 * restates everything. Counting a subtotal as work would double the money, so
 * aggregate rows and everything after a summary heading are skipped — and every
 * skip is reported rather than dropped.
 */
export function parseBriefText(text: string): ParsedBrief {
  const out: ParsedBrief = { title: '', currency: '', ratePerHour: 0, items: [], warnings: [] };
  let section = '';
  let inSummary = false;
  let skippedAggregates = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (!out.title) out.title = line;

    const rate = /rate[:\s]*[£$€]?\s*([\d.,]+)\s*(?:\/|per\s+)h/i.exec(line);
    if (rate && !out.ratePerHour) out.ratePerHour = num(rate[1]!);

    if (SUMMARY_HEADING.test(line)) {
      inSummary = true;
      out.warnings.push(
        `Ignored everything from "${line}" onwards — a summary restates rows already counted.`,
      );
      continue;
    }
    if (inSummary) continue;

    if (SECTION_HEADING.test(line) && !line.includes('\t')) {
      section = line;
      continue;
    }

    const cells = line.split('\t').map((c) => c.trim()).filter(Boolean);
    const title = cells[0] ?? '';
    if (!title) continue;

    if (AGGREGATE_ROW.test(title)) {
      skippedAggregates += 1;
      continue;
    }

    const rest = cells.length > 1 ? cells.slice(1).join(' ') : line.slice(title.length);
    const hours = hoursRange(rest);
    const money = moneyRange(rest);
    if (!hours && !money) continue;

    if (!out.currency) {
      for (const [sym, code] of SYMBOL_CURRENCY) {
        if (rest.includes(sym)) {
          out.currency = code;
          break;
        }
      }
    }

    out.items.push({
      section,
      title,
      hoursLow: hours?.low ?? 0,
      hoursHigh: hours?.high ?? 0,
      amountLow: money?.low ?? 0,
      amountHigh: money?.high ?? 0,
    });
  }

  if (skippedAggregates > 0) {
    out.warnings.push(
      `Skipped ${skippedAggregates} subtotal or header row${skippedAggregates === 1 ? '' : 's'} — counting them would double the total.`,
    );
  }
  if (!out.currency) out.currency = 'GBP';
  return out;
}
