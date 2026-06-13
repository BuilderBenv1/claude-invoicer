CREATE TABLE "one_off_charges" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"description" text NOT NULL,
	"amount" double precision NOT NULL,
	"billed_invoice_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "folder_mappings" ADD COLUMN "hourly_rate" double precision;--> statement-breakpoint
ALTER TABLE "one_off_charges" ADD CONSTRAINT "one_off_charges_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oneoff_client_idx" ON "one_off_charges" USING btree ("client_id");