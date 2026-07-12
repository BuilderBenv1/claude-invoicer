CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"address" text,
	"hourly_rate" double precision DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'ILS' NOT NULL,
	"notes" text,
	"archived" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"hourly_rate" double precision,
	"alert_threshold_hours" double precision,
	"alert_notified_hours" double precision,
	"alert_notified_at" timestamp with time zone,
	"archived" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"firm_name" text DEFAULT 'משרד עורכי דין' NOT NULL,
	"firm_email" text,
	"firm_address" text,
	"firm_phone" text,
	"tax_id" text,
	"report_email" text,
	"default_currency" text DEFAULT 'ILS' NOT NULL,
	"default_hourly_rate" double precision DEFAULT 0 NOT NULL,
	"round_increment_min" integer DEFAULT 6 NOT NULL,
	"timezone" text DEFAULT 'Asia/Jerusalem' NOT NULL,
	"locale" text DEFAULT 'he' NOT NULL,
	"auto_send_monthly" integer DEFAULT 0 NOT NULL,
	"last_monthly_sent_key" text
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"archived" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"project_id" text NOT NULL,
	"task_id" text,
	"description" text,
	"start_ms" bigint NOT NULL,
	"end_ms" bigint,
	"duration_ms" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_name_idx" ON "clients" USING btree ("name");--> statement-breakpoint
CREATE INDEX "project_client_idx" ON "projects" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "task_project_idx" ON "tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "entry_client_idx" ON "time_entries" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "entry_project_idx" ON "time_entries" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "entry_start_idx" ON "time_entries" USING btree ("start_ms");--> statement-breakpoint
-- Safety net for the "single running timer" rule: at most one row may have a
-- NULL end_ms at a time. The app also stops any running timer before starting
-- a new one; this guards against a race doing it twice.
CREATE UNIQUE INDEX "one_running_timer" ON "time_entries" ((end_ms IS NULL)) WHERE "end_ms" IS NULL;
