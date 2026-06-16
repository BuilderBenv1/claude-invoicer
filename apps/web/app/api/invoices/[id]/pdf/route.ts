import { auth } from '@/lib/auth';
import { getInvoiceDetail } from '@/lib/queries';
import { renderInvoicePdf } from '@/lib/pdf/render';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await auth();
  if (!session?.user) return new Response('unauthorized', { status: 401 });

  const { id } = await params;
  const detail = await getInvoiceDetail(id);
  if (!detail) return new Response('not found', { status: 404 });

  try {
    const buf = await renderInvoicePdf(detail);
    return new Response(new Uint8Array(buf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${detail.invoice.number}.pdf"`,
      },
    });
  } catch (e) {
    console.error('PDF render failed', e);
    return new Response('Could not generate the invoice PDF.', { status: 500 });
  }
}
