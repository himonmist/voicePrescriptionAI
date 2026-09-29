CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE appointments ADD CONSTRAINT appt_time_order CHECK (end_at > start_at);
--> statement-breakpoint
ALTER TABLE appointments ADD CONSTRAINT appt_status_valid CHECK (status IN ('booked','checked_in','in_progress','completed','cancelled','no_show'));
--> statement-breakpoint
ALTER TABLE appointments ADD CONSTRAINT appt_mode_valid CHECK (mode IN ('in_person','online'));
--> statement-breakpoint
ALTER TABLE appointments ADD CONSTRAINT appt_no_doctor_overlap EXCLUDE USING gist (doctor_user_id WITH =, tstzrange(start_at, end_at) WITH &&) WHERE (status IN ('booked','checked_in','in_progress'));
--> statement-breakpoint
ALTER TABLE appointments ADD CONSTRAINT appt_no_patient_overlap EXCLUDE USING gist (patient_id WITH =, tstzrange(start_at, end_at) WITH &&) WHERE (status IN ('booked','checked_in','in_progress'));
--> statement-breakpoint
ALTER TABLE availability_schedules ADD CONSTRAINT avail_weekday_valid CHECK (weekday BETWEEN 0 AND 6);
--> statement-breakpoint
ALTER TABLE availability_schedules ADD CONSTRAINT avail_times_valid CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND end_time > start_time);
--> statement-breakpoint
ALTER TABLE availability_schedules ADD CONSTRAINT avail_slot_valid CHECK (slot_minutes BETWEEN 5 AND 240 AND buffer_minutes BETWEEN 0 AND 120 AND mode IN ('in_person','online','both') AND (max_per_day IS NULL OR max_per_day BETWEEN 1 AND 200));
--> statement-breakpoint
ALTER TABLE availability_exceptions ADD CONSTRAINT avail_ex_kind_valid CHECK (kind IN ('holiday','block'));
