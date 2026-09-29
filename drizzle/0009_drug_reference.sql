CREATE TABLE "drug_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"ingredient_a" text NOT NULL,
	"ingredient_b" text NOT NULL,
	"severity" text NOT NULL,
	"description" text NOT NULL,
	"management" text
);
--> statement-breakpoint
CREATE TABLE "drug_reference_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"published_at" date NOT NULL,
	"licence_note" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"imported_by" uuid NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"drug_count" integer DEFAULT 0 NOT NULL,
	"interaction_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drug_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"generic_name" text NOT NULL,
	"ingredients" jsonb NOT NULL,
	"brand_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"drug_classes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"strength" text NOT NULL,
	"dosage_form" text NOT NULL,
	"route" text,
	"high_risk" boolean DEFAULT false NOT NULL,
	"indications" text,
	"contraindications" text,
	"warnings" text,
	"pediatric_caution" text,
	"pregnancy_caution" text,
	"renal_note" text,
	"hepatic_note" text,
	"search_text" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drug_interactions" ADD CONSTRAINT "drug_interactions_source_id_drug_reference_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."drug_reference_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drug_reference_sources" ADD CONSTRAINT "drug_reference_sources_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drug_references" ADD CONSTRAINT "drug_references_source_id_drug_reference_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."drug_reference_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drug_ix_uq" ON "drug_interactions" USING btree ("source_id","ingredient_a","ingredient_b");--> statement-breakpoint
CREATE INDEX "drug_ix_a_idx" ON "drug_interactions" USING btree ("ingredient_a");--> statement-breakpoint
CREATE INDEX "drug_ix_b_idx" ON "drug_interactions" USING btree ("ingredient_b");--> statement-breakpoint
CREATE UNIQUE INDEX "drug_source_uq" ON "drug_reference_sources" USING btree ("name","version");--> statement-breakpoint
CREATE INDEX "drug_source_status_idx" ON "drug_reference_sources" USING btree ("status");--> statement-breakpoint
CREATE INDEX "drug_ref_source_idx" ON "drug_references" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "drug_ref_generic_idx" ON "drug_references" USING btree ("generic_name");