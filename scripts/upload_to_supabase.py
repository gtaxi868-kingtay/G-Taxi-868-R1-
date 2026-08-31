#!/usr/bin/env python3
"""
Upload `territory_intelligence.json` to Supabase via REST API using service role key.
Usage:
  python3 scripts/upload_to_supabase.py --input scripts/territory_intelligence.enriched.json

Notes:
- Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment or in .env.secrets at repo root.
- Table name expected: `territory_intelligence`. Adjust if different.
"""
import argparse
import json
import os
from pathlib import Path
import requests


def read_dotenv(path):
    env = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if '=' not in line:
            continue
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip()
    return env


def get_supabase_config():
    # check environment
    url = os.getenv('SUPABASE_URL')
    key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
    if url and key:
        return url.rstrip('/'), key
    # fallback to .env.secrets
    dotenv = Path('.env.secrets')
    if dotenv.exists():
        env = read_dotenv(dotenv)
        url = env.get('SUPABASE_URL') or env.get('SUPABASE_URL')
        key = env.get('SUPABASE_SERVICE_ROLE_KEY') or env.get('SUPABASE_SERVICE_ROLE_KEY')
        if url and key:
            return url.rstrip('/'), key
    raise SystemExit('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment or .env.secrets')


def upload_array(supabase_url, service_role_key, table_name, data_array):
    endpoint = f"{supabase_url}/rest/v1/{table_name}"
    headers = {
        'Content-Type': 'application/json',
        'apikey': service_role_key,
        'Authorization': f'Bearer {service_role_key}',
        'Prefer': 'return=representation'
    }
    print(f"Uploading {len(data_array)} rows to {endpoint}")
    res = requests.post(endpoint, headers=headers, json=data_array)
    if not res.ok:
        raise SystemExit(f"Upload failed: {res.status_code} {res.text}")
    print(f"Upload successful: {res.status_code}")
    return res.json()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', '-i', default='scripts/territory_intelligence.enriched.json', help='Input JSON file')
    parser.add_argument('--table', '-t', default='territory_intelligence', help='Supabase table name')
    args = parser.parse_args()

    path = Path(args.input)
    if not path.exists():
        raise SystemExit(f"Input file not found: {path}")

    supabase_url, service_role_key = get_supabase_config()

    data = json.loads(path.read_text(encoding='utf-8'))
    # transform to minimal payload expected by Supabase table
    rows = []
    for t in data:
        row = {
            'center': f"SRID=4326;POINT({t['center']['lon']} {t['center']['lat']})",
            'bounds': t['bounds'],
            'merchant_count': t.get('merchant_count'),
            'restaurants': t.get('restaurants'),
            'salons': t.get('salons'),
            'demand_score': t.get('demand_score_enriched') or t.get('demand_score'),
            'population': t.get('population'),
            'population_density': t.get('population_density'),
            'sample_merchants': t.get('sample_merchants')
        }
        rows.append(row)

    upload_array(supabase_url, service_role_key, args.table, rows)
