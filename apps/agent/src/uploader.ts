import type { ActivityInterval } from '@claude-invoicer/core';

export interface IngestResponse {
  ok: boolean;
  accepted?: number;
  /** Server requests a full re-scan (e.g. idle cap changed). */
  resync?: boolean;
}

const CHUNK = 500;

/**
 * POST activity intervals to the dashboard ingest endpoint, chunked.
 * When `replace` is true the first chunk carries replace=true so the server
 * clears existing rows before re-ingesting the full recomputed set.
 */
export async function uploadIntervals(
  apiBaseUrl: string,
  token: string,
  intervals: ActivityInterval[],
  replace = false,
): Promise<IngestResponse> {
  let accepted = 0;
  let resync = false;

  // Ensure a replace happens even when there are no intervals to send.
  const chunks: ActivityInterval[][] = [];
  for (let i = 0; i < intervals.length; i += CHUNK) chunks.push(intervals.slice(i, i + CHUNK));
  if (chunks.length === 0) chunks.push([]);

  for (let c = 0; c < chunks.length; c++) {
    const batch = chunks[c]!;
    const res = await fetch(`${apiBaseUrl}/api/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ intervals: batch, replace: replace && c === 0 }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`ingest failed: ${res.status} ${res.statusText} ${body}`.trim());
    }
    const json = (await res.json().catch(() => ({}))) as IngestResponse;
    accepted += json.accepted ?? batch.length;
    if (json.resync) resync = true;
  }

  return { ok: true, accepted, resync };
}
