CREATE TABLE "activity_intervals" (
	"session_id" text NOT NULL,
	"start_ms" bigint NOT NULL,
	"end_ms" bigint NOT NULL,
	"active_ms" bigint NOT NULL,
	"cwd" text NOT NULL,
	CONSTRAINT "activity_intervals_session_id_start_ms_pk" PRIMARY KEY("session_id","start_ms")
);
--> statement-breakpoint
CREATE TABLE "clients" (
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
--> statement-breakpoint
CREATE TABLE "folder_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"path" text NOT NULL,
	"label" text
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"label" text NOT NULL,
	"hours" double precision NOT NULL,
	"rate_per_hour" double precision NOT NULL,
	"amount" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"client_id" text NOT NULL,
	"status" text DEFAULT 'unpaid' NOT NULL,
	"currency" text NOT NULL,
	"subtotal" double precision NOT NULL,
	"prev_billed_through_ms" bigint NOT NULL,
	"cutoff_ms" bigint NOT NULL,
	"business_name" text DEFAULT '' NOT NULL,
	"business_email" text,
	"business_address" text,
	"tax_id" text,
	"client_name" text NOT NULL,
	"client_email" text,
	"client_address" text,
	"notes" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"number" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"business_name" text DEFAULT 'My Business' NOT NULL,
	"business_email" text,
	"business_address" text,
	"tax_id" text,
	"default_currency" text DEFAULT 'USD' NOT NULL,
	"default_idle_cap_min" integer DEFAULT 5 NOT NULL,
	"default_round_increment_min" integer DEFAULT 15 NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"invoice_seq" integer DEFAULT 0 NOT NULL,
	"receipt_seq" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "folder_mappings" ADD CONSTRAINT "folder_mappings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interval_cwd_idx" ON "activity_intervals" USING btree ("cwd");--> statement-breakpoint
CREATE UNIQUE INDEX "folder_path_unique" ON "folder_mappings" USING btree ("path");--> statement-breakpoint
CREATE INDEX "folder_client_idx" ON "folder_mappings" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "line_invoice_idx" ON "invoice_lines" USING btree ("invoice_id");