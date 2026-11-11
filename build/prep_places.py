#!/usr/bin/env python3
"""Turn Natural Earth 1:10m GeoJSON files into build/places_source.json.

Run once when the gazetteer should change. Natural Earth is public domain; files from
https://github.com/nvkelso/natural-earth-vector (v5.1.2, geojson/):
ne_10m_admin_0_countries, ne_10m_admin_1_states_provinces, ne_10m_geography_marine_polys,
ne_10m_geography_regions_polys, ne_10m_geography_regions_points.

    python build/prep_places.py <folder with those .geojson files>

Each place is [english, japanese, kind, country, west, south, east, north]. West is
greater than east when the place crosses the 180° meridian.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
KEEP_REGIONS = {'island': 'island', 'island group': 'islands', 'pen/cape': 'cape', 'peninsula': 'cape',
                'coast': 'coast', 'delta': 'coast', 'geoarea': 'region', 'cape': 'cape'}
MARINE = {'sea': 'sea', 'ocean': 'sea', 'gulf': 'gulf', 'bay': 'gulf', 'strait': 'strait', 'sound': 'strait',
          'channel': 'strait', 'fjord': 'gulf', 'lagoon': 'gulf', 'inlet': 'gulf', 'reef': 'reef', 'generic': 'sea'}


def points(geom):
    def walk(c):
        if isinstance(c[0], (int, float)):
            yield c
        else:
            for x in c:
                yield from walk(x)
    yield from walk(geom['coordinates'])


def bbox(geom):
    pts = list(points(geom))
    lats = [p[1] for p in pts]
    lons = sorted(p[0] for p in pts)
    w, e = lons[0], lons[-1]
    # Use the smallest arc: find the largest gap between longitudes and wrap there.
    gaps = [(lons[i + 1] - lons[i], i) for i in range(len(lons) - 1)]
    gap, i = max(gaps, default=(0, 0))
    if gap > 360 - (e - w):
        w, e = lons[i + 1], lons[i]
    pad = 0.5 if geom['type'] == 'Point' else 0
    return [round(w - pad, 2), round(min(lats) - pad, 2), round(e + pad, 2), round(max(lats) + pad, 2)]


def prop(p, *names):
    for n in names:
        if p.get(n) not in (None, '', -99, '-99'):
            return p[n]
    return ''


def main(src):
    src = Path(src)
    out = []
    load = lambda name: json.loads((src / f'{name}.geojson').read_text(encoding='utf-8'))['features']
    for f in load('ne_10m_admin_0_countries'):
        p = f['properties']
        out.append([prop(p, 'NAME_EN', 'NAME'), prop(p, 'NAME_JA'), 'country', '', *bbox(f['geometry'])])
    for f in load('ne_10m_admin_1_states_provinces'):
        p = f['properties']
        if not p.get('name'):
            continue
        out.append([prop(p, 'name_en', 'name'), prop(p, 'name_ja'), 'province', prop(p, 'admin'), *bbox(f['geometry'])])
    for f in load('ne_10m_geography_marine_polys'):
        p = f['properties']
        kind = MARINE.get(str(p.get('featurecla', '')).lower())
        if kind and p.get('name'):
            out.append([prop(p, 'name_en', 'name').title() if p['name'].isupper() else prop(p, 'name_en', 'name'),
                        prop(p, 'name_ja'), kind, '', *bbox(f['geometry'])])
    for name in ('ne_10m_geography_regions_polys', 'ne_10m_geography_regions_points'):
        for f in load(name):
            p = {k.lower(): v for k, v in f['properties'].items()}
            kind = KEEP_REGIONS.get(str(p.get('featurecla', '')).lower())
            if kind and p.get('name'):
                out.append([prop(p, 'name_en', 'name'), prop(p, 'name_ja'), kind, '', *bbox(f['geometry'])])
    seen, unique = set(), []
    for row in out:
        key = (row[0], row[2], row[3])
        if key not in seen:
            seen.add(key)
            unique.append(row)
    (HERE / 'places_source.json').write_text(json.dumps(unique, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(len(unique), 'places')


if __name__ == '__main__':
    main(sys.argv[1])
