import { runMonthlyAutoSend } from '@/lib/monthly';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get('authorization');
  // Fail closed: if no secret is configured, refuse rather than run open.
  if (!secret || header !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 });
  }
  try {
    const summary = await runMonthlyAutoSend();
    return Response.json(summary);
  } catch (e) {
    console.error('monthly cron failed', e);
    return new Response('cron failed', { status: 500 });
  }
}
