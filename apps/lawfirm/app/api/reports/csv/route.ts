import { auth } from '@/lib/auth';
import { buildReport } from '@/lib/queries';
import { getSettings, localeOf } from '@/lib/settings';
import { reportToCsv } from '@/lib/report-format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return new Response('unauthorized', { status: 401 });

  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId') ?? '';
  const projectId = url.searchParams.get('projectId') || null;
  const from = Number(url.searchParams.get('from'));
  const to = Number(url.searchParams.get('to'));
  if (!clientId || !Number.isFinite(from) || !Number.isFinite(to)) {
    return new Response('bad request', { status: 400 });
  }

  const s = await getSettings();
  const report = await buildReport({ clientId, projectId, fromMs: from, toMs: to });
  if (!report) return new Response('not found', { status: 404 });

  const csv = reportToCsv(report, s, localeOf(s));
  const name = `report-${report.client.name}-${new Date(from).toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${encodeURIComponent(name)}"`,
    },
  });
}
