import type { ActivityInterval } from '@claude-invoicer/core';

export interface IngestResponse {
  ok: boolean;
  accepted?: number;
  /** Server requests a full re-scan (e.g. idle cap changed). */
  resync?: boolean;
}

const CHUNK = 1000;

/** POST activity intervals to the dashboard ingest endpoint, chunked. */
export async function uploadIntervals(
  apiBaseUrl: string,
  token: string,
  intervals: ActivityInterval[],
): Promise<IngestResponse> {
  let accepted = 0;
  let resync = false;

  for (let i = 0; i < intervals.length; i += CHUNK) {
    const batch = intervals.slice(i, i + CHUNK);
    const res = await fetch(`${apiBaseUrl}/api/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ intervals: batch }),
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
