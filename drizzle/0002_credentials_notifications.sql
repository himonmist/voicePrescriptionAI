CREATE TYPE "public"."credential_status" AS ENUM('pending', 'verified', 'rejected', 'expired');--> statement-breakpoint
CREATE TABLE "doctor_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" "credential_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"review_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "doctor_credentials" ADD CONSTRAINT "doctor_credentials_doctor_id_doctor_profiles_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cred_doctor_idx" ON "doctor_credentials" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "cred_expiry_idx" ON "doctor_credentials" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "notif_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notif_status_idx" ON "notifications" USING btree ("status");