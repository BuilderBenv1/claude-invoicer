import {
  pgTable,
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

/** A billable client. `billedThroughMs` is the reset mark for their clock. */
export const clients = pgTable('clients', {
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
export const folderMappings = pgTable(
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
  },
  (t) => ({
    pathUnique: uniqueIndex('folder_path_unique').on(t.path),
    clientIdx: index('folder_client_idx').on(t.clientId),
  }),
);

/** Flat one-off charges (e.g. a fixed-fee website) added to a client's next invoice. */
export const oneOffCharges = pgTable(
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
export const activityIntervals = pgTable(
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
export const invoices = pgTable('invoices', {
  id: text('id').primaryKey(),
  number: text('number').notNull(),
  clientId: text('client_id')
    .notNull()
    .references(() => clients.id),
  status: text('status').notNull().default('unpaid'), // 'unpaid' | 'paid'
  currency: text('currency').notNull(),
  subtotal: doublePrecision('subtotal').notNull(),
  /** Billing window: (prevBilledThroughMs, cutoffMs]. */
  prevBilledThroughMs: bigint('prev_billed_through_ms', { mode: 'number' }).notNull(),
  cutoffMs: bigint('cutoff_ms', { mode: 'number' }).notNull(),
  // snapshots
  businessName: text('business_name').notNull().default(''),
  businessEmail: text('business_email'),
  businessAddress: text('business_address'),
  taxId: text('tax_id'),
  clientName: text('client_name').notNull(),
  clientEmail: text('client_email'),
  clientAddress: text('client_address'),
  notes: text('notes'),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
});

export const invoiceLines = pgTable(
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

export const receipts = pgTable('receipts', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  number: text('number').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Singleton settings row (id = 1). */
export const settings = pgTable('settings', {
  id: integer('id').primaryKey(),
  businessName: text('business_name').notNull().default('My Business'),
  businessEmail: text('business_email'),
  businessAddress: text('business_address'),
  taxId: text('tax_id'),
  defaultCurrency: text('default_currency').notNull().default('USD'),
  defaultIdleCapMin: integer('default_idle_cap_min').notNull().default(5),
  defaultRoundIncrementMin: integer('default_round_increment_min').notNull().default(15),
  timezone: text('timezone').notNull().default('UTC'),
  invoiceSeq: integer('invoice_seq').notNull().default(0),
  receiptSeq: integer('receipt_seq').notNull().default(0),
});

export type Client = typeof clients.$inferSelect;
export type FolderMapping = typeof folderMappings.$inferSelect;
export type ActivityInterval = typeof activityIntervals.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type OneOffCharge = typeof oneOffCharges.$inferSelect;
