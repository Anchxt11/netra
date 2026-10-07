#!/usr/bin/env python3
import time
import random
import subprocess
import logging
import sys

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
    total = sum(a['weight'] for a in ATTACKS)
    r = random.uniform(0, total)
    upto = 0
    for a in ATTACKS:
        if upto + a['weight'] >= r:
            return a
        upto += a['weight']
    return ATTACKS[0]

def main():
    logging.info("Live Attack Orchestrator Started.")
    logging.info("Simulating random severity-based cyberattacks in the background...")
    
    while True:
        # Random delay between 5 and 10 seconds (aggressive attack feed)
        delay = random.randint(5, 10)
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
