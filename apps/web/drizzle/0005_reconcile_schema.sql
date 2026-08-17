-- Reconcile the live database with apps/web/lib/db/schema.ts.
--
-- WHY THIS EXISTS
-- Migrations on this project have been applied by hand, and some schema
-- changes never got a migration file at all. `settings.round_mode` was added
-- to schema.ts by the rounding-mode feature but never created in the database
-- and never deployed (its commits sat unpushed), so the first deploy carrying
-- that code failed with: column "round_mode" does not exist.
--
-- Rather than add that one column, this file asserts EVERY table, column and
-- index that schema.ts declares. Anything already present is left untouched.
-- After running it once, the live database provably matches schema.ts, and
-- this whole class of failure is closed.
--
-- Run in the Neon SQL editor. Additive, idempotent, atomic — either the whole
-- file applies or none of it does. Safe to re-run any number of times.
-- Supersedes nothing: 0003 and 0004 remain valid, this just backfills whatever
-- they and the earlier files missed.

BEGIN;

-- ---------- clients ----------
CREATE TABLE IF NOT EXISTS clients (
  id                  text PRIMARY KEY,
  name                text NOT NULL,
  hourly_rate         double precision NOT NULL DEFAULT 0,
  currency            text NOT NULL DEFAULT 'USD',
  billed_through_ms   bigint NOT NULL DEFAULT 0,
  round_increment_min integer,
  email               text,
  address             text,
  archived            integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS hourly_rate double precision NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS billed_through_ms bigint NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS round_increment_min integer;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS archived integer NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- ---------- folder_mappings ----------
CREATE TABLE IF NOT EXISTS folder_mappings (
  id           text PRIMARY KEY,
  client_id    text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  path         text NOT NULL,
  label        text,
  hourly_rate  double precision,
  bill_from_ms bigint NOT NULL DEFAULT 0
);
ALTER TABLE folder_mappings ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE folder_mappings ADD COLUMN IF NOT EXISTS hourly_rate double precision;
ALTER TABLE folder_mappings ADD COLUMN IF NOT EXISTS bill_from_ms bigint NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS folder_path_unique ON folder_mappings (path);
CREATE INDEX IF NOT EXISTS folder_client_idx ON folder_mappings (client_id);

-- ---------- one_off_charges ----------
CREATE TABLE IF NOT EXISTS one_off_charges (
  id                text PRIMARY KEY,
  client_id         text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  description       text NOT NULL,
  amount            double precision NOT NULL,
  billed_invoice_id text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE one_off_charges ADD COLUMN IF NOT EXISTS billed_invoice_id text;
ALTER TABLE one_off_charges ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS oneoff_client_idx ON one_off_charges (client_id);

-- ---------- activity_intervals ----------
CREATE TABLE IF NOT EXISTS activity_intervals (
  session_id text NOT NULL,
  start_ms   bigint NOT NULL,
  end_ms     bigint NOT NULL,
  active_ms  bigint NOT NULL,
  cwd        text NOT NULL,
  PRIMARY KEY (session_id, start_ms)
);
CREATE INDEX IF NOT EXISTS interval_cwd_idx ON activity_intervals (cwd);

-- ---------- invoices ----------
CREATE TABLE IF NOT EXISTS invoices (
  id                     text PRIMARY KEY,
  number                 text NOT NULL,
  client_id              text NOT NULL REFERENCES clients(id),
  status                 text NOT NULL DEFAULT 'unpaid',
  doc_type               text NOT NULL DEFAULT 'invoice',
  converted_from_id      text,
  converted_to_id        text,
  currency               text NOT NULL,
  subtotal               double precision NOT NULL,
  prev_billed_through_ms bigint NOT NULL,
  cutoff_ms              bigint NOT NULL,
  payment_terms_days     integer NOT NULL DEFAULT 0,
  due_at                 timestamptz,
  payment_details        text,
  tax_rate               double precision NOT NULL DEFAULT 0,
  tax_amount             double precision NOT NULL DEFAULT 0,
  total                  double precision NOT NULL DEFAULT 0,
  business_name          text NOT NULL DEFAULT '',
  business_email         text,
  business_address       text,
  tax_id                 text,
  vat_number             text,
  public_token           text,
  emailed_at             timestamptz,
  emailed_to             text,
  client_name            text NOT NULL,
  client_email           text,
  client_address         text,
  notes                  text,
  issued_at              timestamptz NOT NULL DEFAULT now(),
  paid_at                timestamptz
);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'unpaid';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS doc_type text NOT NULL DEFAULT 'invoice';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS converted_from_id text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS converted_to_id text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_details text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_rate double precision NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_amount double precision NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total double precision NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS business_name text NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS business_email text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS business_address text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_id text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vat_number text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS public_token text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS emailed_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS emailed_to text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_email text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_address text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issued_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- Pre-B1 invoices carry no VAT, so their payable total is their net subtotal.
UPDATE invoices SET total = subtotal WHERE total = 0 AND subtotal <> 0;
-- Any row predating doc_type is a real invoice.
UPDATE invoices SET doc_type = 'invoice' WHERE doc_type IS NULL OR doc_type = '';

CREATE UNIQUE INDEX IF NOT EXISTS invoices_client_week_unique
  ON invoices (client_id, prev_billed_through_ms)
  WHERE prev_billed_through_ms >= 0;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_converted_from_unique
  ON invoices (converted_from_id)
  WHERE converted_from_id IS NOT NULL;

-- ---------- invoice_lines ----------
CREATE TABLE IF NOT EXISTS invoice_lines (
  id            serial PRIMARY KEY,
  invoice_id    text NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  label         text NOT NULL,
  hours         double precision NOT NULL,
  rate_per_hour double precision NOT NULL,
  amount        double precision NOT NULL
);
CREATE INDEX IF NOT EXISTS line_invoice_idx ON invoice_lines (invoice_id);

-- ---------- receipts ----------
CREATE TABLE IF NOT EXISTS receipts (
  id         text PRIMARY KEY,
  invoice_id text NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  number     text NOT NULL,
  issued_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS receipts_invoice_unique ON receipts (invoice_id);

-- ---------- settings ----------
CREATE TABLE IF NOT EXISTS settings (
  id                          integer PRIMARY KEY,
  business_name               text NOT NULL DEFAULT 'My Business',
  business_email              text,
  business_address            text,
  tax_id                      text,
  default_currency            text NOT NULL DEFAULT 'USD',
  default_idle_cap_min        integer NOT NULL DEFAULT 5,
  default_round_increment_min integer NOT NULL DEFAULT 15,
  round_mode                  text NOT NULL DEFAULT 'up',
  timezone                    text NOT NULL DEFAULT 'UTC',
  invoice_seq                 integer NOT NULL DEFAULT 0,
  receipt_seq                 integer NOT NULL DEFAULT 0,
  quote_seq                   integer NOT NULL DEFAULT 0,
  proforma_seq                integer NOT NULL DEFAULT 0,
  invoice_prefix              text NOT NULL DEFAULT 'INV',
  quote_prefix                text NOT NULL DEFAULT 'QUO',
  proforma_prefix             text NOT NULL DEFAULT 'PF',
  auto_send_weekly            integer NOT NULL DEFAULT 0,
  payment_terms_days          integer NOT NULL DEFAULT 14,
  vat_rate                    double precision NOT NULL DEFAULT 0,
  vat_number                  text
);
-- round_mode is the column whose absence took production down; the rest are
-- asserted for the same reason it was missing — no migration ever declared them.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS round_mode text NOT NULL DEFAULT 'up';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS business_email text;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS business_address text;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tax_id text;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS default_currency text NOT NULL DEFAULT 'USD';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS default_idle_cap_min integer NOT NULL DEFAULT 5;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS default_round_increment_min integer NOT NULL DEFAULT 15;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_seq integer NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS receipt_seq integer NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS quote_seq integer NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS proforma_seq integer NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_prefix text NOT NULL DEFAULT 'INV';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS quote_prefix text NOT NULL DEFAULT 'QUO';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS proforma_prefix text NOT NULL DEFAULT 'PF';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_send_weekly integer NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 14;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS vat_rate double precision NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS vat_number text;

INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------- payment_accounts ----------
CREATE TABLE IF NOT EXISTS payment_accounts (
  id             text PRIMARY KEY,
  currency       text NOT NULL,
  account_name   text,
  bank_name      text,
  sort_code      text,
  account_number text,
  iban           text,
  bic            text,
  routing_number text,
  notes          text
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_accounts_currency_unique ON payment_accounts (currency);

-- ---------- week_adjustments ----------
CREATE TABLE IF NOT EXISTS week_adjustments (
  client_id     text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  week_start_ms bigint NOT NULL,
  adjust_hours  double precision NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, week_start_ms)
);

COMMIT;

-- ============================================================================
-- Everything above is committed. The site should now load.
--
-- The statement below is DELIBERATELY OUTSIDE that transaction, because it is
-- the only one here that can legitimately fail — the app has always allowed a
-- manual document-number override, so two rows may already share a number.
-- Keeping it separate means a duplicate cannot roll back the schema fix that
-- brings production back up.
--
-- If it reports duplicates: the site is already working. Renumber the named
-- documents so each has its own number, then re-run just this block.
-- ============================================================================

DO $$
DECLARE
  dupes text;
BEGIN
  SELECT string_agg(number, ', ' ORDER BY number) INTO dupes
  FROM (SELECT number FROM invoices GROUP BY number HAVING count(*) > 1) d;

  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION
      'Schema is reconciled and the site should be up. Could not add the unique document-number index because these numbers are used more than once: %. Renumber the duplicates, then re-run this final block only.',
      dupes;
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS invoices_number_unique ON invoices (number);
END $$;
