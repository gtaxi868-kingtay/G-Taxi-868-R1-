#!/usr/bin/env python3
"""Turn an OpenStreetMap export of Trinidad and Tobago into supabase/data/tt_places.csv.

Input is the JSON from the Overpass query in the docstring of this repo's
migration 20261101130000_tt_places.sql. Roads are one row per name per ~3 km,
so a long road like the Eastern Main Road can be found town by town.
Data (c) OpenStreetMap contributors, ODbL.
"""
import collections, csv, json, math, sys

# Local names. Each one, typed exactly, jumps straight to this place.
ALIASES = {
    'University of the West Indies, St. Augustine Campus': 'uwi;uwi st augustine;st augustine campus',
    'Ariapita Avenue': 'the avenue;ari ave;de avenue',
    'Queen\'s Park Savannah': 'the savannah;savannah',
    'Piarco International Airport': 'piarco;the airport;airport;piarco airport',
    'MovieTowne': 'movie towne;movietown',
    'Port of Spain': 'pos;town;port spain',
    'San Fernando': 'sando;san f',
    'Eric Williams Medical Sciences Complex': 'mt hope hospital;mount hope hospital;eric williams',
    'Chaguaramas': 'chag',
    'Gulf City Mall': 'gulf city',
    'Hyatt Regency Trinidad': 'hyatt;the hyatt',
    'Hilton Trinidad & Conference Centre': 'hilton;the hilton',
    'Churchill-Roosevelt Highway': 'churchill roosevelt;crh;the highway',
    'Sir Solomon Hochoy Highway': 'solomon hochoy;hochoy highway',
    'Uriah Butler Highway': 'ubh;butler highway',
    'Trincity Mall': 'trincity',
}
SKIP_CATEGORIES = {'parking', 'parking_entrance', 'parking_space', 'pitch', 'bench', 'waste_basket', 'waste_disposal', 'toilets', 'bicycle_parking', 'construction', 'yes'}
KEEP_ROADS = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
              'service', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'track', 'road'}


def km(a, b, c, d):
    return math.hypot((a - c) * 110.57, (b - d) * 110.57 * math.cos(math.radians(a)))


def point(e):
    if 'center' in e:
        return e['center']['lat'], e['center']['lon']
    return e.get('lat'), e.get('lon')


def category(t):
    for k in ('amenity', 'shop', 'tourism', 'leisure', 'office', 'healthcare', 'aeroway', 'building'):
        if k in t:
            return t[k] if t[k] != 'yes' else k
    return 'place'


def main(src, dst):
    els = [e for e in json.load(open(src))['elements'] if e.get('tags', {}).get('name')]
    towns = [(e['tags']['name'], *point(e)) for e in els if e['tags'].get('place') in
             ('city', 'town', 'village', 'suburb', 'hamlet', 'neighbourhood', 'locality')]

    def area(la, ln, skip=''):
        best, dist = '', 1e9
        for name, a, b in towns:
            d = km(la, ln, a, b)
            if d < dist and name != skip:
                best, dist = name, d
        return best if dist < 8 else ''

    rows, seen = [], set()
    for e in els:
        t = e['tags']
        la, ln = point(e)
        if la is None:
            continue
        name = ' '.join(t['name'].split())
        if 'highway' in t:
            if t['highway'] not in KEEP_ROADS:
                continue
            key = ('road', name.lower(), round(la / 0.027), round(ln / 0.027))
            kind, cat = 'road', 'road'
        elif 'place' in t:
            key = ('place', name.lower(), round(la, 2), round(ln, 2))
            kind, cat = 'place', t['place']
        else:
            key = ('poi', name.lower(), round(la, 3), round(ln, 3))
            kind, cat = 'poi', category(t)
            if cat in SKIP_CATEGORIES:
                continue
        if key in seen:
            continue
        seen.add(key)
        extra = [t[k] for k in ('alt_name', 'old_name', 'short_name', 'official_name') if t.get(k)]
        alias = ';'.join(filter(None, [ALIASES.get(name, '')] + extra))
        rows.append((name, kind, cat, area(la, ln, name), alias, round(la, 6), round(ln, 6)))

    rows.sort(key=lambda r: (r[1], r[0].lower()))
    with open(dst, 'w', newline='', encoding='utf8') as f:
        w = csv.writer(f)
        w.writerow(['name', 'kind', 'category', 'area', 'aliases', 'lat', 'lng'])
        w.writerows(rows)
    print(len(rows), collections.Counter(r[1] for r in rows))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
