import type { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { activityIntervals } from '@/lib/db/schema';
import { getSettings } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Interval = z.object({
  sessionId: z.string().min(1),
  cwd: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  activeMs: z.number().int().nonnegative(),
});

const Body = z.object({
  intervals: z.array(Interval).max(5000),
  replace: z.boolean().optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const token = process.env.AGENT_TOKEN;
  const provided = req.headers.get('authorization') ?? '';
  if (!token || provided !== `Bearer ${token}`) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'bad request' }, { status: 400 });
  }
  const { intervals, replace } = parsed.data;
  const db = getDb();

  if (replace) {
    await db.delete(activityIntervals);
  }

  if (intervals.length > 0) {
    await db
      .insert(activityIntervals)
      .values(
        intervals.map((i) => ({
          sessionId: i.sessionId,
          startMs: i.startMs,
          endMs: i.endMs,
          activeMs: i.activeMs,
          cwd: i.cwd,
        })),
      )
      .onConflictDoUpdate({
        target: [activityIntervals.sessionId, activityIntervals.startMs],
        set: {
          endMs: sql`excluded.end_ms`,
          activeMs: sql`excluded.active_ms`,
          cwd: sql`excluded.cwd`,
        },
      });
  }

  const s = await getSettings();
  return Response.json({ ok: true, accepted: intervals.length, idleCapMin: s.defaultIdleCapMin });
}
