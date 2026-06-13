import { describe, it, expect } from 'vitest';
import { computeIntervals } from '../src/time-engine.js';
import type { SessionEvent } from '../src/types.js';

const MIN = 60_000;
const BASE = Date.UTC(2026, 5, 8, 9, 0, 0); // Mon 2026-06-08 09:00 UTC

function ev(sessionId: string, cwd: string, offsetMin: number): SessionEvent {
  return { sessionId, cwd, timestampMs: BASE + offsetMin * MIN };
}

const CAP = { idleCapMs: 5 * MIN };

describe('computeIntervals', () => {
  it('sums active time between events within the idle cap', () => {
    const out = computeIntervals(
      [ev('s', 'C:/a', 0), ev('s', 'C:/a', 1), ev('s', 'C:/a', 2)],
      CAP,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.activeMs).toBe(2 * MIN);
    expect(out[0]!.startMs).toBe(BASE);
    expect(out[0]!.endMs).toBe(BASE + 2 * MIN);
  });

  it('breaks the run on an idle gap and excludes the idle time', () => {
    const out = computeIntervals(
      [ev('s', 'C:/a', 0), ev('s', 'C:/a', 1), ev('s', 'C:/a', 30), ev('s', 'C:/a', 31)],
      CAP,
    );
    expect(out).toHaveLength(2);
    expect(out[0]!.activeMs).toBe(1 * MIN);
    expect(out[1]!.activeMs).toBe(1 * MIN);
    // the 29-minute idle gap is never counted
    const total = out.reduce((s, i) => s + i.activeMs, 0);
    expect(total).toBe(2 * MIN);
  });

  it('attributes the gap before a cwd change to the earlier cwd', () => {
    const out = computeIntervals(
      [ev('s', 'C:/a', 0), ev('s', 'C:/a', 1), ev('s', 'C:/b', 2), ev('s', 'C:/b', 3)],
      CAP,
    );
    expect(out).toHaveLength(2);
    const a = out.find((i) => i.cwd === 'C:/a')!;
    const b = out.find((i) => i.cwd === 'C:/b')!;
    expect(a.activeMs).toBe(2 * MIN); // includes the gap leading into the cd
    expect(b.activeMs).toBe(1 * MIN);
  });

  it('maintains the invariant activeMs === endMs - startMs', () => {
    const out = computeIntervals(
      [
        ev('s', 'C:/a', 0), ev('s', 'C:/a', 3), ev('s', 'C:/b', 4),
        ev('s', 'C:/b', 40), ev('s', 'C:/b', 41),
      ],
      CAP,
    );
    for (const i of out) expect(i.activeMs).toBe(i.endMs - i.startMs);
  });

  it('does not double-count concurrent (interleaved/duplicate) events in one session', () => {
    // provided shuffled, with a duplicate timestamp (subagent + main at same instant)
    const out = computeIntervals(
      [
        ev('s', 'C:/a', 1),
        ev('s', 'C:/a', 0),
        ev('s', 'C:/a', 0.5),
        ev('s', 'C:/a', 0.5), // duplicate instant
      ],
      CAP,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.activeMs).toBe(1 * MIN);
  });

  it('keeps separate sessions independent', () => {
    const out = computeIntervals(
      [ev('s1', 'C:/a', 0), ev('s1', 'C:/a', 1), ev('s2', 'C:/a', 0), ev('s2', 'C:/a', 2)],
      CAP,
    );
    expect(out).toHaveLength(2);
    const s1 = out.find((i) => i.sessionId === 's1')!;
    const s2 = out.find((i) => i.sessionId === 's2')!;
    expect(s1.activeMs).toBe(1 * MIN);
    expect(s2.activeMs).toBe(2 * MIN);
  });

  it('emits a zero-active interval for a single-event session (folder discovery)', () => {
    const out = computeIntervals([ev('s', 'C:/lonely', 0)], CAP);
    expect(out).toHaveLength(1);
    expect(out[0]!.activeMs).toBe(0);
    expect(out[0]!.cwd).toBe('C:/lonely');
  });
});
