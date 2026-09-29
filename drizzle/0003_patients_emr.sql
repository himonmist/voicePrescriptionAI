CREATE TABLE "patient_clinical_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"description_enc" text NOT NULL,
	"severity" text,
	"status" text DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"granted" boolean NOT NULL,
	"method" text NOT NULL,
	"policy_version" text NOT NULL,
	"captured_by" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_doctor_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text,
	"granted_by" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"merged_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"patient_code" text NOT NULL,
	"full_name" text NOT NULL,
	"full_name_norm" text NOT NULL,
	"dob" date NOT NULL,
	"sex" text DEFAULT 'unknown' NOT NULL,
	"phone_enc" text,
	"phone_idx" text,
	"email_enc" text,
	"address_enc" text,
	"emergency_contact_enc" text,
	"user_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"merged_into_id" uuid,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patient_clinical_items" ADD CONSTRAINT "patient_clinical_items_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_clinical_items" ADD CONSTRAINT "patient_clinical_items_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_captured_by_users_id_fk" FOREIGN KEY ("captured_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_doctor_relationships" ADD CONSTRAINT "patient_doctor_relationships_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_doctor_relationships" ADD CONSTRAINT "patient_doctor_relationships_doctor_user_id_users_id_fk" FOREIGN KEY ("doctor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_doctor_relationships" ADD CONSTRAINT "patient_doctor_relationships_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_doctor_relationships" ADD CONSTRAINT "patient_doctor_relationships_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_merges" ADD CONSTRAINT "patient_merges_source_id_patients_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_merges" ADD CONSTRAINT "patient_merges_target_id_patients_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_merges" ADD CONSTRAINT "patient_merges_merged_by_users_id_fk" FOREIGN KEY ("merged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pci_patient_kind_idx" ON "patient_clinical_items" USING btree ("patient_id","kind");--> statement-breakpoint
CREATE INDEX "consent_patient_kind_idx" ON "patient_consents" USING btree ("patient_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pdr_active_uq" ON "patient_doctor_relationships" USING btree ("patient_id","doctor_user_id") WHERE "patient_doctor_relationships"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "pdr_doctor_idx" ON "patient_doctor_relationships" USING btree ("doctor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_code_uq" ON "patients" USING btree ("patient_code");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_user_uq" ON "patients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "patients_org_name_idx" ON "patients" USING btree ("organization_id","full_name_norm");--> statement-breakpoint
CREATE INDEX "patients_phone_idx" ON "patients" USING btree ("phone_idx");--> statement-breakpoint
CREATE INDEX "patients_dob_idx" ON "patients" USING btree ("dob");