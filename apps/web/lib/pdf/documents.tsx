import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import type { Invoice, InvoiceLine } from '../db/schema';

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
function day(d: Date | string | number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: 'short', day: '2-digit' }).format(
    new Date(d),
  );
}

const styles = StyleSheet.create({
  page: { padding: 44, fontSize: 10, color: '#1b2333', fontFamily: 'Helvetica' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  title: { fontSize: 26, fontFamily: 'Helvetica-Bold' },
  badge: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#475569' },
  muted: { color: '#64748b' },
  block: { marginTop: 18 },
  label: { fontSize: 8, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3, letterSpacing: 1 },
  strong: { fontFamily: 'Helvetica-Bold' },
  hr: { borderBottomWidth: 1, borderBottomColor: '#e2e8f0', marginVertical: 14 },
  th: { flexDirection: 'row', backgroundColor: '#f1f5f9', paddingVertical: 6, paddingHorizontal: 8 },
  td: { flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#eef2f7' },
  cDesc: { flex: 1 },
  cNum: { width: 70, textAlign: 'right' },
  cAmt: { width: 90, textAlign: 'right' },
  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
  totalBox: { width: 200 },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  grand: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  footer: { position: 'absolute', bottom: 30, left: 44, right: 44, fontSize: 8, color: '#94a3b8', textAlign: 'center' },
  paid: { color: '#16a34a', fontFamily: 'Helvetica-Bold', fontSize: 13 },
});

function Party({ label, name, email, address }: { label: string; name: string; email?: string | null; address?: string | null }) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.strong}>{name}</Text>
      {email ? <Text style={styles.muted}>{email}</Text> : null}
      {address ? <Text style={styles.muted}>{address}</Text> : null}
    </View>
  );
}

export function InvoiceDoc({
  invoice,
  lines,
  timezone,
}: {
  invoice: Invoice;
  lines: InvoiceLine[];
  timezone: string;
}) {
  const totalHours = lines.reduce((s, l) => s + l.hours, 0);
  return (
    <Document title={invoice.number}>
      <Page size="A4" style={styles.page}>
        <View style={styles.row}>
          <View>
            <Text style={styles.title}>INVOICE</Text>
            <Text style={styles.muted}>{invoice.number}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.strong}>{invoice.businessName}</Text>
            {invoice.businessEmail ? <Text style={styles.muted}>{invoice.businessEmail}</Text> : null}
            {invoice.businessAddress ? <Text style={styles.muted}>{invoice.businessAddress}</Text> : null}
            {invoice.taxId ? <Text style={styles.muted}>Tax ID: {invoice.taxId}</Text> : null}
          </View>
        </View>

        <View style={styles.hr} />

        <View style={styles.row}>
          <Party label="Bill to" name={invoice.clientName} email={invoice.clientEmail} address={invoice.clientAddress} />
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.label}>Issued</Text>
            <Text>{day(invoice.issuedAt, timezone)}</Text>
            <Text style={[styles.label, { marginTop: 8 }]}>Status</Text>
            <Text style={invoice.status === 'paid' ? styles.paid : styles.badge}>
              {invoice.status.toUpperCase()}
            </Text>
          </View>
        </View>

        <View style={styles.block}>
          <View style={styles.th}>
            <Text style={[styles.cDesc, styles.strong]}>Description</Text>
            <Text style={[styles.cNum, styles.strong]}>Hours</Text>
            <Text style={[styles.cNum, styles.strong]}>Rate</Text>
            <Text style={[styles.cAmt, styles.strong]}>Amount</Text>
          </View>
          {lines.map((l) => (
            <View style={styles.td} key={l.id}>
              <Text style={styles.cDesc}>{l.label}</Text>
              <Text style={styles.cNum}>{l.hours.toFixed(2)}</Text>
              <Text style={styles.cNum}>{money(l.ratePerHour, invoice.currency)}</Text>
              <Text style={styles.cAmt}>{money(l.amount, invoice.currency)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalRow}>
          <View style={styles.totalBox}>
            <View style={styles.totalLine}>
              <Text style={styles.muted}>Total hours</Text>
              <Text>{totalHours.toFixed(2)}</Text>
            </View>
            <View style={styles.hr} />
            <View style={styles.totalLine}>
              <Text style={styles.grand}>Total due</Text>
              <Text style={styles.grand}>{money(invoice.subtotal, invoice.currency)}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.footer}>
          Generated by Claude Invoicer · time billed from tracked Claude session activity
        </Text>
      </Page>
    </Document>
  );
}

export function ReceiptDoc({
  invoice,
  lines,
  receiptNumber,
  timezone,
}: {
  invoice: Invoice;
  lines: InvoiceLine[];
  receiptNumber: string;
  timezone: string;
}) {
  return (
    <Document title={receiptNumber}>
      <Page size="A4" style={styles.page}>
        <View style={styles.row}>
          <View>
            <Text style={styles.title}>RECEIPT</Text>
            <Text style={styles.muted}>{receiptNumber}</Text>
            <Text style={styles.muted}>for invoice {invoice.number}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.strong}>{invoice.businessName}</Text>
            {invoice.businessEmail ? <Text style={styles.muted}>{invoice.businessEmail}</Text> : null}
            {invoice.businessAddress ? <Text style={styles.muted}>{invoice.businessAddress}</Text> : null}
          </View>
        </View>

        <View style={styles.hr} />

        <View style={styles.row}>
          <Party label="Received from" name={invoice.clientName} email={invoice.clientEmail} address={invoice.clientAddress} />
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.label}>Paid on</Text>
            <Text>{invoice.paidAt ? day(invoice.paidAt, timezone) : '—'}</Text>
          </View>
        </View>

        <View style={[styles.block, { alignItems: 'center', marginTop: 50 }]}>
          <Text style={styles.label}>Amount paid</Text>
          <Text style={{ fontSize: 30, fontFamily: 'Helvetica-Bold' }}>
            {money(invoice.subtotal, invoice.currency)}
          </Text>
          <Text style={styles.paid}>PAID IN FULL</Text>
        </View>

        <Text style={styles.footer}>Generated by Claude Invoicer</Text>
      </Page>
    </Document>
  );
}
