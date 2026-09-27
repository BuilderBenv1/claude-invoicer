-- Supabase baseline for the invoicer schema, generated from lib/db/schema.ts
-- with `drizzle-kit export`. Run once against an empty database.
--
-- drizzle/0000–0006 are the Neon history and target `public`; do not run them
-- here. Future schema changes: edit schema.ts, then write an additive migration
-- in this folder.

CREATE SCHEMA "invoicer";

CREATE TABLE "invoicer"."activity_intervals" (
	"session_id" text NOT NULL,
	"start_ms" bigint NOT NULL,
	"end_ms" bigint NOT NULL,
	"active_ms" bigint NOT NULL,
	"cwd" text NOT NULL,
	CONSTRAINT "activity_intervals_session_id_start_ms_pk" PRIMARY KEY("session_id","start_ms")
);

CREATE TABLE "invoicer"."briefs" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"title" text NOT NULL,
	"billing_mode" text DEFAULT 'time' NOT NULL,
	"currency" text NOT NULL,
	"rate_per_hour" double precision DEFAULT 0 NOT NULL,
	"folder_mapping_id" text,
	"source_text" text,
	"status" text DEFAULT 'active' NOT NULL,
	"auto_invoice" integer DEFAULT 1 NOT NULL,
	"hold_minutes" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "invoicer"."clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"hourly_rate" double precision DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"billed_through_ms" bigint DEFAULT 0 NOT NULL,
	"round_increment_min" integer,
	"email" text,
	"address" text,
	"archived" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "invoicer"."folder_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"path" text NOT NULL,
	"label" text,
	"hourly_rate" double precision,
	"bill_from_ms" bigint DEFAULT 0 NOT NULL,
	"billing_mode" text DEFAULT 'time' NOT NULL
);

CREATE TABLE "invoicer"."invoice_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"label" text NOT NULL,
	"hours" double precision NOT NULL,
	"rate_per_hour" double precision NOT NULL,
	"amount" double precision NOT NULL
);

CREATE TABLE "invoicer"."invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"client_id" text NOT NULL,
	"status" text DEFAULT 'unpaid' NOT NULL,
	"doc_type" text DEFAULT 'invoice' NOT NULL,
	"converted_from_id" text,
	"converted_to_id" text,
	"currency" text NOT NULL,
	"subtotal" double precision NOT NULL,
	"prev_billed_through_ms" bigint NOT NULL,
	"cutoff_ms" bigint NOT NULL,
	"payment_terms_days" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone,
	"payment_details" text,
	"tax_rate" double precision DEFAULT 0 NOT NULL,
	"tax_amount" double precision DEFAULT 0 NOT NULL,
	"total" double precision DEFAULT 0 NOT NULL,
	"business_name" text DEFAULT '' NOT NULL,
	"business_email" text,
	"business_address" text,
	"tax_id" text,
	"vat_number" text,
	"public_token" text,
	"emailed_at" timestamp with time zone,
	"emailed_to" text,
	"client_name" text NOT NULL,
	"client_email" text,
	"client_address" text,
	"notes" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"brief_id" text,
	"milestone_id" text
);

CREATE TABLE "invoicer"."milestones" (
	"id" text PRIMARY KEY NOT NULL,
	"brief_id" text NOT NULL,
	"idx" integer NOT NULL,
	"key" text NOT NULL,
	"section" text,
	"title" text NOT NULL,
	"deliverable" text,
	"amount" double precision DEFAULT 0 NOT NULL,
	"estimate_hours_low" double precision DEFAULT 0 NOT NULL,
	"estimate_hours_high" double precision DEFAULT 0 NOT NULL,
	"estimate_amount_low" double precision DEFAULT 0 NOT NULL,
	"estimate_amount_high" double precision DEFAULT 0 NOT NULL,
	"billed_through_ms" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"ready_at" timestamp with time zone,
	"invoiced_at" timestamp with time zone,
	"invoice_id" text
);

CREATE TABLE "invoicer"."one_off_charges" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"description" text NOT NULL,
	"amount" double precision NOT NULL,
	"billed_invoice_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "invoicer"."payment_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"currency" text NOT NULL,
	"account_name" text,
	"bank_name" text,
	"sort_code" text,
	"account_number" text,
	"iban" text,
	"bic" text,
	"routing_number" text,
	"notes" text
);

CREATE TABLE "invoicer"."receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"number" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "invoicer"."settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"business_name" text DEFAULT 'My Business' NOT NULL,
	"business_email" text,
	"business_address" text,
	"tax_id" text,
	"default_currency" text DEFAULT 'USD' NOT NULL,
	"default_idle_cap_min" integer DEFAULT 5 NOT NULL,
	"default_round_increment_min" integer DEFAULT 15 NOT NULL,
	"round_mode" text DEFAULT 'up' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"invoice_seq" integer DEFAULT 0 NOT NULL,
	"receipt_seq" integer DEFAULT 0 NOT NULL,
	"quote_seq" integer DEFAULT 0 NOT NULL,
	"proforma_seq" integer DEFAULT 0 NOT NULL,
	"invoice_prefix" text DEFAULT 'INV' NOT NULL,
	"quote_prefix" text DEFAULT 'QUO' NOT NULL,
	"proforma_prefix" text DEFAULT 'PF' NOT NULL,
	"auto_send_weekly" integer DEFAULT 0 NOT NULL,
	"payment_terms_days" integer DEFAULT 14 NOT NULL,
	"vat_rate" double precision DEFAULT 0 NOT NULL,
	"vat_number" text
);

CREATE TABLE "invoicer"."week_adjustments" (
	"client_id" text NOT NULL,
	"week_start_ms" bigint NOT NULL,
	"adjust_hours" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "week_adjustments_client_id_week_start_ms_pk" PRIMARY KEY("client_id","week_start_ms")
);

ALTER TABLE "invoicer"."briefs" ADD CONSTRAINT "briefs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "invoicer"."clients"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "invoicer"."briefs" ADD CONSTRAINT "briefs_folder_mapping_id_folder_mappings_id_fk" FOREIGN KEY ("folder_mapping_id") REFERENCES "invoicer"."folder_mappings"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "invoicer"."folder_mappings" ADD CONSTRAINT "folder_mappings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "invoicer"."clients"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "invoicer"."invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "invoicer"."invoices"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "invoicer"."invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "invoicer"."clients"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "invoicer"."milestones" ADD CONSTRAINT "milestones_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "invoicer"."briefs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "invoicer"."one_off_charges" ADD CONSTRAINT "one_off_charges_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "invoicer"."clients"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "invoicer"."receipts" ADD CONSTRAINT "receipts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "invoicer"."invoices"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "invoicer"."week_adjustments" ADD CONSTRAINT "week_adjustments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "invoicer"."clients"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "interval_cwd_idx" ON "invoicer"."activity_intervals" USING btree ("cwd");
CREATE INDEX "brief_client_idx" ON "invoicer"."briefs" USING btree ("client_id");
CREATE UNIQUE INDEX "folder_path_unique" ON "invoicer"."folder_mappings" USING btree ("path");
CREATE INDEX "folder_client_idx" ON "invoicer"."folder_mappings" USING btree ("client_id");
CREATE INDEX "line_invoice_idx" ON "invoicer"."invoice_lines" USING btree ("invoice_id");
CREATE UNIQUE INDEX "invoices_client_week_unique" ON "invoicer"."invoices" USING btree ("client_id","prev_billed_through_ms") WHERE "invoicer"."invoices"."prev_billed_through_ms" >= 0;
CREATE UNIQUE INDEX "invoices_number_unique" ON "invoicer"."invoices" USING btree ("number");
CREATE UNIQUE INDEX "invoices_converted_from_unique" ON "invoicer"."invoices" USING btree ("converted_from_id") WHERE "invoicer"."invoices"."converted_from_id" IS NOT NULL;
CREATE UNIQUE INDEX "invoices_milestone_unique" ON "invoicer"."invoices" USING btree ("milestone_id") WHERE "invoicer"."invoices"."milestone_id" IS NOT NULL;
CREATE UNIQUE INDEX "milestones_brief_key_unique" ON "invoicer"."milestones" USING btree ("brief_id","key");
CREATE INDEX "milestone_brief_idx" ON "invoicer"."milestones" USING btree ("brief_id");
CREATE INDEX "oneoff_client_idx" ON "invoicer"."one_off_charges" USING btree ("client_id");
CREATE UNIQUE INDEX "payment_accounts_currency_unique" ON "invoicer"."payment_accounts" USING btree ("currency");
CREATE UNIQUE INDEX "receipts_invoice_unique" ON "invoicer"."receipts" USING btree ("invoice_id");

-- The schema is not in Supabase's exposed list, so the Data API can't reach it;
-- revoking the API roles makes that hold even if someone later exposes it.
REVOKE ALL ON SCHEMA "invoicer" FROM anon, authenticated;
