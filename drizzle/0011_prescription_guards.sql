ALTER TABLE prescriptions ADD CONSTRAINT rx_status_valid CHECK (status IN ('draft','approved','finalized','superseded','cancelled'));
--> statement-breakpoint
ALTER TABLE prescriptions ADD CONSTRAINT rx_final_requires_seal CHECK (status NOT IN ('finalized','superseded') OR (content_hash IS NOT NULL AND seal IS NOT NULL AND finalized_at IS NOT NULL AND final_version IS NOT NULL));
--> statement-breakpoint
ALTER TABLE prescription_versions ADD CONSTRAINT rx_version_kind_valid CHECK (kind IN ('edit','amendment_copy'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prescriptions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'prescriptions cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'a prescription must start as a draft'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('superseded','cancelled') THEN RAISE EXCEPTION 'this prescription is closed and cannot change'; END IF;
  IF OLD.status = 'finalized' THEN
    -- A finalized prescription may only be closed (superseded/cancelled); its sealed identity and content pointers never change.
    IF NEW.status NOT IN ('superseded','cancelled') THEN RAISE EXCEPTION 'finalized prescriptions are immutable'; END IF;
    IF NEW.code IS DISTINCT FROM OLD.code OR NEW.consultation_id IS DISTINCT FROM OLD.consultation_id OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
       OR NEW.doctor_user_id IS DISTINCT FROM OLD.doctor_user_id OR NEW.current_version IS DISTINCT FROM OLD.current_version OR NEW.final_version IS DISTINCT FROM OLD.final_version
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.seal IS DISTINCT FROM OLD.seal OR NEW.finalized_at IS DISTINCT FROM OLD.finalized_at
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      RAISE EXCEPTION 'finalized prescriptions are immutable';
    END IF;
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code OR NEW.consultation_id IS DISTINCT FROM OLD.consultation_id OR NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.doctor_user_id IS DISTINCT FROM OLD.doctor_user_id THEN
    RAISE EXCEPTION 'prescription identity cannot change';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER prescriptions_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON prescriptions FOR EACH ROW EXECUTE FUNCTION prescriptions_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prescription_versions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (SELECT status FROM prescriptions WHERE id = NEW.prescription_id) <> 'draft' THEN RAISE EXCEPTION 'versions can only be added to a draft prescription'; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'prescription_versions is append-only';
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER prescription_versions_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON prescription_versions FOR EACH ROW EXECUTE FUNCTION prescription_versions_guard();
