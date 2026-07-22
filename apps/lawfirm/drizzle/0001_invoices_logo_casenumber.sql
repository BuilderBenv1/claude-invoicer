CREATE TABLE "invoice_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"label" text NOT NULL,
	"hours" double precision DEFAULT 0 NOT NULL,
	"rate_per_hour" double precision DEFAULT 0 NOT NULL,
	"amount" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"client_id" text NOT NULL,
	"project_id" text,
	"status" text DEFAULT 'unpaid' NOT NULL,
	"currency" text NOT NULL,
	"subtotal" double precision NOT NULL,
	"notes" text,
	"firm_name" text DEFAULT '' NOT NULL,
	"firm_email" text,
	"firm_address" text,
	"firm_phone" text,
	"tax_id" text,
	"logo_url" text,
	"client_name" text NOT NULL,
	"client_email" text,
	"client_address" text,
	"case_number" text,
	"case_name" text,
	"emailed_at" timestamp with time zone,
	"emailed_to" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "case_number" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "invoice_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_line_invoice_idx" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_client_idx" ON "invoices" USING btree ("client_id");