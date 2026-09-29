CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_user_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"organization_id" uuid,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"mode" text NOT NULL,
	"location" text,
	"status" text DEFAULT 'booked' NOT NULL,
	"reason_enc" text,
	"booked_by" uuid NOT NULL,
	"booked_via" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"checked_in_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"start_time" text,
	"end_time" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_user_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"slot_minutes" integer NOT NULL,
	"buffer_minutes" integer DEFAULT 0 NOT NULL,
	"mode" text DEFAULT 'both' NOT NULL,
	"location" text,
	"max_per_day" integer,
	"valid_from" date,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD COLUMN "consultation_fee_bdt" integer;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD COLUMN "languages" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD COLUMN "chamber_address" text;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD COLUMN "consultation_mode" text DEFAULT 'both' NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_user_id_users_id_fk" FOREIGN KEY ("doctor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_booked_by_users_id_fk" FOREIGN KEY ("booked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_doctor_user_id_users_id_fk" FOREIGN KEY ("doctor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_schedules" ADD CONSTRAINT "availability_schedules_doctor_user_id_users_id_fk" FOREIGN KEY ("doctor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appt_doctor_start_idx" ON "appointments" USING btree ("doctor_user_id","start_at");--> statement-breakpoint
CREATE INDEX "appt_patient_start_idx" ON "appointments" USING btree ("patient_id","start_at");--> statement-breakpoint
CREATE INDEX "appt_org_start_idx" ON "appointments" USING btree ("organization_id","start_at");--> statement-breakpoint
CREATE INDEX "appt_status_idx" ON "appointments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "avail_ex_doctor_idx" ON "availability_exceptions" USING btree ("doctor_user_id","date");--> statement-breakpoint
CREATE INDEX "avail_doctor_idx" ON "availability_schedules" USING btree ("doctor_user_id","weekday");