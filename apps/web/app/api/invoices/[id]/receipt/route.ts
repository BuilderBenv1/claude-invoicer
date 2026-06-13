import { auth } from '@/lib/auth';
import { getInvoiceDetail } from '@/lib/queries';
import { renderReceiptPdf } from '@/lib/pdf/render';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await auth();
  if (!session?.user) return new Response('unauthorized', { status: 401 });

  const { id } = await params;
  const detail = await getInvoiceDetail(id);
  if (!detail) return new Response('not found', { status: 404 });
  if (detail.invoice.status !== 'paid') {
    return new Response('receipt available after the invoice is marked paid', { status: 409 });
  }

  const buf = await renderReceiptPdf(detail);
  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${detail.receiptNumber ?? detail.invoice.number}-receipt.pdf"`,
    },
  });
}
