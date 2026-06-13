import type { SessionEvent } from '@claude-invoicer/core';

interface RawRecord {
  type?: string;
  cwd?: string;
  timestamp?: string;
  sessionId?: string;
}

export interface ParseResult {
  events: SessionEvent[];
  errors: number;
}

/**
 * Parse a JSONL transcript into session events. Any record that carries both a
 * `cwd` and a parseable `timestamp` is an activity signal; records without them
 * (summaries, mode markers, snapshots) are ignored. Malformed lines are counted.
 */
export function parseTranscript(content: string, fallbackSessionId: string): ParseResult {
  const events: SessionEvent[] = [];
  let errors = 0;

  for (const line of content.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let rec: RawRecord;
    try {
      rec = JSON.parse(s) as RawRecord;
    } catch {
      errors++;
      continue;
    }
    if (!rec.timestamp || !rec.cwd) continue;
    const ts = Date.parse(rec.timestamp);
    if (Number.isNaN(ts)) continue;
    events.push({
      sessionId: rec.sessionId ?? fallbackSessionId,
      cwd: rec.cwd,
      timestampMs: ts,
    });
  }

  return { events, errors };
}
