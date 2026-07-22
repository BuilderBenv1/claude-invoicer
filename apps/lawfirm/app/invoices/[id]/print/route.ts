import { auth } from '@/lib/auth';
import { getInvoiceDetail } from '@/lib/invoice-service';
import { renderInvoiceHtml } from '@/lib/invoice-doc';
import { localeOf } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await auth();
  if (!session?.user) return new Response('unauthorized', { status: 401 });
  const { id } = await params;
  const detail = await getInvoiceDetail(id);
  if (!detail) return new Response('not found', { status: 404 });
  const html = renderInvoiceHtml(detail, localeOf(detail.settings), { standalone: true });
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
