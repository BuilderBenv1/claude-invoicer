-- Phase B1: payment details, totals and due dates.
-- Run this in the Neon SQL editor BEFORE merging to main.
-- Additive and safe to re-run.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_details text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_rate double precision NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_amount double precision NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total double precision NOT NULL DEFAULT 0;

-- Existing invoices carry no VAT, so their payable total is their subtotal.
-- Runs once; after this, `total` is written at issue time.
UPDATE invoices SET total = subtotal WHERE total = 0 AND subtotal <> 0;

ALTER TABLE settings ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 14;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS vat_rate double precision NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS vat_number text;

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
