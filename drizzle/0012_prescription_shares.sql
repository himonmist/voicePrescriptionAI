CREATE TABLE "prescription_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prescription_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"channel" text DEFAULT 'link' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"access_count" integer DEFAULT 0 NOT NULL,
	"last_accessed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "prescription_shares" ADD CONSTRAINT "prescription_shares_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_shares" ADD CONSTRAINT "prescription_shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_shares" ADD CONSTRAINT "prescription_shares_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rx_share_token_uq" ON "prescription_shares" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "rx_share_rx_idx" ON "prescription_shares" USING btree ("prescription_id");--> statement-breakpoint
ALTER TABLE "prescription_shares" ADD CONSTRAINT "rx_share_attempts_chk" CHECK ("failed_attempts" >= 0 AND "access_count" >= 0);
