import { currencySymbol } from './currency.js';

/** One milestone as it appears in the file. */
export interface MilestoneFileItem {
  key: string;
  idx: number;
  title: string;
  section?: string;
  /** Fixed-price briefs: the agreed amount. */
  amount?: number;
  /** Time & materials briefs: the estimate range, shown as a target only. */
  hoursLow?: number;
  hoursHigh?: number;
}

export interface MilestoneFileInput {
  briefTitle: string;
  clientName: string;
  billingMode: 'fixed' | 'time';
  currency: string;
  items: MilestoneFileItem[];
}

export interface MilestoneFileEntry {
  key: string;
  checked: boolean;
}

/**
 * A checklist line carrying an id comment. The id is what makes a line a
 * milestone — a checklist line the user typed by hand has none and is ignored,
 * so their own todos in this file are never mistaken for billable work.
 */
export const MILESTONE_LINE_RE =
  /^\s*[-*]\s*\[([ xX])\]\s*.*?<!--\s*id:([A-Za-z0-9]{4,16})\s*-->/;

function formatAmount(amount: number, currency: string): string {
  // Deliberately not formatMoney: this is plain text a human edits, so it uses
  // a bare grouped number rather than locale-specific currency placement.
  const sym = currencySymbol(currency);
  const [int, frac] = (Math.round(amount * 100) / 100).toFixed(2).split('.') as [string, string];
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === '00' ? `${sym}${grouped}` : `${sym}${grouped}.${frac}`;
}

function formatHours(low?: number, high?: number): string {
  if (low == null && high == null) return '';
  const lo = low ?? high ?? 0;
  const hi = high ?? low ?? 0;
  return lo === hi ? `${lo} hrs` : `${lo}–${hi} hrs`;
}

/** The trailing detail after the title: money for fixed, an hours range for T&M. */
function itemSuffix(item: MilestoneFileItem, input: MilestoneFileInput): string {
  if (input.billingMode === 'fixed') {
    return item.amount ? ` — ${formatAmount(item.amount, input.currency)}` : '';
  }
  const hrs = formatHours(item.hoursLow, item.hoursHigh);
  return hrs ? ` — ${hrs}` : '';
}

function renderLine(item: MilestoneFileItem, input: MilestoneFileInput): string {
  return `- [ ] M${item.idx + 1} · ${item.title}${itemSuffix(item, input)} <!-- id:${item.key} -->`;
}

/** The whole file, from scratch. Used when no file exists yet. */
export function renderMilestonesFile(input: MilestoneFileInput): string {
  const mode =
    input.billingMode === 'fixed'
      ? 'Each milestone is invoiced at its agreed amount when ticked.'
      : 'Each milestone invoices the time tracked against this folder since the last one.';
  return [
    `# ${input.briefTitle}`,
    '',
    `Milestones for ${input.clientName}. Tick a box when the milestone is delivered —`,
    'it is picked up automatically and invoiced.',
    '',
    mode,
    '',
    ...input.items.map((it) => renderLine(it, input)),
    '',
  ].join('\n');
}

/** Every milestone line in the file, in file order. First occurrence of a key wins. */
export function parseMilestonesFile(text: string): MilestoneFileEntry[] {
  const out: MilestoneFileEntry[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = MILESTONE_LINE_RE.exec(line);
    if (!m) continue;
    const key = m[2]!;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, checked: m[1] !== ' ' });
  }
  return out;
}

/**
 * Append-only merge. An existing file is never rewritten: lines for keys it
 * already carries are left exactly as they are, whatever the user did to them,
 * and only genuinely new keys are added. This is what makes it impossible for
 * a sync to clobber a tick.
 *
 * New lines go directly after the last existing milestone line rather than at
 * the end of the file, so the list stays together when the user has written
 * notes below it. That still touches no existing line — it only chooses where
 * new ones land. Line endings follow whatever the file already uses, so an
 * editor that saved CRLF does not end up with a mixed-ending file.
 */
export function mergeMilestonesFile(existing: string | null, input: MilestoneFileInput): string {
  if (!existing || !existing.trim()) return renderMilestonesFile(input);
  const present = new Set(parseMilestonesFile(existing).map((e) => e.key));
  const missing = input.items.filter((it) => !present.has(it.key));
  if (missing.length === 0) return existing;

  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const lines = existing.split(/\r?\n/);
  const newLines = missing.map((it) => renderLine(it, input));

  let lastMilestone = -1;
  for (let i = 0; i < lines.length; i++) {
    if (MILESTONE_LINE_RE.test(lines[i]!)) lastMilestone = i;
  }
  if (lastMilestone === -1) {
    // No milestone lines to sit beside — fall back to the end of the file.
    return [existing.replace(/\s*$/, ''), '', ...newLines, ''].join(eol);
  }
  lines.splice(lastMilestone + 1, 0, ...newLines);
  return lines.join(eol);
}
