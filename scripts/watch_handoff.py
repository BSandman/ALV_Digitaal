#!/usr/bin/env python3
"""
watch_handoff.py — referentie-watcher voor de geautomatiseerde ALV_Digitaal-pijplijn.

Elke AI (Codex, Gemini, Claude, Mistral) draait dit lokaal met zijn eigen ROLE.
De watcher pollt Git, leest de frontmatter van handoff.md, past de 60s race-guard
toe en roept dan de rol-specifieke act()-stap aan. Zie AGENTS.md voor het protocol.

Gebruik:
    python scripts/watch_handoff.py --role codex
    python scripts/watch_handoff.py --role gemini  --interval 45
"""

import argparse
import subprocess
import sys
import time
from pathlib import Path

# Welke READY_FOR_* state hoort bij welke rol, en de IN_PROGRESS-state die hij claimt.
ROLE_STATE = {
    "codex":   ("READY_FOR_DEV",        "DEV_IN_PROGRESS"),
    "gemini":  ("READY_FOR_TEST",       "TEST_IN_PROGRESS"),
    "claude":  ("READY_FOR_VALIDATION", "VALIDATION_IN_PROGRESS"),
    "mistral": ("READY_FOR_INTEGRATION","INTEGRATION_IN_PROGRESS"),
}

REPO = Path(__file__).resolve().parents[1]
HANDOFF = REPO / "handoff.md"
RACE_GUARD_SECONDS = 60


def git(*args):
    return subprocess.run(["git", "-C", str(REPO), *args],
                          capture_output=True, text=True)


def read_frontmatter():
    """Leest de YAML-achtige frontmatter (key: value) uit handoff.md."""
    text = HANDOFF.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return {}
    block = text.split("---", 2)[1]
    fm = {}
    for line in block.splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            fm[k.strip()] = v.strip().strip('"').strip("'")
    return fm


def my_turn(fm, role):
    ready, _ = ROLE_STATE[role]
    return fm.get("state") == ready and fm.get("owner") == role


def act(role, fm):
    """
    ROL-SPECIFIEK. Vul hier de eigen runner in (bouwen/testen/valideren/integreren).
    Deze referentie print alleen wat er zou gebeuren. De agent vervangt dit door
    zijn eigen aanroep, en zet daarna handoff.md op de volgende READY_FOR_<next>
    + schrijft een regel in progress.md (zie AGENTS.md stap 5-6).
    """
    print(f"[{role}] AAN ZET — state={fm.get('state')} note={fm.get('note')!r}")
    print(f"[{role}] >>> voer hier de rol-taak uit, werk handoff.md + progress.md bij, commit + push.")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--role", required=True, choices=list(ROLE_STATE))
    p.add_argument("--interval", type=int, default=45, help="poll-interval in seconden")
    args = p.parse_args()
    role = args.role

    print(f"watcher gestart — rol={role}, repo={REPO}")
    while True:
        git("pull", "--quiet", "--ff-only")
        fm = read_frontmatter()

        # Escalatie of einde sprint: niets doen, alleen pollen.
        if fm.get("state") == "BLOCKED":
            print(f"[{role}] BLOCKED — wacht op Bas. note={fm.get('note')!r}")
        elif my_turn(fm, role):
            print(f"[{role}] mijn beurt gedetecteerd — race-guard {RACE_GUARD_SECONDS}s...")
            time.sleep(RACE_GUARD_SECONDS)
            git("pull", "--quiet", "--ff-only")
            fm = read_frontmatter()
            if my_turn(fm, role):  # nog steeds mijn beurt na de guard?
                act(role, fm)
            else:
                print(f"[{role}] beurt gewijzigd tijdens guard — afgebroken.")
        time.sleep(args.interval)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
