#!/usr/bin/env python3
"""
Generate a simple lat/lng grid over Trinidad & Tobago and compute merchant counts.
Reads `merchants.json` from `scripts/overpass_fetch.py` and outputs
`territory_intelligence.json` with grid cells, counts, and simple demand score.

Usage: python3 scripts/generate_grid.py
"""
import json
import math
from itertools import product

# bbox should match the fetch script
BBOX = (9.5, -61.95, 11.5, -60.2)  # south, west, north, east
GRID_SIZE_DEGREES = 0.03  # ~3km cells (approx, varies with latitude)

MERCHANTS_FILE = 'merchants.json'
OUT_FILE = 'territory_intelligence.json'


def load_merchants(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def make_grid(bbox, step):
    s, w, n, e = bbox
    lat_steps = int(math.ceil((n - s) / step))
    lon_steps = int(math.ceil((e - w) / step))
    cells = []
    for i in range(lat_steps):
        for j in range(lon_steps):
            lat0 = s + i * step
            lat1 = min(s + (i + 1) * step, n)
            lon0 = w + j * step
            lon1 = min(w + (j + 1) * step, e)
            center = ((lat0 + lat1) / 2.0, (lon0 + lon1) / 2.0)
            cells.append({
                'lat0': lat0,
                'lat1': lat1,
                'lon0': lon0,
                'lon1': lon1,
                'center': {'lat': center[0], 'lon': center[1]},
                'merchants': [],
            })
    return cells


def point_in_cell(lat, lon, cell):
    return (cell['lat0'] <= lat <= cell['lat1']) and (cell['lon0'] <= lon <= cell['lon1'])


def assign_merchants_to_cells(merchants, cells):
    for m in merchants:
        lat = m.get('lat')
        lon = m.get('lon')
        # naive linear scan; for T&T this is fine (small dataset)
        assigned = False
        for cell in cells:
            if point_in_cell(lat, lon, cell):
                cell['merchants'].append(m)
                assigned = True
                break
        if not assigned:
            # merchant outside bbox or lon/lat missing
            continue


def compute_demand_score(cell):
    # Simple heuristic: restaurants + salons are high value
    merchants = cell['merchants']
    count = len(merchants)
    restaurants = sum(1 for m in merchants if 'amenity' in m.get('tags', {}) and m['tags'].get('amenity') in ('restaurant','fast_food','cafe'))
    salons = sum(1 for m in merchants if m.get('tags', {}).get('shop') in ('hairdresser','beauty','barber'))
    # population is unknown here; set to 0. Enrich later with census data.
    population_score = 0
    score = count * 5 + restaurants * 10 + salons * 8 + population_score
    return {
        'merchant_count': count,
        'restaurants': restaurants,
        'salons': salons,
        'demand_score': round(score, 2)
    }


def build_territory_intelligence(cells):
    territories = []
    for cell in cells:
        stats = compute_demand_score(cell)
        territories.append({
            'center': cell['center'],
            'bounds': {
                'lat0': cell['lat0'], 'lat1': cell['lat1'],
                'lon0': cell['lon0'], 'lon1': cell['lon1']
            },
            'merchant_count': stats['merchant_count'],
            'restaurants': stats['restaurants'],
            'salons': stats['salons'],
            'demand_score': stats['demand_score'],
            'sample_merchants': [
                {'id': m['id'], 'lat': m['lat'], 'lon': m['lon'], 'tags': m.get('tags')} 
                for m in (cell['merchants'][:5])
            ]
        })
    # sort by demand_score desc
    territories = sorted(territories, key=lambda t: t['demand_score'], reverse=True)
    return territories


if __name__ == '__main__':
    merchants = load_merchants(MERCHANTS_FILE)
    print(f"Loaded {len(merchants)} merchants")
    cells = make_grid(BBOX, GRID_SIZE_DEGREES)
    print(f"Created {len(cells)} grid cells")
    assign_merchants_to_cells(merchants, cells)
    territories = build_territory_intelligence(cells)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(territories, f, ensure_ascii=False, indent=2)
    print(f"Wrote {len(territories)} territory cells to {OUT_FILE}")
    print("Top 5 territories by demand_score:")
    for t in territories[:5]:
        print(t['center'], 'score=', t['demand_score'], 'merchants=', t['merchant_count'])
