import type { ActivityInterval, SessionEvent } from './types.js';

export interface TimeEngineOptions {
  /** Gaps longer than this (ms) are treated as idle and contribute 0 active time. */
  idleCapMs: number;
}

/**
 * Convert a stream of session events into contiguous active-time intervals.
 *
 * Algorithm, per session (grouped by sessionId, sorted by time):
 *  - Walk consecutive events. The gap between two events is "active" time iff it
 *    is <= idleCapMs. Longer gaps are idle and break the run.
 *  - A cwd change also breaks the run; the gap leading up to the change is
 *    attributed to the *earlier* event's cwd.
 *  - Concurrent subagent events share the sessionId, so merging into one sorted
 *    timeline naturally avoids double-counting overlapping work.
 *
 * Invariant: every emitted interval satisfies `activeMs === endMs - startMs`.
 */
export function computeIntervals(
  events: SessionEvent[],
  options: TimeEngineOptions,
): ActivityInterval[] {
  const { idleCapMs } = options;

  const bySession = new Map<string, SessionEvent[]>();
  for (const ev of events) {
    const arr = bySession.get(ev.sessionId);
    if (arr) arr.push(ev);
    else bySession.set(ev.sessionId, [ev]);
  }

  const out: ActivityInterval[] = [];
  for (const group of bySession.values()) {
    group.sort((a, b) => a.timestampMs - b.timestampMs);

    let run: ActivityInterval | null = null;
    for (const ev of group) {
      if (run === null) {
        run = newRun(ev);
        continue;
      }
      const gap = ev.timestampMs - run.endMs;
      if (gap > idleCapMs) {
        // Idle: close the run and start fresh at this event.
        out.push(run);
        run = newRun(ev);
      } else if (ev.cwd !== run.cwd) {
        // cwd changed within the cap: the gap belongs to the earlier cwd.
        run.activeMs += gap;
        run.endMs = ev.timestampMs;
        out.push(run);
        run = newRun(ev);
      } else {
        // Same cwd, still active: extend the run.
        run.activeMs += gap;
        run.endMs = ev.timestampMs;
      }
    }
    if (run !== null) out.push(run);
  }

  out.sort((a, b) => a.startMs - b.startMs || (a.sessionId < b.sessionId ? -1 : 1));
  return out;
}

function newRun(ev: SessionEvent): ActivityInterval {
  return {
    sessionId: ev.sessionId,
    cwd: ev.cwd,
    startMs: ev.timestampMs,
    endMs: ev.timestampMs,
    activeMs: 0,
  };
}
