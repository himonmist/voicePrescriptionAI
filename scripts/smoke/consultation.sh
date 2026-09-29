#!/usr/bin/env bash
# Live-server smoke test for M4–M6 (patients, appointments, consultations). Needs: a running app (BASE), a migrated
# DISPOSABLE database reachable via `su postgres -c psql $PGDB`, and FIELD_ENCRYPTION_KEY identical to the server's.
# It sends `Content-Type: application/json` even with empty bodies, exactly like the browser client does.
set -u
BASE=${BASE:-http://localhost:3111}; PGDB=${PGDB:-sda_e2e}; J="content-type: application/json"; O="origin: $BASE"
DIR=$(mktemp -d); cd "$DIR"; FAIL=0
sq(){ su postgres -c "psql -At $PGDB -c \"$1\""; }
chk(){ if [[ "$2" == *"$3"* ]]; then echo "  ok   $1"; else echo "  FAIL $1 — expected «$3» in «${2:0:160}»"; FAIL=$((FAIL+1)); fi; }
code(){ curl -s -o /dev/null -w "%{http_code}" "$@"; }
reg(){ curl -s -o /dev/null -X POST "$BASE/api/auth/register?type=$1" -H "$J" -H "$O" -d "$2"; }
login(){ curl -s -o /dev/null -c $1.jar -X POST "$BASE/api/auth/login" -H "$J" -H "$O" -d "{\"email\":\"$1@e2e.test\",\"password\":\"Correct-Horse-9!\"}"; }
post(){ local jar=$1 url=$2; shift 2; curl -s -b $jar.jar -X POST "$BASE$url" -H "$J" -H "$O" "$@"; }   # body optional
pcode(){ local jar=$1 url=$2; shift 2; curl -s -o /dev/null -w "%{http_code}" -b $jar.jar -X POST "$BASE$url" -H "$J" -H "$O" "$@"; }

reg doctor '{"fullName":"Dr Doc","email":"doc@e2e.test","phone":"01712345671","password":"Correct-Horse-9!","bmdcNumber":"C-1","specialty":"GP"}'
reg doctor '{"fullName":"Dr Two","email":"doc2@e2e.test","phone":"01712345672","password":"Correct-Horse-9!","bmdcNumber":"C-2","specialty":"GP"}'
reg patient '{"fullName":"Patient Pat","email":"pat@e2e.test","phone":"01812345671","password":"Correct-Horse-9!"}'
for u in doc doc2 pat; do login $u; done
sq "update doctor_profiles set status='active'" >/dev/null
DOC=$(sq "select id from users where email='doc@e2e.test'"); TODAY=$(TZ=Asia/Dhaka date +%F)
RULES=$(python3 -c "import json;print(json.dumps({'rules':[{'weekday':d,'startTime':'00:00','endTime':'23:30','slotMinutes':30,'bufferMinutes':0,'mode':'both','location':'Chamber A','maxPerDay':None} for d in range(7)]}))")
curl -s -o /dev/null -b doc.jar -X PUT "$BASE/api/doctor/availability" -H "$J" -H "$O" -d "$RULES"
T=$(curl -s "$BASE/api/public/doctors/$DOC/slots?from=$TODAY&to=$TODAY" | python3 -c "import sys,json;s=json.load(sys.stdin)['slots'];print(s[4]['startAt'])")
AID=$(post pat /api/appointments -d "{\"doctorUserId\":\"$DOC\",\"startAt\":\"$T\",\"mode\":\"in_person\",\"profile\":{\"dob\":\"1988-02-02\",\"sex\":\"female\"}}" | sed 's/.*"appointmentId":"\([^"]*\)".*/\1/')
PID=$(sq "select patient_id from appointments")
post doc /api/patients/$PID/clinical-items -d '{"kind":"allergy","description":"Penicillin - rash"}' >/dev/null

echo "start / idempotency"
chk "start before check-in refused (422)" "$(pcode doc /api/consultations -d "{\"appointmentId\":\"$AID\"}")" 422
post doc /api/appointments/$AID/status -d '{"to":"checked_in"}' >/dev/null
R1=$(post doc /api/consultations -d "{\"appointmentId\":\"$AID\"}"); CID=$(echo "$R1" | sed 's/.*"consultationId":"\([^"]*\)".*/\1/')
chk "first start creates" "$R1" '"created":true'; chk "second start is the same consultation" "$(post doc /api/consultations -d "{\"appointmentId\":\"$AID\"}")" "$CID"
chk "exactly one consultation row" "$(sq 'select count(*) from consultations')" 1; chk "appointment is in_progress" "$(sq 'select status from appointments')" in_progress
echo "access"
chk "patient gets 404" "$(code -b pat.jar $BASE/api/consultations/$CID)" 404; chk "other doctor gets 404" "$(code -b doc2.jar $BASE/api/consultations/$CID)" 404; chk "anonymous gets 401" "$(code $BASE/api/consultations/$CID)" 401
chk "workspace shows allergy banner data" "$(curl -s -b doc.jar $BASE/api/consultations/$CID)" "Penicillin - rash"
echo "transcript"
S=$(post doc /api/consultations/$CID/transcript -d '{"speaker":"patient","text":"আমার তিন দিন ধরে জ্বর","startMs":0,"endMs":3000}'); SID=$(echo "$S" | sed 's/.*"id":"\([^"]*\)".*/\1/'); chk "Bangla accepted" "$S" "জ্বর"
E=$(curl -s -b doc.jar -X PATCH "$BASE/api/consultations/$CID/transcript/$SID" -H "$J" -H "$O" -d '{"text":"আমার জ্বর আছে","flagged":true}'); chk "edit keeps original" "$E" '"originalText":"আমার তিন দিন ধরে জ্বর"'; chk "flag set" "$E" '"flagged":true'
chk "bad speaker 422" "$(pcode doc /api/consultations/$CID/transcript -d '{"speaker":"robot","text":"x"}')" 422
echo "note versions"
N1='{"baseVersion":0,"content":{"sections":{"chiefComplaint":{"state":"documented","text":"Fever for 3 days"}},"vitals":{"tempC":39.1},"diagnoses":[{"text":"Viral fever","status":"provisional"}]}}'
chk "v1 saved with vitals review flag" "$(curl -s -b doc.jar -X PUT $BASE/api/consultations/$CID/note -H "$J" -H "$O" -d "$N1")" "temperature"
chk "stale tab gets 409" "$(curl -s -o /dev/null -w '%{http_code}' -b doc.jar -X PUT $BASE/api/consultations/$CID/note -H "$J" -H "$O" -d "$N1")" 409
chk "documented-but-empty rejected 422" "$(curl -s -o /dev/null -w '%{http_code}' -b doc.jar -X PUT $BASE/api/consultations/$CID/note -H "$J" -H "$O" -d '{"baseVersion":1,"content":{"sections":{"hpi":{"state":"documented","text":""}}}}')" 422
chk "APPROVE with empty body + JSON header works (browser behaviour)" "$(pcode doc /api/consultations/$CID/note/approve)" 200
chk "silent edit of approved note refused" "$(curl -s -b doc.jar -X PUT $BASE/api/consultations/$CID/note -H "$J" -H "$O" -d '{"baseVersion":1,"content":{"sections":{"chiefComplaint":{"state":"documented","text":"Fever for 4 days"}}}}')" "amendment reason"
chk "amendment accepted" "$(curl -s -b doc.jar -X PUT $BASE/api/consultations/$CID/note -H "$J" -H "$O" -d '{"baseVersion":1,"amendmentReason":"Duration corrected after re-asking","content":{"sections":{"chiefComplaint":{"state":"documented","text":"Fever for 4 days"}}}}')" '"version":2'
chk "history lists the amendment" "$(curl -s -b doc.jar $BASE/api/consultations/$CID/note/versions)" '"kind":"amendment"'
chk "v1 original preserved" "$(curl -s -b doc.jar $BASE/api/consultations/$CID/note/versions/1)" "Fever for 3 days"
echo "recording consent"
chk "start without consent refused" "$(post doc /api/consultations/$CID/recording -d '{"action":"start"}')" "consent"
post doc /api/patients/$PID/consents -d '{"kind":"recording","granted":true,"method":"in_person"}' >/dev/null
chk "start with consent" "$(post doc /api/consultations/$CID/recording -d '{"action":"start"}')" '"status":"active"'
post doc /api/patients/$PID/consents -d '{"kind":"recording","granted":false,"method":"in_person"}' >/dev/null
chk "withdrawal stopped the live session" "$(sq "select status||'/'||stop_reason from audio_sessions")" "stopped/consent_withdrawn"
chk "restart refused after withdrawal" "$(post doc /api/consultations/$CID/recording -d '{"action":"start"}')" "consent"
echo "pages"
chk "workspace page renders" "$(curl -s -b doc.jar $BASE/doctor/consultations/$CID)" "Recording &amp; consent"; chk "other doctor 404 page" "$(code -b doc2.jar $BASE/doctor/consultations/$CID)" 404; chk "patient blocked (403)" "$(code -b pat.jar $BASE/doctor/consultations/$CID)" 403
chk "appointments page offers Open consultation" "$(curl -s -b doc.jar $BASE/doctor/appointments)" "Open consultation"; chk "record page offers walk-in" "$(curl -s -b doc.jar $BASE/doctor/patients/$PID)" "Start walk-in consultation"
echo "complete"
chk "COMPLETE with empty body + JSON header works" "$(pcode doc /api/consultations/$CID/complete)" 200; chk "appointment completed" "$(sq 'select status from appointments')" completed
chk "transcript locked after completion" "$(post doc /api/consultations/$CID/transcript -d '{"speaker":"doctor","text":"late"}')" "completed"
chk "completing twice refused" "$(pcode doc /api/consultations/$CID/complete)" 422
echo "at rest"
chk "transcript is ciphertext" "$(sq "select (text_enc like '%জ্বর%') from transcript_segments limit 1")" f; chk "note is ciphertext" "$(sq "select (content_enc like '%Fever%') from clinical_note_versions limit 1")" f
cd /; rm -rf "$DIR"
[ $FAIL -eq 0 ] && echo "ALL CHECKS PASSED" || { echo "$FAIL CHECK(S) FAILED"; exit 1; }
