CREATE TABLE "training_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"pod_report_id" integer,
	"cycle" integer,
	"start_ms" bigint,
	"end_ms" bigint,
	"recorded_at" timestamp with time zone NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"vars" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"discarded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "training_reports_client_uq" UNIQUE("org_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "training_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"athlete_id" uuid NOT NULL,
	"set_id" text,
	"program_path" text NOT NULL,
	"revision_id" uuid,
	"preset_id" uuid,
	"content_sha256" text,
	"started_at" timestamp with time zone NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "training_sessions_client_uq" UNIQUE("org_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "training_values" (
	"report_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"t" bigint NOT NULL,
	"metric" text NOT NULL,
	"pod" integer NOT NULL,
	"ms" integer NOT NULL,
	CONSTRAINT "training_values_report_id_n_pk" PRIMARY KEY("report_id","n")
);
--> statement-breakpoint
ALTER TABLE "athletes" ADD COLUMN "consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "athletes" ADD COLUMN "consent_by" uuid;--> statement-breakpoint
ALTER TABLE "training_reports" ADD CONSTRAINT "training_reports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_reports" ADD CONSTRAINT "training_reports_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_revision_id_program_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."program_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_preset_id_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."presets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_values" ADD CONSTRAINT "training_values_report_id_training_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."training_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_reports_session_idx" ON "training_reports" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "training_sessions_athlete_idx" ON "training_sessions" USING btree ("athlete_id","started_at");--> statement-breakpoint
ALTER TABLE "athletes" ADD CONSTRAINT "athletes_consent_by_users_id_fk" FOREIGN KEY ("consent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;