import { getInvoiceByToken } from '@/lib/queries';
import { renderReceiptPdf } from '@/lib/pdf/render';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const detail = await getInvoiceByToken(token);
  if (!detail) return new Response('not found', { status: 404 });
  if (detail.invoice.status !== 'paid') {
    return new Response('receipt available after the invoice is marked paid', { status: 409 });
  }
  try {
    const buf = await renderReceiptPdf(detail);
    return new Response(new Uint8Array(buf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${detail.receiptNumber ?? detail.invoice.number}-receipt.pdf"`,
      },
    });
  } catch (e) {
    console.error('public receipt render failed', e);
    return new Response('Could not generate the receipt PDF.', { status: 500 });
  }
}
