import { round2 } from './billing.js';

/**
 * Divide one pool of tracked hours across several delivered milestones.
 *
 * Time is tracked per folder, not per milestone — nothing knows which of the
 * hours in a folder went to which piece of work. So when several milestones are
 * delivered together, the invoice shows a line each, with the tracked hours
 * split in proportion to what each was estimated at. The client sees what was
 * delivered and what each part cost; the total is still exactly the time really
 * worked, never the estimate.
 *
 * The returned hours always sum to `totalHours` exactly. Rounding each share
 * independently loses or gains a cent — 10 hours across 3 milestones rounds to
 * 3.33 each, totalling 9.99 — so the residual is folded into the largest line,
 * where it is proportionally smallest and cannot push a line negative.
 *
 * Weights are the milestones' estimates. Zero or missing estimates fall back to
 * an even split, since there is no better basis. Negative weights are treated as
 * zero rather than trusted: they would otherwise produce a negative line, which
 * on an invoice reads as a credit.
 */
export function apportionHours(totalHours: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (totalHours <= 0) return new Array(n).fill(0);

  const safe = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const totalWeight = safe.reduce((s, w) => s + w, 0);
  // No usable estimates: every milestone carries the same share.
  const shares = totalWeight > 0 ? safe : new Array(n).fill(1);
  const shareTotal = totalWeight > 0 ? totalWeight : n;

  const out = shares.map((w) => round2((totalHours * w) / shareTotal));

  // Fold the rounding residual into the largest line.
  const residual = round2(totalHours - out.reduce((s, h) => s + h, 0));
  if (residual !== 0) {
    let biggest = 0;
    for (let i = 1; i < n; i++) if (out[i]! > out[biggest]!) biggest = i;
    out[biggest] = round2(out[biggest]! + residual);
    // A residual can only exceed the largest line when every line is ~0, in
    // which case put the whole total on one line rather than emit a negative.
    if (out[biggest]! < 0) {
      out.fill(0);
      out[biggest] = round2(totalHours);
    }
  }
  return out;
}
