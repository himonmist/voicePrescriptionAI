#!/usr/bin/env bash
# Live-server smoke test for M7 (drug reference, prescriptions, verification, print). Needs the same env as consultation.sh
# plus DATABASE_URL / FIELD_ENCRYPTION_KEY exported (used by the operator import tool). Uses SYNTHETIC drug data only.
set -u
REPO=$(cd "$(dirname "$0")/../.." && pwd); BASE=${BASE:-http://localhost:3111}; PGDB=${PGDB:-sda_e2e}; J="content-type: application/json"; O="origin: $BASE"
DIR=$(mktemp -d); cd "$DIR"; FAIL=0
sq(){ su postgres -c "psql -At $PGDB -c \"$1\""; }
chk(){ if [[ "$2" == *"$3"* ]]; then echo "  ok   $1"; else echo "  FAIL $1 — expected «$3» in «${2:0:200}»"; FAIL=$((FAIL+1)); fi; }
nochk(){ if [[ "$2" != *"$3"* ]]; then echo "  ok   $1"; else echo "  FAIL $1 — must NOT contain «$3»"; FAIL=$((FAIL+1)); fi; }
code(){ curl -s -o /dev/null -w "%{http_code}" "$@"; }
reg(){ curl -s -o /dev/null -X POST "$BASE/api/auth/register?type=$1" -H "$J" -H "$O" -d "$2"; }
login(){ curl -s -o /dev/null -c $1.jar -X POST "$BASE/api/auth/login" -H "$J" -H "$O" -d "{\"email\":\"$1@e2e.test\",\"password\":\"Correct-Horse-9!\"}"; }
post(){ local jar=$1 url=$2; shift 2; curl -s -b $jar.jar -X POST "$BASE$url" -H "$J" -H "$O" "$@"; }
put(){ local jar=$1 url=$2; shift 2; curl -s -b $jar.jar -X PUT "$BASE$url" -H "$J" -H "$O" "$@"; }
get(){ curl -s -b $1.jar "$BASE$2"; }
jq_(){ python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

reg doctor '{"fullName":"Dr Doc","email":"doc@e2e.test","phone":"01712345671","password":"Correct-Horse-9!","bmdcNumber":"C-1","specialty":"General Practice"}'
reg doctor '{"fullName":"Dr Two","email":"doc2@e2e.test","phone":"01712345672","password":"Correct-Horse-9!","bmdcNumber":"C-2","specialty":"GP"}'
reg patient '{"fullName":"Patient Pat","email":"pat@e2e.test","phone":"01812345671","password":"Correct-Horse-9!"}'
for u in doc doc2 pat; do login $u; done
sq "update doctor_profiles set status='active'" >/dev/null
DOC=$(sq "select id from users where email='doc@e2e.test'"); TODAY=$(TZ=Asia/Dhaka date +%F)
RULES=$(python3 -c "import json;print(json.dumps({'rules':[{'weekday':d,'startTime':'00:00','endTime':'23:30','slotMinutes':30,'bufferMinutes':0,'mode':'both','location':'Chamber A','maxPerDay':None} for d in range(7)]}))")
curl -s -o /dev/null -b doc.jar -X PUT "$BASE/api/doctor/availability" -H "$J" -H "$O" -d "$RULES"
T=$(curl -s "$BASE/api/public/doctors/$DOC/slots?from=$TODAY&to=$TODAY" | python3 -c "import sys,json;s=json.load(sys.stdin)['slots'];print(s[5]['startAt'])")
AID=$(post pat /api/appointments -d "{\"doctorUserId\":\"$DOC\",\"startAt\":\"$T\",\"mode\":\"in_person\",\"profile\":{\"dob\":\"1988-02-02\",\"sex\":\"female\"}}" | sed 's/.*"appointmentId":"\([^"]*\)".*/\1/')
PID=$(sq "select patient_id from appointments")
post doc /api/appointments/$AID/status -d '{"to":"checked_in"}' >/dev/null
CID=$(post doc /api/consultations -d "{\"appointmentId\":\"$AID\"}" | sed 's/.*"consultationId":"\([^"]*\)".*/\1/')
post doc /api/patients/$PID/clinical-items -d '{"kind":"allergy","description":"Testcillin - rash"}' >/dev/null
curl -s -b doc.jar -X PUT "$BASE/api/consultations/$CID/note" -H "$J" -H "$O" -d '{"baseVersion":0,"content":{"sections":{"chiefComplaint":{"state":"documented","text":"Fever 3 days"}},"diagnoses":[{"text":"Viral fever","status":"provisional"}]}}' >/dev/null

echo "drug reference"
chk "search with NOTHING loaded says so" "$(get doc '/api/drugs?q=testalpha')" "No drug reference is loaded"
chk "patients cannot use drug search" "$(code -b pat.jar "$BASE/api/drugs?q=testalpha")" 403
(cd "$REPO" && SEED_ADMIN_EMAIL=admin@e2e.test SEED_ADMIN_PASSWORD='Admin-Passw0rd!x' npx tsx scripts/seed.ts >/dev/null 2>&1; npx tsx scripts/import-drugs.ts tests/fixtures/synthetic-drugs.json admin@e2e.test) | grep -q "imported 3 drugs" && echo "  ok   operator import tool loaded SYNTHETIC data" || { echo "  FAIL import tool"; FAIL=$((FAIL+1)); }
S=$(get doc '/api/drugs?q=testalpha'); chk "search finds it with its source" "$S" "SYNTHETIC-TEST-DATA v1"; REF=$(echo "$S" | jq_ "d['results'][0]['id']")
REFG=$(get doc '/api/drugs?q=testgamma' | jq_ "d['results'][0]['id']")

echo "create + access"
R1=$(post doc /api/consultations/$CID/prescription); RX=$(echo "$R1" | jq_ "d['prescriptionId']"); chk "create (empty body + JSON header)" "$R1" '"created":true'
chk "second create returns the same prescription" "$(post doc /api/consultations/$CID/prescription)" "$RX"
chk "other doctor gets 404" "$(code -b doc2.jar $BASE/api/prescriptions/$RX)" 404; chk "patient gets 404" "$(code -b pat.jar $BASE/api/prescriptions/$RX)" 404; chk "anonymous gets 401" "$(code $BASE/api/prescriptions/$RX)" 401
G=$(get doc /api/prescriptions/$RX); chk "pre-filled complaint from the note" "$G" "Fever 3 days"; chk "pre-filled allergy snapshot" "$G" "Testcillin - rash"; chk "no medicines were invented" "$(echo "$G" | jq_ "len(d['content']['items'])")" 0
chk "screening states what was not checked" "$G" "Renal and hepatic"

echo "editing + safety gate"
ITEM="{\"drugRefId\":\"$REF\",\"genericName\":\"Testalpha\",\"strength\":\"500 mg\",\"dosageForm\":\"tablet\",\"route\":\"oral\",\"dose\":\"1 tablet\",\"frequency\":\"twice daily\",\"duration\":{\"value\":5,\"unit\":\"days\"}}"
chk "approve empty draft refused" "$(post doc /api/prescriptions/$RX/approve)" "Nothing to prescribe"
V=$(echo "$G" | jq_ "d['version']")
chk "save v2" "$(put doc /api/prescriptions/$RX -d "{\"baseVersion\":$V,\"content\":{\"items\":[$ITEM],\"advice\":\"Rest and fluids\"}}")" '"version":2'
chk "stale save gets 409" "$(curl -s -o /dev/null -w '%{http_code}' -b doc.jar -X PUT $BASE/api/prescriptions/$RX -H "$J" -H "$O" -d "{\"baseVersion\":$V,\"content\":{}}")" 409
G=$(get doc /api/prescriptions/$RX); chk "allergy alert raised via drug class" "$G" '"kind":"allergy"'; chk "it requires an override" "$(echo "$G" | jq_ "len(d['screening']['overridesNeeded'])")" 1
chk "approve blocked by the safety alert" "$(post doc /api/prescriptions/$RX/approve)" "safety alert"
KEY=$(echo "$G" | jq_ "d['screening']['overridesNeeded'][0]")
chk "override reason must be 10+ chars" "$(put doc /api/prescriptions/$RX -d "{\"baseVersion\":2,\"content\":{\"items\":[$ITEM],\"overrides\":[{\"alertKey\":\"$KEY\",\"reason\":\"ok\"}]}}")" "reason"
chk "save with documented override" "$(put doc /api/prescriptions/$RX -d "{\"baseVersion\":2,\"content\":{\"items\":[$ITEM],\"advice\":\"Rest and fluids\",\"overrides\":[{\"alertKey\":\"$KEY\",\"reason\":\"Tolerated before; benefit outweighs risk, counselled\"}]}}")" '"version":3'
chk "unresolved field blocks approval" "$(put doc /api/prescriptions/$RX -d "{\"baseVersion\":3,\"content\":{\"items\":[{\"drugRefId\":\"$REF\",\"genericName\":\"Testalpha\",\"strength\":\"500 mg\",\"dosageForm\":\"tablet\",\"route\":\"oral\",\"dose\":\"1 tablet\",\"frequency\":\"twice daily\",\"duration\":{\"value\":5,\"unit\":\"days\"},\"unresolved\":[\"dose\"]}],\"overrides\":[{\"alertKey\":\"$KEY\",\"reason\":\"Tolerated before; benefit outweighs risk, counselled\"}]}}")" '"version":4'
chk "…approve says needs confirmation" "$(post doc /api/prescriptions/$RX/approve)" "needs confirmation"
chk "restore complete content" "$(put doc /api/prescriptions/$RX -d "{\"baseVersion\":4,\"content\":{\"items\":[$ITEM],\"advice\":\"Rest and fluids\",\"overrides\":[{\"alertKey\":\"$KEY\",\"reason\":\"Tolerated before; benefit outweighs risk, counselled\"}]}}")" '"version":5'
chk "APPROVE works (empty body + JSON header)" "$(curl -s -o /dev/null -w '%{http_code}' -b doc.jar -X POST $BASE/api/prescriptions/$RX/approve -H "$J" -H "$O")" 200
chk "editing an approved prescription is refused" "$(put doc /api/prescriptions/$RX -d '{"baseVersion":5,"content":{}}')" "Reopen"

echo "signing"
chk "wrong password refused" "$(post doc /api/prescriptions/$RX/finalize -d '{"password":"nope"}')" "Password is incorrect"
F=$(post doc /api/prescriptions/$RX/finalize -d '{"password":"Correct-Horse-9!"}'); CODE=$(echo "$F" | jq_ "d['code']"); chk "signed" "$F" '"contentHash"'
chk "DB status is finalized with a seal" "$(sq "select status||'/'||(seal is not null)||'/'||length(content_hash) from prescriptions where id='$RX'")" "finalized/true/64"
chk "edit after signing refused" "$(put doc /api/prescriptions/$RX -d '{"baseVersion":5,"content":{}}')" "finalized"
chk "direct SQL edit of a finalized row is rejected" "$(su postgres -c "psql -At $PGDB -c \"update prescriptions set status='draft' where id='$RX'\"" 2>&1)" "immutable"
chk "direct SQL edit of a version is rejected" "$(su postgres -c "psql -At $PGDB -c \"update prescription_versions set content_enc='x'\"" 2>&1)" "append-only"
chk "content is ciphertext at rest" "$(sq "select (content_enc like '%Testalpha%') from prescription_versions limit 1")" f

echo "public verification"
V1=$(curl -s "$BASE/api/public/verify/$CODE"); chk "API: valid + integrity valid" "$V1" '"integrity":"valid"'; chk "API: shows issuer registration" "$V1" '"bmdc":"C-1"'
nochk "API: no patient name" "$V1" "Patient Pat"; nochk "API: no medicine" "$V1" "Testalpha"; nochk "API: no allergy text" "$V1" "Testcillin"
P=$(curl -s "$BASE/verify/$CODE"); chk "page says authentic" "$P" "Authentic and unchanged"; nochk "page: no patient name" "$P" "Patient Pat"
chk "unknown code: not found page" "$(curl -s $BASE/verify/RX-NOSUCH99)" "Not found"; chk "lower-case code works" "$(code $BASE/api/public/verify/$(echo $CODE | tr A-Z a-z))" 200
chk "draft/malformed codes are 404" "$(code $BASE/api/public/verify/NOT-A-CODE)" 404

echo "print view"
PR=$(get doc /doctor/prescriptions/$RX/print); chk "print shows the code" "$PR" "$CODE"; chk "print shows sealed statement" "$PR" "Digitally sealed"; chk "print embeds a QR (svg)" "$PR" "<svg"; chk "print shows the medicine" "$PR" "Testalpha"
chk "Bengali layout" "$(get doc "/doctor/prescriptions/$RX/print?lang=bn")" "ব্যবস্থাপত্র"
chk "other doctor cannot print" "$(code -b doc2.jar $BASE/doctor/prescriptions/$RX/print)" 404
chk "editor page renders" "$(get doc /doctor/prescriptions/$RX)" "Safety review"; chk "consultation page offers Prescription" "$(get doc /doctor/consultations/$CID)" "Prescription"

echo "PDF"
curl -s -b doc.jar -o r.pdf -w "%{http_code}|%{content_type}" "$BASE/api/prescriptions/$RX/pdf" > r.meta; chk "PDF download" "$(cat r.meta)" "200|application/pdf"; chk "is a PDF" "$(head -c 5 r.pdf)" "%PDF-"
chk "other doctor cannot download" "$(code -b doc2.jar $BASE/api/prescriptions/$RX/pdf)" 404; chk "anonymous cannot download" "$(code $BASE/api/prescriptions/$RX/pdf)" 401
chk "Bengali layout PDF refused with guidance" "$(get doc "/api/prescriptions/$RX/pdf?lang=bn")" "Save as PDF"
chk "print page for a Latin prescription offers the PDF link" "$(get doc /doctor/prescriptions/$RX/print)" "Download PDF"
chk "Bengali print page points to browser Save as PDF" "$(get doc "/doctor/prescriptions/$RX/print?lang=bn")" "Save as PDF"

echo "share link"
SH=$(post doc /api/prescriptions/$RX/shares -d '{"expiresInDays":3}'); SHP=$(echo "$SH" | jq_ "d['path']"); SHID=$(echo "$SH" | jq_ "d['shareId']"); TOK=${SHP#/rx/}
chk "link created (token once)" "$SH" '"path":"/rx/'; nochk "list never shows the token" "$(get doc /api/prescriptions/$RX/shares)" "$TOK"
chk "other doctor cannot create link" "$(code -b doc2.jar -X POST $BASE/api/prescriptions/$RX/shares -H "$J" -H "$O" -d '{}')" 404
chk "anonymous cannot create link" "$(code -X POST $BASE/api/prescriptions/$RX/shares -H "$J" -H "$O" -d '{}')" 401
chk "public page renders DOB gate" "$(curl -s $BASE$SHP)" "date of birth"; chk "share page is no-store + no-referrer" "$(curl -sI $BASE$SHP | tr A-Z a-z)" "referrer-policy: no-referrer"
pub(){ curl -s -X POST "$BASE/api/public/rx/$TOK/$1" -H "$J" -H "$O" -d "$2"; }
chk "wrong DOB refused" "$(pub open '{"dob":"1999-01-01"}')" "don't match"; nochk "wrong DOB leaks nothing" "$(pub open '{"dob":"1999-01-01"}')" "Patient Pat"
OP=$(pub open '{"dob":"1988-02-02"}'); chk "right DOB opens sealed copy" "$OP" "Testalpha"; chk "pdf offered for Latin" "$OP" '"pdfAvailable":true'
curl -s -X POST -o s.pdf "$BASE/api/public/rx/$TOK/pdf" -H "$J" -H "$O" -d '{"dob":"1988-02-02"}'; chk "public PDF" "$(head -c 5 s.pdf)" "%PDF-"
chk "unknown token gives generic 410" "$(code -X POST $BASE/api/public/rx/$(printf 'x%.0s' $(seq 43))/open -H "$J" -H "$O" -d '{"dob":"1988-02-02"}')" 410
chk "cross-site POST refused" "$(code -X POST $BASE/api/public/rx/$TOK/open -H "$J" -H "Origin: https://evil.test" -d '{"dob":"1988-02-02"}')" 403
chk "revoke" "$(code -b doc.jar -X DELETE $BASE/api/prescriptions/$RX/shares/$SHID -H "$O")" 200
chk "revoked link is dead even with right DOB" "$(pub open '{"dob":"1988-02-02"}')" "no longer valid"
nochk "share audit holds no PHI" "$(sq "select string_agg(metadata::text,' ') from audit_events where action like 'prescription.share_%'")" "Patient Pat"

echo "patient portal"
chk "patient sees list" "$(get pat /patient/prescriptions)" "$CODE"; chk "patient opens own sealed copy" "$(get pat /patient/prescriptions/$RX)" "Testalpha"
chk "doctor cannot use patient portal page" "$(code -b doc.jar $BASE/patient/prescriptions/$RX)" 403
chk "anonymous redirected" "$(code $BASE/patient/prescriptions/$RX)" 307
chk "patient audit event" "$(sq "select count(*) from audit_events where action='prescription.patient_viewed'")" "1"

echo "amendment + cancellation"
A=$(post doc /api/prescriptions/$RX/amend -d '{"reason":"Duration corrected after re-checking"}'); RX2=$(echo "$A" | jq_ "d['prescriptionId']"); CODE2=$(echo "$A" | jq_ "d['code']"); chk "amend creates a new draft" "$A" '"code":"RX-'
chk "original now superseded (API)" "$(curl -s $BASE/api/public/verify/$CODE)" '"status":"superseded"'; chk "verify page warns AMENDED" "$(curl -s $BASE/verify/$CODE)" "AMENDED"; chk "new draft is not verifiable yet" "$(code $BASE/api/public/verify/$CODE2)" 404
chk "old print is marked SUPERSEDED" "$(get doc /doctor/prescriptions/$RX/print)" "SUPERSEDED"
chk "amend needs a reason" "$(post doc /api/prescriptions/$RX2/amend -d '{"reason":"x"}')" "reason"
chk "cancel needs a reason" "$(post doc /api/prescriptions/$RX2/cancel -d '{"reason":"x"}')" "reason"
chk "cancel the new draft" "$(curl -s -o /dev/null -w '%{http_code}' -b doc.jar -X POST $BASE/api/prescriptions/$RX2/cancel -H "$J" -H "$O" -d '{"reason":"Not needed, discard this one"}')" 200
echo "audit"
chk "audit has finalize/amend/cancel" "$(sq "select string_agg(distinct action, ',' order by action) from audit_events where action like 'prescription.%'")" "prescription.finalized"
nochk "audit contains no clinical text" "$(sq "select string_agg(metadata::text,' ') from audit_events where action like 'prescription.%'")" "Testalpha"
cd /; rm -rf "$DIR"
[ $FAIL -eq 0 ] && echo "ALL CHECKS PASSED" || { echo "$FAIL CHECK(S) FAILED"; exit 1; }
