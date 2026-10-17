#!/usr/bin/env python3
"""Apply ONE migration file to the live project and record it in the
migration history, using the Supabase CLI login (~/.supabase/access-token).

Never use `supabase db push` on this project: the live database and the
migration files do not line up 1:1. Apply new files one at a time, in order.

    python3 scripts/apply_migration.py supabase/migrations/<file>.sql
"""
import json, os, sys, urllib.request, urllib.error

PROJECT_REF = "ffbbuafgeypvkpcuvdnv"

path = sys.argv[1]
name = os.path.basename(path)[15:-4]          # strip "YYYYMMDDHHMMSS_" and ".sql"
sql = open(path).read()
token = open(os.path.expanduser("~/.supabase/access-token")).read().strip()
req = urllib.request.Request(
    f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/migrations",
    data=json.dumps({"query": sql, "name": name}).encode(),
    headers={"Authorization": "Bearer " + token, "Content-Type": "application/json", "User-Agent": "supabase-cli"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=180) as r:
        print(f"applied {name} ({r.status})")
except urllib.error.HTTPError as e:
    print(f"FAILED {name}: HTTP {e.code} {e.read().decode()[:2000]}")
    sys.exit(1)
