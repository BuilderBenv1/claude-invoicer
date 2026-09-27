import { sql } from 'drizzle-orm';
import {
  pgSchema,
  text,
  integer,
  bigint,
  doublePrecision,
  timestamp,
  serial,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Every table lives in its own schema, not `public`: the database is shared
 * with another Supabase project whose table names (clients, invoices…) would
 * collide, and Supabase's Data API serves `public` to anyone holding the anon
 * key. A schema it doesn't expose keeps invoices off that API entirely.
 */
export const invoicer = pgSchema('invoicer');

/** A billable client. `billedThroughMs` is the reset mark for their clock. */
export const clients = invoicer.table('clients', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  hourlyRate: doublePrecision('hourly_rate').notNull().default(0),
  currency: text('currency').notNull().default('USD'),
  billedThroughMs: bigint('billed_through_ms', { mode: 'number' }).notNull().default(0),
  /** Optional per-client override of the rounding increment (minutes). */
  roundIncrementMin: integer('round_increment_min'),
  email: text('email'),
  address: text('address'),
  archived: integer('archived').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Maps a folder (and everything beneath it) to a client. Path is normalized. */
export const folderMappings = invoicer.table(
  'folder_mappings',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    label: text('label'),
    /** Per-folder hourly rate override; null = use the client's default rate. */
    hourlyRate: doublePrecision('hourly_rate'),
    /** Per-folder "bill from" cutoff (epoch ms); 0 = no cutoff. */
    billFromMs: bigint('bill_from_ms', { mode: 'number' }).notNull().default(0),
    billingMode: text('billing_mode').notNull().default('time'),
  },
  (t) => ({
    pathUnique: uniqueIndex('folder_path_unique').on(t.path),
    clientIdx: index('folder_client_idx').on(t.clientId),
  }),
);

/** Flat one-off charges (e.g. a fixed-fee website) added to a client's next invoice. */
export const oneOffCharges = invoicer.table(
  'one_off_charges',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    amount: doublePrecision('amount').notNull(),
    /** Set to the invoice id once billed; null = still unbilled. */
    billedInvoiceId: text('billed_invoice_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ clientIdx: index('oneoff_client_idx').on(t.clientId) }),
);

/** Activity intervals uploaded by the local agent. Upsert key: (sessionId, startMs). */
export const activityIntervals = invoicer.table(
  'activity_intervals',
  {
    sessionId: text('session_id').notNull(),
    startMs: bigint('start_ms', { mode: 'number' }).notNull(),
    endMs: bigint('end_ms', { mode: 'number' }).notNull(),
    activeMs: bigint('active_ms', { mode: 'number' }).notNull(),
    cwd: text('cwd').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.sessionId, t.startMs] }),
    cwdIdx: index('interval_cwd_idx').on(t.cwd),
  }),
);

/** An issued invoice. Identity fields are snapshotted so PDFs stay stable. */
export const invoices = invoicer.table('invoices', {
  id: text('id').primaryKey(),
  number: text('number').notNull(),
  clientId: text('client_id')
    .notNull()
    .references(() => clients.id),
  status: text('status').notNull().default('unpaid'), // 'unpaid' | 'paid'
  /** 'invoice' | 'proforma' | 'quote'. Only 'invoice' is billing evidence. */
  docType: text('doc_type').notNull().default('invoice'),
  /** Set on a converted invoice, pointing at the quote or pro forma it came from. */
  convertedFromId: text('converted_from_id'),
  /** Set on a quote or pro forma once it has been converted. */
  convertedToId: text('converted_to_id'),
  currency: text('currency').notNull(),
  subtotal: doublePrecision('subtotal').notNull(),
  /** Billing window: (prevBilledThroughMs, cutoffMs]. */
  prevBilledThroughMs: bigint('prev_billed_through_ms', { mode: 'number' }).notNull(),
  cutoffMs: bigint('cutoff_ms', { mode: 'number' }).notNull(),
  /** Snapshot: payment terms applied at issue, in days. 0 = due on receipt. */
  paymentTermsDays: integer('payment_terms_days').notNull().default(0),
  dueAt: timestamp('due_at', { withTimezone: true }),
  /** Snapshot: the rendered pay-to block, newline separated. */
  paymentDetails: text('payment_details'),
  /** Snapshot: VAT percentage applied (0 = none). */
  taxRate: doublePrecision('tax_rate').notNull().default(0),
  taxAmount: doublePrecision('tax_amount').notNull().default(0),
  /** The payable figure: subtotal + taxAmount. `subtotal` is strictly net. */
  total: doublePrecision('total').notNull().default(0),
  // snapshots
  businessName: text('business_name').notNull().default(''),
  businessEmail: text('business_email'),
  businessAddress: text('business_address'),
  taxId: text('tax_id'),
  vatNumber: text('vat_number'),
  publicToken: text('public_token'),
  emailedAt: timestamp('emailed_at', { withTimezone: true }),
  emailedTo: text('emailed_to'),
  clientName: text('client_name').notNull(),
  clientEmail: text('client_email'),
  clientAddress: text('client_address'),
  notes: text('notes'),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  briefId: text('brief_id'),
  milestoneId: text('milestone_id'),
}, (t) => ({
  clientWeekUnique: uniqueIndex('invoices_client_week_unique')
    .on(t.clientId, t.prevBilledThroughMs)
    .where(sql`${t.prevBilledThroughMs} >= 0`),
  numberUnique: uniqueIndex('invoices_number_unique').on(t.number),
  convertedFromUnique: uniqueIndex('invoices_converted_from_unique')
    .on(t.convertedFromId)
    .where(sql`${t.convertedFromId} IS NOT NULL`),
  milestoneUnique: uniqueIndex('invoices_milestone_unique')
    .on(t.milestoneId)
    .where(sql`${t.milestoneId} IS NOT NULL`),
}));

export const invoiceLines = invoicer.table(
  'invoice_lines',
  {
    id: serial('id').primaryKey(),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    hours: doublePrecision('hours').notNull(),
    ratePerHour: doublePrecision('rate_per_hour').notNull(),
    amount: doublePrecision('amount').notNull(),
  },
  (t) => ({ invoiceIdx: index('line_invoice_idx').on(t.invoiceId) }),
);

export const receipts = invoicer.table('receipts', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  number: text('number').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ invoiceUnique: uniqueIndex('receipts_invoice_unique').on(t.invoiceId) }));

/** Singleton settings row (id = 1). */
export const settings = invoicer.table('settings', {
  id: integer('id').primaryKey(),
  businessName: text('business_name').notNull().default('My Business'),
  businessEmail: text('business_email'),
  businessAddress: text('business_address'),
  taxId: text('tax_id'),
  defaultCurrency: text('default_currency').notNull().default('USD'),
  defaultIdleCapMin: integer('default_idle_cap_min').notNull().default(5),
  defaultRoundIncrementMin: integer('default_round_increment_min').notNull().default(15),
  roundMode: text('round_mode').notNull().default('up'),
  timezone: text('timezone').notNull().default('UTC'),
  invoiceSeq: integer('invoice_seq').notNull().default(0),
  receiptSeq: integer('receipt_seq').notNull().default(0),
  quoteSeq: integer('quote_seq').notNull().default(0),
  proformaSeq: integer('proforma_seq').notNull().default(0),
  invoicePrefix: text('invoice_prefix').notNull().default('INV'),
  quotePrefix: text('quote_prefix').notNull().default('QUO'),
  proformaPrefix: text('proforma_prefix').notNull().default('PF'),
  autoSendWeekly: integer('auto_send_weekly').notNull().default(0),
  /** Default payment terms for new invoices, in days. */
  paymentTermsDays: integer('payment_terms_days').notNull().default(14),
  /** VAT percentage; 0 disables VAT entirely. */
  vatRate: doublePrecision('vat_rate').notNull().default(0),
  vatNumber: text('vat_number'),
});

/** Bank details shown on invoices: one row per currency, plus a 'DEFAULT' fallback. */
export const paymentAccounts = invoicer.table(
  'payment_accounts',
  {
    id: text('id').primaryKey(),
    /** An ISO currency code, or 'DEFAULT' for the fallback used by any other currency. */
    currency: text('currency').notNull(),
    accountName: text('account_name'),
    bankName: text('bank_name'),
    sortCode: text('sort_code'),
    accountNumber: text('account_number'),
    iban: text('iban'),
    bic: text('bic'),
    routingNumber: text('routing_number'),
    notes: text('notes'),
  },
  (t) => ({ currencyUnique: uniqueIndex('payment_accounts_currency_unique').on(t.currency) }),
);

/** A costed piece of client work, ingested from an estimate or proposal. */
export const briefs = invoicer.table(
  'briefs',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** 'fixed' bills each milestone's agreed amount; 'time' bills tracked hours. */
    billingMode: text('billing_mode').notNull().default('time'),
    currency: text('currency').notNull(),
    ratePerHour: doublePrecision('rate_per_hour').notNull().default(0),
    /** A brief may reference a folder mapping; if that mapping is deleted the
     *  brief simply loses its folder (ON DELETE SET NULL) rather than blocking
     *  the delete or dangling on a row that no longer exists. */
    folderMappingId: text('folder_mapping_id').references(() => folderMappings.id, { onDelete: 'set null' }),
    /** The estimate as ingested, kept verbatim so the parse can be revisited. */
    sourceText: text('source_text'),
    status: text('status').notNull().default('active'),
    autoInvoice: integer('auto_invoice').notNull().default(1),
    holdMinutes: integer('hold_minutes').notNull().default(10),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ clientIdx: index('brief_client_idx').on(t.clientId) }),
);

/** One work item within a brief. Estimates are ranges, never a single figure. */
export const milestones = invoicer.table(
  'milestones',
  {
    id: text('id').primaryKey(),
    briefId: text('brief_id')
      .notNull()
      .references(() => briefs.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    /** Short stable id; Phase D2 writes it into MILESTONES.md. */
    key: text('key').notNull(),
    section: text('section'),
    title: text('title').notNull(),
    deliverable: text('deliverable'),
    /** Fixed-price briefs only; T&M leaves this 0 and bills tracked time. */
    amount: doublePrecision('amount').notNull().default(0),
    estimateHoursLow: doublePrecision('estimate_hours_low').notNull().default(0),
    estimateHoursHigh: doublePrecision('estimate_hours_high').notNull().default(0),
    estimateAmountLow: doublePrecision('estimate_amount_low').notNull().default(0),
    estimateAmountHigh: doublePrecision('estimate_amount_high').notNull().default(0),
    /** T&M: time already billed for this milestone. Window is (this, cutoff]. */
    billedThroughMs: bigint('billed_through_ms', { mode: 'number' }).notNull().default(0),
    status: text('status').notNull().default('pending'),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    invoicedAt: timestamp('invoiced_at', { withTimezone: true }),
    /** Set to the invoice id once billed; null = still unbilled. */
    invoiceId: text('invoice_id'),
  },
  (t) => ({
    briefKeyUnique: uniqueIndex('milestones_brief_key_unique').on(t.briefId, t.key),
    briefIdx: index('milestone_brief_idx').on(t.briefId),
  }),
);

/** Signed per-week billable-hours adjustment (applied at issue time). */
export const weekAdjustments = invoicer.table(
  'week_adjustments',
  {
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    weekStartMs: bigint('week_start_ms', { mode: 'number' }).notNull(),
    adjustHours: doublePrecision('adjust_hours').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.clientId, t.weekStartMs] }) }),
);

export type Client = typeof clients.$inferSelect;
export type FolderMapping = typeof folderMappings.$inferSelect;
export type ActivityInterval = typeof activityIntervals.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type OneOffCharge = typeof oneOffCharges.$inferSelect;
export type WeekAdjustment = typeof weekAdjustments.$inferSelect;
export type PaymentAccountRow = typeof paymentAccounts.$inferSelect;
export type Brief = typeof briefs.$inferSelect;
export type Milestone = typeof milestones.$inferSelect;
