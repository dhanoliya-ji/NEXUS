# ============================================================
#  backup.py — copies ALL your NEXUS data to the D drive
# ============================================================
#  Downloads every chat, message and your "About me" profile from
#  your NEXUS website and saves it as D:\NEXUS\backup\nexus-DATE.json
#  Keeps the newest 30 backups and deletes older ones.
#
#  Run by hand:      python local\backup.py
#  Runs every day:   after you run local\install-backup.ps1 once
#
#  It reads NEXUS_URL and NEXUS_PASSWORD from the .dev.vars file.

import json
import os
import urllib.request
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # D:\NEXUS
BACKUP_DIR = os.path.join(ROOT, "backup")
KEEP = 30


def read_settings():
    """Read KEY=value lines from .dev.vars into a dictionary."""
    settings = {}
    with open(os.path.join(ROOT, ".dev.vars"), encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                key, value = line.split("=", 1)
                settings[key.strip()] = value.strip()
    return settings


def main():
    settings = read_settings()
    url = settings.get("NEXUS_URL", "").rstrip("/")
    if not url:
        print("Add NEXUS_URL=https://your-site.pages.dev to .dev.vars first")
        return

    # Download everything
    request = urllib.request.Request(url + "/api/export")
    request.add_header("x-nexus-key", settings.get("NEXUS_PASSWORD", ""))
    request.add_header("User-Agent", "NEXUS-backup")   # Cloudflare blocks Python's default name
    with urllib.request.urlopen(request, timeout=60) as response:
        data = json.load(response)

    # Save it as today's file
    os.makedirs(BACKUP_DIR, exist_ok=True)
    file_path = os.path.join(BACKUP_DIR, "nexus-" + date.today().isoformat() + ".json")
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print("Saved", len(data["messages"]), "messages to", file_path)

    # Delete old backups, keep the newest 30
    files = sorted(name for name in os.listdir(BACKUP_DIR) if name.startswith("nexus-"))
    for old in files[:-KEEP]:
        os.remove(os.path.join(BACKUP_DIR, old))


if __name__ == "__main__":
    main()
