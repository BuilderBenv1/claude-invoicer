import { runWeeklyAutoSend } from '@/lib/invoice-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get('authorization');
    if (header !== `Bearer ${secret}`) return new Response('unauthorized', { status: 401 });
  }
  try {
    const summary = await runWeeklyAutoSend();
    return Response.json(summary);
  } catch (e) {
    console.error('weekly cron failed', e);
    return new Response('cron failed', { status: 500 });
  }
}
