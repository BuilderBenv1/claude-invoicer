import type { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { milestones } from '@/lib/db/schema';
import { runMilestoneDueSweep } from '@/lib/invoice-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  updates: z
    .array(
      z.object({
        briefId: z.string().min(1),
        key: z.string().min(1).max(16),
        checked: z.boolean(),
      }),
    )
    .max(500),
});

export async function POST(req: NextRequest): Promise<Response> {
  const token = process.env.AGENT_TOKEN;
  const provided = req.headers.get('authorization') ?? '';
  if (!token || provided !== `Bearer ${token}`) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: 'bad request' }, { status: 400 });

  const db = getDb();
  let applied = 0;
  for (const u of parsed.data.updates) {
    // Only pending -> ready. An unticked box is ignored, and invoiced/complete
    // are terminal: the file can never walk a milestone backwards.
    if (!u.checked) continue;
    const res = await db
      .update(milestones)
      .set({ status: 'ready', readyAt: new Date() })
      .where(
        and(
          eq(milestones.briefId, u.briefId),
          eq(milestones.key, u.key),
          eq(milestones.status, 'pending'),
        ),
      )
      .returning({ id: milestones.id });
    applied += res.length;
  }

  const swept = await runMilestoneDueSweep();
  return Response.json({ ok: true, applied, issued: swept.issued });
}
