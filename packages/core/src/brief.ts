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

/** A cell that restates other rows rather than describing work of its own.
 *  Matched exactly against a normalised (lower-cased, punctuation-stripped)
 *  title: these are header and subtotal CELLS, so a real work item titled
 *  "Total infrastructure overhaul" must survive. Matching a prefix instead of
 *  the whole cell is what wrongly ate that title once before. */
const AGGREGATE_ROW = /^(?:(?:sub\s?)?total|overall|area|work|hours|estimated\s+(?:time|cost))$/i;
/** A heading after which everything restates what came before. */
const SUMMARY_HEADING = /^(overall estimate|summary)\b/i;
/** "1. Moving to the Free + Pro Plans" */
const SECTION_HEADING = /^\d+\.\s+\S/;
/** A section costed in two sentences instead of a table row — "Estimated
 *  time: 2-4 hours" / "Estimated cost: $60-$120" under a heading, with no
 *  `w:tbl` behind it at all. Recognised so the item isn't silently dropped
 *  by the tab-shaped row check below. */
const PROSE_TIME = /^estimated\s+time\s*:/i;
const PROSE_COST = /^estimated\s+cost\s*:/i;

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
 *
 * Not every section is a table, though: one might be costed in two sentences
 * ("Estimated time: 2-4 hours" / "Estimated cost: $60-$120") instead. Those
 * figures are accumulated against the current section heading and turned into
 * one item when the section ends — unless that section already produced a
 * table item, in which case the prose is a restatement of it, not new work.
 */
export function parseBriefText(text: string): ParsedBrief {
  const out: ParsedBrief = { title: '', currency: '', ratePerHour: 0, items: [], warnings: [] };
  let section = '';
  let inSummary = false;
  let sectionHasTableItem = false;
  let proseHours: { low: number; high: number } | null = null;
  let proseMoney: { low: number; high: number } | null = null;
  const skipped: string[] = [];
  const unreadable: string[] = [];

  // Turn whatever prose figures were accumulated for the current section into
  // a work item, called whenever that section ends (a new heading, a summary,
  // or the end of the document).
  const flushProse = () => {
    if (!proseHours && !proseMoney) return;
    if (sectionHasTableItem) {
      out.warnings.push(
        `Ignored the prose total for "${section}" — a table for this section already counted its work.`,
      );
    } else {
      const title = section.replace(/^\d+\.\s+/, '').trim() || section;
      if (!proseHours) out.warnings.push(`No hours found for "${title}" — check it against the estimate.`);
      if (!proseMoney) out.warnings.push(`No cost found for "${title}" — check it against the estimate.`);
      out.items.push({
        section,
        title,
        hoursLow: proseHours?.low ?? 0,
        hoursHigh: proseHours?.high ?? 0,
        amountLow: proseMoney?.low ?? 0,
        amountHigh: proseMoney?.high ?? 0,
      });
    }
    proseHours = null;
    proseMoney = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (!out.title) out.title = line;

    const rate = /rate[:\s]*[£$€]?\s*([\d.,]+)\s*(?:\/|per\s+)h/i.exec(line);
    if (rate && !out.ratePerHour) out.ratePerHour = num(rate[1]!);

    if (SUMMARY_HEADING.test(line)) {
      flushProse();
      inSummary = true;
      out.warnings.push(
        `Ignored everything from "${line}" onwards — a summary restates rows already counted.`,
      );
      continue;
    }
    if (inSummary) continue;

    if (SECTION_HEADING.test(line) && !line.includes('\t')) {
      flushProse();
      section = line;
      sectionHasTableItem = false;
      continue;
    }

    if (!line.includes('\t') && PROSE_TIME.test(line)) {
      const hours = hoursRange(line);
      if (hours) proseHours = hours;
      continue;
    }
    if (!line.includes('\t') && PROSE_COST.test(line)) {
      const money = moneyRange(line);
      if (money) proseMoney = money;
      if (!out.currency) {
        for (const [sym, code] of SYMBOL_CURRENCY) {
          if (line.includes(sym)) {
            out.currency = code;
            break;
          }
        }
      }
      continue;
    }

    const cells = line.split('\t').map((c) => c.trim()).filter(Boolean);
    const title = cells[0] ?? '';
    if (!title) continue;

    const cleaned = title.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (AGGREGATE_ROW.test(cleaned)) {
      skipped.push(title);
      continue;
    }

    // Rows must be tab-delimited to carry hours/cost cells — a title with no
    // tab has nothing left to parse.
    const rest = cells.slice(1).join(' ');
    const hours = hoursRange(rest);
    const money = moneyRange(rest);
    if (!hours && !money) {
      // A row with 2+ cells was still a table row — its figures just didn't
      // parse. That's under-billing if it silently vanishes, so it's reported
      // instead of dropped. A single-cell line (no tab) is prose, not a row.
      if (cells.length >= 2) unreadable.push(title);
      continue;
    }

    if (!out.currency) {
      for (const [sym, code] of SYMBOL_CURRENCY) {
        if (rest.includes(sym)) {
          out.currency = code;
          break;
        }
      }
    }

    if (!hours) out.warnings.push(`No hours found for "${title}" — check it against the estimate.`);
    if (!money) out.warnings.push(`No cost found for "${title}" — check it against the estimate.`);

    out.items.push({
      section,
      title,
      hoursLow: hours?.low ?? 0,
      hoursHigh: hours?.high ?? 0,
      amountLow: money?.low ?? 0,
      amountHigh: money?.high ?? 0,
    });
    sectionHasTableItem = true;
  }
  flushProse();

  if (skipped.length > 0) {
    const shown = skipped.slice(0, 8).join(', ');
    const more = skipped.length > 8 ? ` and ${skipped.length - 8} more` : '';
    out.warnings.push(
      `Skipped ${skipped.length} subtotal or header row${skipped.length === 1 ? '' : 's'} (${shown}${more}) — counting them would double the total.`,
    );
  }
  if (unreadable.length > 0) {
    const shown = unreadable.slice(0, 8).join(', ');
    const more = unreadable.length > 8 ? ` and ${unreadable.length - 8} more` : '';
    out.warnings.push(
      `Couldn't read hours or a cost for: ${shown}${more} — add them by hand or delete the rows.`,
    );
  }
  if (!out.currency) out.currency = 'GBP';
  return out;
}
