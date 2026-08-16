-- Phase B2: quotes, pro formas and document types.
-- Run this in the Neon SQL editor BEFORE merging to main.
-- Additive and safe to re-run. (0003_phase_b1.sql has already been run.)

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS doc_type text NOT NULL DEFAULT 'invoice';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS converted_from_id text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS converted_to_id text;

-- Every existing document is a real invoice.
UPDATE invoices SET doc_type = 'invoice' WHERE doc_type IS NULL OR doc_type = '';

ALTER TABLE settings ADD COLUMN IF NOT EXISTS quote_seq integer NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS proforma_seq integer NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_prefix text NOT NULL DEFAULT 'INV';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS quote_prefix text NOT NULL DEFAULT 'QUO';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS proforma_prefix text NOT NULL DEFAULT 'PF';

-- Document numbers must stay unique per type; a converted invoice keeps its own.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_number_unique ON invoices (number);
