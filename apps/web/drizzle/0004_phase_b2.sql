-- Phase B2: quotes, pro formas and document types.
-- Run this in the Neon SQL editor BEFORE merging to main.
-- Additive, idempotent and atomic: wrapped in a transaction, so either the
-- whole file applies or none of it does. (0003_phase_b1.sql has already been
-- run.) The one statement that can legitimately fail is the final DO block,
-- which builds the unique document-number index: if two existing rows
-- already share a number (the app has always allowed a manual override), it
-- raises an error naming the offending numbers instead of a bare constraint
-- violation. If that happens, renumber the duplicates so each document has
-- its own number, then re-run this whole file.

BEGIN;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS doc_type text NOT NULL DEFAULT 'invoice';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS converted_from_id text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS converted_to_id text;

-- ADD COLUMN ... DEFAULT 'invoice' above already backfilled every existing
-- row at ALTER time. This UPDATE is a belt-and-braces guard against a
-- doc_type written out-of-band as NULL or '' before this migration ran; it
-- is expected to match zero rows in normal operation.
UPDATE invoices SET doc_type = 'invoice' WHERE doc_type IS NULL OR doc_type = '';

ALTER TABLE settings ADD COLUMN IF NOT EXISTS quote_seq integer NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS proforma_seq integer NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_prefix text NOT NULL DEFAULT 'INV';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS quote_prefix text NOT NULL DEFAULT 'QUO';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS proforma_prefix text NOT NULL DEFAULT 'PF';

-- Document numbers must be unique. The app has always allowed a manual number
-- override, so this is the one statement here that can legitimately fail.
-- It reports the offending numbers rather than a bare constraint violation.
DO $$
DECLARE
  dupes text;
BEGIN
  SELECT string_agg(number, ', ' ORDER BY number) INTO dupes
  FROM (SELECT number FROM invoices GROUP BY number HAVING count(*) > 1) d;

  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot add the unique document-number index: these numbers are used more than once: %. Renumber the duplicates (each document needs its own number), then re-run this file.',
      dupes;
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS invoices_number_unique ON invoices (number);
END $$;

COMMIT;
