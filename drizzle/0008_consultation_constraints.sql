ALTER TABLE consultations ADD CONSTRAINT consult_status_valid CHECK (status IN ('in_progress','completed','cancelled'));
--> statement-breakpoint
ALTER TABLE consultations ADD CONSTRAINT consult_mode_valid CHECK (mode IN ('in_person','online'));
--> statement-breakpoint
ALTER TABLE audio_sessions ADD CONSTRAINT audio_status_valid CHECK (status IN ('active','paused','stopped'));
--> statement-breakpoint
ALTER TABLE transcript_segments ADD CONSTRAINT segment_speaker_valid CHECK (speaker IN ('doctor','patient','other','unknown'));
--> statement-breakpoint
ALTER TABLE transcript_segments ADD CONSTRAINT segment_source_valid CHECK (source IN ('manual','stt'));
--> statement-breakpoint
ALTER TABLE transcript_segments ADD CONSTRAINT segment_time_order CHECK (start_ms IS NULL OR end_ms IS NULL OR (start_ms >= 0 AND end_ms >= start_ms));
--> statement-breakpoint
ALTER TABLE clinical_notes ADD CONSTRAINT note_status_valid CHECK (status IN ('draft','approved'));
--> statement-breakpoint
ALTER TABLE clinical_note_versions ADD CONSTRAINT note_version_kind_valid CHECK (kind IN ('edit','amendment'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION clinical_note_versions_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'clinical_note_versions is append-only'; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER clinical_note_versions_no_change BEFORE UPDATE OR DELETE ON clinical_note_versions
FOR EACH ROW EXECUTE FUNCTION clinical_note_versions_immutable();
