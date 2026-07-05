import { getInvoiceByToken } from '@/lib/queries';
import { renderInvoicePdf } from '@/lib/pdf/render';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const detail = await getInvoiceByToken(token);
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
    console.error('public PDF render failed', e);
    return new Response('Could not generate the invoice PDF.', { status: 500 });
  }
}
