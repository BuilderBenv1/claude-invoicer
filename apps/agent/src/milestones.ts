import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  mergeMilestonesFile,
  parseMilestonesFile,
  type MilestoneFileItem,
} from '@claude-invoicer/core';

interface AgentBrief {
  id: string;
  title: string;
  clientName: string;
  folderPath: string;
  billingMode: 'fixed' | 'time';
  currency: string;
  items: MilestoneFileItem[];
}

const FILE_NAME = 'MILESTONES.md';

/**
 * Write each active brief's MILESTONES.md into its folder, then report back any
 * ticked boxes. The merge is append-only, so a file the user has edited or
 * ticked is never rewritten — only new milestones get appended.
 *
 * Every ticked key is re-sent on every scan, not just newly ticked ones. That
 * is deliberate and safe: the server only moves pending -> ready, so a repeat
 * is a no-op, and a tick made while the agent was offline still gets picked up.
 */
export async function syncMilestones(
  apiBaseUrl: string,
  token: string,
): Promise<{ files: number; ticks: number; issued: number }> {
  const res = await fetch(`${apiBaseUrl}/api/agent/briefs`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`brief fetch failed: ${res.status} ${res.statusText}`);
  const { briefs } = (await res.json()) as { briefs: AgentBrief[] };

  const updates: { briefId: string; key: string; checked: boolean }[] = [];
  let files = 0;

  for (const b of briefs) {
    if (!existsSync(b.folderPath)) continue; // folder not on this machine
    const path = join(b.folderPath, FILE_NAME);
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;
    const merged = mergeMilestonesFile(existing, {
      briefTitle: b.title,
      clientName: b.clientName,
      billingMode: b.billingMode,
      currency: b.currency,
      items: b.items,
    });
    if (merged !== existing) {
      writeFileSync(path, merged, 'utf8');
      files++;
    }
    for (const e of parseMilestonesFile(merged)) {
      if (e.checked) updates.push({ briefId: b.id, key: e.key, checked: true });
    }
  }

  if (updates.length === 0) return { files, ticks: 0, issued: 0 };

  const post = await fetch(`${apiBaseUrl}/api/agent/milestones`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ updates }),
  });
  if (!post.ok) throw new Error(`milestone post failed: ${post.status} ${post.statusText}`);
  const json = (await post.json()) as { applied?: number; issued?: number };
  return { files, ticks: json.applied ?? 0, issued: json.issued ?? 0 };
}
