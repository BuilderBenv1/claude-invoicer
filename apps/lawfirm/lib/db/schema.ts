import {
  pgTable,
  text,
  integer,
  bigint,
  doublePrecision,
  timestamp,
  serial,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Data model mirrors the way a lawyer thinks about their work — and the way
 * Cake structures it: Client → Project (a case/matter) → Task. Every timer
 * (a `time_entry`) is booked against a task, so hours roll up cleanly into a
 * case total and then a client total.
 */

/** A firm client. `hourlyRate` is the default; a case may override it. */
export const clients = pgTable(
  'clients',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    address: text('address'),
    hourlyRate: doublePrecision('hourly_rate').notNull().default(0),
    currency: text('currency').notNull().default('ILS'),
    notes: text('notes'),
    archived: integer('archived').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ nameIdx: index('client_name_idx').on(t.name) }),
);

/**
 * A case / matter (Cake calls it a "project"). Belongs to a client. Carries an
 * optional rate override and an optional hours-alert threshold: when logged
 * hours reach `alertThresholdHours`, the client is notified automatically.
 * `alertNotifiedHours` records the threshold value we already fired on, so the
 * same alert never repeats until the threshold is raised.
 */
export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').notNull().default('open'), // 'open' | 'closed'
    /** Per-case hourly rate override; null = use the client's rate. */
    hourlyRate: doublePrecision('hourly_rate'),
    /** Notify the client once logged hours reach this many; null = no alert. */
    alertThresholdHours: doublePrecision('alert_threshold_hours'),
    /** The threshold value already alerted on (dedupe guard); null = not yet. */
    alertNotifiedHours: doublePrecision('alert_notified_hours'),
    alertNotifiedAt: timestamp('alert_notified_at', { withTimezone: true }),
    archived: integer('archived').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => ({ clientIdx: index('project_client_idx').on(t.clientId) }),
);

/** A task within a case — the finest-grained bucket a timer is booked against. */
export const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    archived: integer('archived').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ projectIdx: index('task_project_idx').on(t.projectId) }),
);

/**
 * One stretch of tracked work — the output of "start timer / stop timer", or a
 * manual entry. `endMs` NULL means the timer is still running; `durationMs` is
 * filled in when it stops. Client and project are denormalized so hours
 * aggregate without joins and survive a task rename.
 */
export const timeEntries = pgTable(
  'time_entries',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    description: text('description'),
    startMs: bigint('start_ms', { mode: 'number' }).notNull(),
    /** NULL while the timer runs. */
    endMs: bigint('end_ms', { mode: 'number' }),
    /** Milliseconds of work; NULL while running, set on stop / on manual entry. */
    durationMs: bigint('duration_ms', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clientIdx: index('entry_client_idx').on(t.clientId),
    projectIdx: index('entry_project_idx').on(t.projectId),
    startIdx: index('entry_start_idx').on(t.startMs),
  }),
);

/** Singleton settings row (id = 1). */
export const settings = pgTable('settings', {
  id: integer('id').primaryKey(),
  firmName: text('firm_name').notNull().default('משרד עורכי דין'),
  firmEmail: text('firm_email'),
  firmAddress: text('firm_address'),
  firmPhone: text('firm_phone'),
  taxId: text('tax_id'),
  /** Where the automatic monthly reports are sent. */
  reportEmail: text('report_email'),
  defaultCurrency: text('default_currency').notNull().default('ILS'),
  defaultHourlyRate: doublePrecision('default_hourly_rate').notNull().default(0),
  /** Billing rounds each entry up to this many minutes (legal norm: 6). */
  roundIncrementMin: integer('round_increment_min').notNull().default(6),
  timezone: text('timezone').notNull().default('Asia/Jerusalem'),
  locale: text('locale').notNull().default('he'), // 'he' | 'en'
  /** Master switch for the monthly auto-send cron. */
  autoSendMonthly: integer('auto_send_monthly').notNull().default(0),
  /** Last month key we auto-sent (e.g. "2026-06"), so the cron fires once. */
  lastMonthlySentKey: text('last_monthly_sent_key'),
});

export type Client = typeof clients.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type Settings = typeof settings.$inferSelect;
