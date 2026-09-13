#!/usr/bin/env python3
"""
Fetch POIs from Overpass API for Trinidad & Tobago and save to merchants.json
Usage: python3 scripts/overpass_fetch.py
"""
import requests
import json
from time import sleep

# Bounding box for Trinidad and Tobago (south, west, north, east)
BBOX = (9.5, -61.95, 11.5, -60.2)  # generous bbox covering islands

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Tags to fetch - merchants and small businesses useful for commander decisions
TAGS = [
    'amenity=restaurant',
    'amenity=fast_food',
    'amenity=cafe',
    'amenity=bar',
    'amenity=pub',
    'shop=supermarket',
    'shop=convenience',
    'shop=confectionery',
    'shop=bakery',
    'shop=clothes',
    'shop=mall',
    'shop=hairdresser',
    'shop=beauty',
    'shop=chemist',
    'shop=pharmacy',
]

QUERY_TEMPLATE = """
[out:json][timeout:180];
(
  {filters}
);
out center;
"""


def build_filters(bbox):
    s, w, n, e = bbox
    filters = []
    for tag in TAGS:
        k, v = tag.split('=', 1)
        filters.append(f'node["{k}"="{v}"]({s},{w},{n},{e});')
        filters.append(f'way["{k}"="{v}"]({s},{w},{n},{e});')
        filters.append(f'relation["{k}"="{v}"]({s},{w},{n},{e});')
    return "\n  ".join(filters)


def fetch_overpass(bbox, out_file='merchants.json'):
    filters = build_filters(bbox)
    query = QUERY_TEMPLATE.format(filters=filters)
    print("Submitting Overpass query (this may take a minute)...")
    res = requests.post(OVERPASS_URL, data={'data': query})
    res.raise_for_status()
    data = res.json()
    elements = data.get('elements', [])
    print(f"Fetched {len(elements)} elements from Overpass")

    # Normalize: keep id, type, lat, lon, tags
    normalized = []
    for el in elements:
        lat = el.get('lat')
        lon = el.get('lon')
        # ways/relations have center
        if lat is None or lon is None:
            center = el.get('center')
            if center:
                lat = center.get('lat')
                lon = center.get('lon')
        if lat is None or lon is None:
            continue
        normalized.append({
            'id': el.get('id'),
            'type': el.get('type'),
            'lat': lat,
            'lon': lon,
            'tags': el.get('tags', {})
        })

    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(normalized, f, ensure_ascii=False, indent=2)
    print(f"Saved {len(normalized)} POIs to {out_file}")


if __name__ == '__main__':
    fetch_overpass(BBOX)
