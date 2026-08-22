-- Phase D1: briefs and milestones.
-- Run in the Neon SQL editor BEFORE merging to main.
-- Additive, idempotent and atomic. (0003, 0004 and 0005 have been run.)
--
-- Like 0005, the ALTER blocks below assert every column so that if these
-- tables ever exist in a differently-scoped hand-applied form, re-running
-- this file repairs them. The exceptions are id/FK columns and NOT-NULL
-- columns with no default (client_id, title, currency, brief_id, idx, key):
-- ADD COLUMN for one of those would fail outright against a table that
-- already has rows, and a failure here is inside the transaction — it must
-- not be able to roll back the schema the app needs to boot.

BEGIN;

CREATE TABLE IF NOT EXISTS briefs (
  id                text PRIMARY KEY,
  client_id         text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title             text NOT NULL,
  billing_mode      text NOT NULL DEFAULT 'time',
  currency          text NOT NULL,
  rate_per_hour     double precision NOT NULL DEFAULT 0,
  folder_mapping_id text,
  source_text       text,
  status            text NOT NULL DEFAULT 'active',
  auto_invoice      integer NOT NULL DEFAULT 1,
  hold_minutes      integer NOT NULL DEFAULT 10,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'time';
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS rate_per_hour double precision NOT NULL DEFAULT 0;
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS folder_mapping_id text;
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS source_text text;
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS auto_invoice integer NOT NULL DEFAULT 1;
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS hold_minutes integer NOT NULL DEFAULT 10;
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS brief_client_idx ON briefs (client_id);

CREATE TABLE IF NOT EXISTS milestones (
  id                    text PRIMARY KEY,
  brief_id              text NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  idx                   integer NOT NULL,
  key                   text NOT NULL,
  section               text,
  title                 text NOT NULL,
  deliverable           text,
  amount                double precision NOT NULL DEFAULT 0,
  estimate_hours_low    double precision NOT NULL DEFAULT 0,
  estimate_hours_high   double precision NOT NULL DEFAULT 0,
  estimate_amount_low   double precision NOT NULL DEFAULT 0,
  estimate_amount_high  double precision NOT NULL DEFAULT 0,
  billed_through_ms     bigint NOT NULL DEFAULT 0,
  status                text NOT NULL DEFAULT 'pending',
  ready_at              timestamptz,
  invoiced_at           timestamptz,
  invoice_id            text
);
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS section text;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS deliverable text;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS amount double precision NOT NULL DEFAULT 0;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS estimate_hours_low double precision NOT NULL DEFAULT 0;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS estimate_hours_high double precision NOT NULL DEFAULT 0;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS estimate_amount_low double precision NOT NULL DEFAULT 0;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS estimate_amount_high double precision NOT NULL DEFAULT 0;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS billed_through_ms bigint NOT NULL DEFAULT 0;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS ready_at timestamptz;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS invoiced_at timestamptz;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS invoice_id text;
CREATE INDEX IF NOT EXISTS milestone_brief_idx ON milestones (brief_id);

ALTER TABLE folder_mappings ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'time';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS brief_id text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS milestone_id text;

COMMIT;

-- ============================================================================
-- Outside the transaction on purpose: these are the only statements that can
-- fail on live data, and a failure must never roll back the schema the app
-- needs to boot. (That is what took production down on 2026-08-17.)
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS milestones_brief_key_unique ON milestones (brief_id, key);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_milestone_unique
  ON invoices (milestone_id) WHERE milestone_id IS NOT NULL;
