#!/usr/bin/env python3
"""
Enrich `territory_intelligence.json` with population data from a census shapefile.

Usage:
  python3 scripts/enrich_with_population.py --shapefile path/to/census.shp

Outputs: `territory_intelligence.enriched.json`

Notes:
- Requires geopandas and shapely. On macOS use conda or ensure GEOS/PROJ dependencies installed.
"""
import argparse
import json
import os
from pathlib import Path

try:
    import geopandas as gpd
    from shapely.geometry import box, shape
except Exception as e:
    raise SystemExit("geopandas required: pip install geopandas shapely\nSee README for installation notes")


def load_territories(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_territories(data, path):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def cell_to_polygon(cell):
    return box(cell['bounds']['lon0'], cell['bounds']['lat0'], cell['bounds']['lon1'], cell['bounds']['lat1'])


def enrich_with_population(territories, census_gdf):
    # Ensure same CRS: assume census_gdf in EPSG:4326
    if census_gdf.crs is None:
        census_gdf = census_gdf.set_crs(epsg=4326)
    else:
        census_gdf = census_gdf.to_crs(epsg=4326)

    enriched = []
    for t in territories:
        poly = cell_to_polygon(t)
        # build GeoSeries to clip
        # find census polygons that intersect
        matches = census_gdf[census_gdf.intersects(poly)]
        population = 0
        pop_density = 0
        if len(matches) > 0:
            # compute intersection area weights
            total_area = 0.0
            weighted_pop = 0.0
            for _, row in matches.iterrows():
                geom = row.geometry
                inter = geom.intersection(poly)
                if inter.is_empty:
                    continue
                # rely on area in degrees as approximation; better to project to equal-area CRS if needed
                area = inter.area
                total_area += area
                # common population field names: 'population', 'pop', 'POP', 'TOTAL'
                pop_fields = ['population', 'pop', 'POP', 'TOTAL', 'TOTAL_POP']
                pop_val = None
                for f in pop_fields:
                    if f in row and row[f] is not None:
                        pop_val = row[f]
                        break
                if pop_val is None:
                    # skip if no population field
                    continue
                weighted_pop += (area * float(pop_val))
            if total_area > 0:
                # approximate population in cell
                population = int(round(weighted_pop / total_area))
                # approximate density per sq-degree (rough)
                pop_density = population / (poly.area if poly.area > 0 else 1)
        t['population'] = population
        t['population_density'] = round(pop_density, 2)
        # recompute demand score: incorporate population with weight 0.01 per person
        base_score = t.get('demand_score', 0)
        score = base_score + population * 0.02  # 0.02 per person is tunable
        t['demand_score_enriched'] = round(score, 2)
        enriched.append(t)
    # sort by enriched score
    enriched = sorted(enriched, key=lambda x: x['demand_score_enriched'], reverse=True)
    return enriched


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--shapefile', '-s', required=True, help='Path to census shapefile (shp)')
    parser.add_argument('--input', '-i', default='scripts/territory_intelligence.json', help='Input territories JSON')
    parser.add_argument('--output', '-o', default='scripts/territory_intelligence.enriched.json', help='Output enriched JSON')
    args = parser.parse_args()

    shp = Path(args.shapefile)
    if not shp.exists():
        raise SystemExit(f"Shapefile not found: {shp}")

    print(f"Loading territories from {args.input}")
    territories = load_territories(args.input)
    print(f"Loading census shapefile {shp} (may take a moment)")
    census_gdf = gpd.read_file(str(shp))
    print(f"Census polygons: {len(census_gdf)}")

    enriched = enrich_with_population(territories, census_gdf)
    save_territories(enriched, args.output)
    print(f"Wrote enriched territories to {args.output}")
