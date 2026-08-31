Data pipeline scripts for bootstrapping territory intelligence using public POI data.

Overview
--------
This minimal pipeline fetches merchant POIs for Trinidad & Tobago from the Overpass (OpenStreetMap) API, builds a simple lat/lng grid, assigns merchants to cells, and outputs a `territory_intelligence.json` file with per-cell merchant counts and a simple demand score.

Files
-----
- `scripts/overpass_fetch.py` - Fetches POIs from Overpass and writes `merchants.json`.
- `scripts/generate_grid.py` - Builds a grid, assigns merchants to cells, outputs `territory_intelligence.json`.
- `scripts/requirements.txt` - Minimal pip requirements.
 - `scripts/enrich_with_population.py` - Enrich `territory_intelligence.json` using a census shapefile (requires geopandas).
 - `scripts/upload_to_supabase.py` - Upload enriched territories to Supabase using service-role key.

Requirements
------------
Python 3.9+

Install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r scripts/requirements.txt
```

Run
---
1. Fetch merchants (this may take 1-2 minutes):

```bash
python3 scripts/overpass_fetch.py
```

2. Generate territory grid and demand scores:

```bash
python3 scripts/generate_grid.py
```

Outputs
-------
- `scripts/merchants.json` - Raw POIs fetched from Overpass.
- `scripts/territory_intelligence.json` - Grid cells sorted by `demand_score` with counts and sample merchants.

Next steps / enrichment
-----------------------
- Add population data (CSO census shapefiles) to compute population_density per cell.
- Add Ministry of Works traffic incident data and infrastructure projects to adjust demand_score.
- Upload `territory_intelligence.json` to Supabase `territory_intelligence` table or call the provided RPC to ingest.

Notes
-----
- The scripts use a simple grid approach to avoid heavy GIS dependencies. For higher accuracy, enrich with `geopandas` and official shapefiles.
- Overpass queries are rate-limited; if the Overpass API returns errors, wait a minute and retry.

If you want, I can:
- Add a `scripts/upload_to_supabase.py` helper to push the JSON into your Supabase database (requires Supabase keys in `.env`).
- Add population enrichment using CSO shapefiles (requires downloading census shapefile).
