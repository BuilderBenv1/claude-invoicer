import { runWeeklyAutoSend, runMilestoneDueSweep } from '@/lib/invoice-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get('authorization');
  if (!secret || header !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 });
  }
  try {
    const summary = await runWeeklyAutoSend();
    // Backstop for when the local agent is off: without this a ticked
    // milestone would sit at 'ready' indefinitely.
    const milestones = await runMilestoneDueSweep();
    return Response.json({ ...summary, milestones });
  } catch (e) {
    console.error('weekly cron failed', e);
    return new Response('cron failed', { status: 500 });
  }
}
