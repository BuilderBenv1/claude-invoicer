import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { MilestoneFileItem } from '@claude-invoicer/core';
import { getDb } from './db';
import { briefs, clients, folderMappings, milestones } from './db/schema';

export interface AgentBrief {
  id: string;
  title: string;
  clientName: string;
  folderPath: string;
  billingMode: 'fixed' | 'time';
  currency: string;
  items: MilestoneFileItem[];
}

/**
 * Active briefs that resolve to a real folder, shaped for the agent's file
 * writer. A brief with no folder is omitted — there is nowhere to put the file.
 */
export async function buildAgentBriefs(): Promise<AgentBrief[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: briefs.id,
      title: briefs.title,
      billingMode: briefs.billingMode,
      currency: briefs.currency,
      clientName: clients.name,
      folderPath: folderMappings.path,
    })
    .from(briefs)
    .innerJoin(clients, eq(briefs.clientId, clients.id))
    .innerJoin(folderMappings, eq(briefs.folderMappingId, folderMappings.id))
    .where(and(eq(briefs.status, 'active'), isNotNull(briefs.folderMappingId)));

  // Guard the inArray below, which throws on an empty list.
  if (rows.length === 0) return [];

  // One query for every brief's milestones, grouped in memory. Briefs are few,
  // but a query per brief is still a round trip each on a serverless connection.
  const allMilestones = await db
    .select()
    .from(milestones)
    .where(inArray(milestones.briefId, rows.map((r) => r.id)))
    .orderBy(milestones.idx);

  const byBrief = new Map<string, typeof allMilestones>();
  for (const m of allMilestones) {
    const list = byBrief.get(m.briefId);
    if (list) list.push(m);
    else byBrief.set(m.briefId, [m]);
  }

  return rows.map((b) => ({
    id: b.id,
    title: b.title,
    clientName: b.clientName,
    folderPath: b.folderPath,
    billingMode: b.billingMode === 'fixed' ? ('fixed' as const) : ('time' as const),
    currency: b.currency,
    items: (byBrief.get(b.id) ?? []).map((m) => ({
      key: m.key,
      idx: m.idx,
      title: m.title,
      section: m.section ?? undefined,
      amount: m.amount || undefined,
      hoursLow: m.estimateHoursLow || undefined,
      hoursHigh: m.estimateHoursHigh || undefined,
    })),
  }));
}
