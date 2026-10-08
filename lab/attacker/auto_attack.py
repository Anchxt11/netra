#!/usr/bin/env python3
import time
import random
import subprocess
import logging
import os
import sys

# Background pace and mix, so a demo attack from the other attacker always stands out (docs/FINAL_PLAN.md, demo plan 1):
#   AUTO_MIN_S / AUTO_MAX_S   seconds between attacks (default 60 to 180: a server under pressure, not a storm)
#   AUTO_EXCLUDE              scenarios left out (default: the two NETRA groups across addresses, so they
#                             would swallow a demo attack: credential_stuffing joins one campaign, http_flood
#                             is one attack on the whole site)
MIN_S = int(os.getenv("AUTO_MIN_S", "60"))
MAX_S = max(MIN_S, int(os.getenv("AUTO_MAX_S", "180")))
EXCLUDE = {x.strip() for x in os.getenv("AUTO_EXCLUDE", "credential_stuffing,http_flood").split(",") if x.strip()}

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', stream=sys.stdout)

# Define the attacks, their severity, and their probability weight.
ATTACKS = [
    # --- Core Scenarios ---
    {"name": "web_scan",                 "severity": "low",      "weight": 20, "risk_range": (0.20, 0.35)},
    {"name": "brute_force",              "severity": "medium",   "weight": 10, "risk_range": (0.40, 0.55)},
    {"name": "credential_stuffing",      "severity": "medium",   "weight": 10, "risk_range": (0.50, 0.65)},
    {"name": "http_flood",               "severity": "medium",   "weight": 10, "risk_range": (0.60, 0.70)},
    {"name": "sqli",                     "severity": "high",     "weight": 5,  "risk_range": (0.75, 0.85)},
    {"name": "data_exfiltration",        "severity": "high",     "weight": 3,  "risk_range": (0.80, 0.90)},
    {"name": "account_takeover",         "severity": "critical", "weight": 2,  "risk_range": (0.85, 0.90)},
    {"name": "ssrf",                     "severity": "critical", "weight": 5,  "risk_range": (0.85, 0.90)},
    
    # --- Evasion Scenarios (ML Test Set) ---
    {"name": "evasion_account_enum",     "severity": "evasion",  "weight": 5,  "risk_range": (0.10, 0.25)},
    {"name": "evasion_low_slow_brute",   "severity": "evasion",  "weight": 5,  "risk_range": (0.45, 0.55)},
    {"name": "evasion_distributed_cred", "severity": "evasion",  "weight": 5,  "risk_range": (0.55, 0.65)},
    {"name": "evasion_idor_enum",        "severity": "evasion",  "weight": 5,  "risk_range": (0.65, 0.75)},
    {"name": "evasion_slowloris",        "severity": "evasion",  "weight": 5,  "risk_range": (0.70, 0.80)},
    {"name": "evasion_xss_traversal",    "severity": "evasion",  "weight": 5,  "risk_range": (0.75, 0.85)},
    {"name": "evasion_obfuscated_sqli",  "severity": "evasion",  "weight": 5,  "risk_range": (0.80, 0.90)},
    {"name": "evasion_slow_exfil",       "severity": "evasion",  "weight": 5,  "risk_range": (0.85, 0.90)}
]

def select_attack():
    pool = [a for a in ATTACKS if a["name"] not in EXCLUDE] or ATTACKS
    total = sum(a['weight'] for a in pool)
    r = random.uniform(0, total)
    upto = 0
    for a in pool:
        if upto + a['weight'] >= r:
            return a
        upto += a['weight']
    return pool[0]

def main():
    logging.info("Live Attack Orchestrator Started.")
    logging.info(f"Background attacks every {MIN_S} to {MAX_S} s; left out: {', '.join(sorted(EXCLUDE)) or 'none'}")
    
    while True:
        delay = random.randint(MIN_S, MAX_S)
        logging.info(f"Idling... Next cyberattack will launch in {delay} seconds.")
        time.sleep(delay)
        
        attack = select_attack()
        
        # Calculate a random artificial risk score within the assigned range
        min_risk, max_risk = attack['risk_range']
        risk_score = round(random.uniform(min_risk, max_risk), 2)
        
        logging.info(f"🔥 FIRE: Launching {attack['severity'].upper()} severity attack -> {attack['name']} [Artificial Risk Score: {risk_score}]")
        
        # Execute the bash attack script natively
        try:
            subprocess.run(["attack-runner", attack["name"]], check=False)
        except Exception as e:
            logging.error(f"Failed to run attack {attack['name']}: {e}")
            
        logging.info(f"✅ COMPLETED: {attack['name']}")

if __name__ == "__main__":
    main()
