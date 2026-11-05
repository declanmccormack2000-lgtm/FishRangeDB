#!/usr/bin/env python3
"""Generate the static FishRangeDB website from the local SQLite database.

Writes HTML pages, per-species JSON and zipped downloads into public/. Cloudflare
serves public/ as static assets (see wrangler.jsonc), so pushing the result to main
publishes it. Hand-written CSS and JavaScript live in public/assets/ and are not touched.

    python build/build_site.py --home D:\\FishRangeDB
"""
import argparse
import csv
import json
import math
import os
import re
import shutil
import sqlite3
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PUBLIC = ROOT / 'public'
TEMPLATES = HERE / 'templates'

LENGTH_LABELS = {'TL': 'Total', 'FL': 'Fork', 'SL': 'Standard', 'PCL': 'Precaudal', 'unspecified': 'Not stated'}
RESULT_LABELS = {'decreasing': 'Decreasing', 'increasing': 'Increasing', 'no clear change': 'No clear change'}
HOME_TRENDS = [('Pleuronectes platessa', 'TL'), ('Melanogrammus aeglefinus', 'FL'),
               ('Melanogrammus aeglefinus', 'TL'), ('Clupea harengus', 'TL'), ('Gadus morhua', 'TL'),
               ('Haemulon plumierii', 'unspecified'), ('Stegastes partitus', 'unspecified')]
DOWNLOADS = [('species_spatial_cells.csv', 'Species records by year and 1° cell'),
             ('effort_cells.csv', 'All fish records by year and 1° cell'),
             ('species_catch_by_area.csv', 'Tonnes by species, year and FAO area'),
             ('catch_groups.csv', 'Catch reported for mixed groups, not species'),
             ('species_length_by_year.csv', 'Mean length by species, type and year'),
             ('species_size_trends.csv', 'Change per decade by species and type'),
             ('species_year_source.csv', 'Record counts by species, year and source'),
             ('dataset_series.csv', 'Survey datasets and the series they belong to')]
ATTRIBUTION = """FishRangeDB data file. McCormack Marine Institute.

Derived from:
- Ocean Biodiversity Information System (OBIS), bulk snapshot, CC BY-NC 4.0 (non-commercial use).
- FAO FishStat, Global capture production, release 2026.1.0, CC BY 4.0.
- ICES Database of Trawl Surveys (DATRAS), CC BY 4.0.
- NSF NEON fish taxon list.

Attribute each source and follow its licence. Records show where and when fish were
sampled. They are not estimates of abundance or native range.
"""


def slug(name):
    return name.lower().replace(' ', '_')


def fmt(n):
    return f'{round(n):,}'


def round_num(x, digits=1):
    r = round(x, digits)
    return int(r) if r == int(r) else r


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))


def weighted_percentile(pairs, q):
    """pairs: sorted (value, weight)."""
    target = sum(w for _, w in pairs) * q
    run = 0
    for v, w in pairs:
        run += w
        if run >= target:
            return v
    return pairs[-1][0]


def dataset_title(source, dataset_id, title, series_id):
    if series_id and series_id.startswith('series:'):
        return series_id[len('series:'):].title()
    if source == 'ICES':
        _, survey, quarter, gear = dataset_id.split(':')
        return f'{survey}, quarter {quarter[1:]}, gear {gear}'
    title = (title or dataset_id).strip()
    if '\ufffd' in title and ' | ' in title:     # the bad half of bilingual titles
        title = title.split(' | ')[0]
    return title.replace('\ufffd', '?')


def load_trends(home, c):
    sys.path.insert(0, str(home))
    import fishdb
    rows = []
    for r in fishdb.size_trends(c):
        d = dict(zip(fishdb.TREND_FIELDS, r))
        if d['trend'] in RESULT_LABELS:
            rows.append(d)
    return rows


def build_species(c, trends, countries):
    species = c.execute('SELECT species_id,canonical_name,fish_class,family FROM species').fetchall()
    ids = defaultdict(dict)
    for sid, source, tid in c.execute('SELECT species_id,source,source_taxon_id FROM source_taxa'):
        ids[sid].setdefault(source, tid)

    effort = defaultdict(int)
    for year, la, lo, n in c.execute('SELECT year,lat_bin,lon_bin,n FROM effort_cells WHERE cell_degrees=1'):
        effort[(year // 10 * 10, la, lo)] += n

    cells = defaultdict(lambda: defaultdict(int))
    for sid, year, la, lo, n in c.execute('SELECT species_id,year,lat_bin,lon_bin,n FROM spatial_cells WHERE cell_degrees=1'):
        cells[sid][(year // 10 * 10, la, lo)] += n

    span = defaultdict(lambda: [0, None, None])
    for sid, year, occ in c.execute('SELECT species_id,year,SUM(occurrence_n) FROM coverage GROUP BY 1,2'):
        if occ:
            s = span[sid]
            s[0] += occ
            s[1] = year if s[1] is None else min(s[1], year)
            s[2] = year if s[2] is None else max(s[2], year)

    catch_year = defaultdict(lambda: defaultdict(float))
    catch_area = defaultdict(lambda: defaultdict(float))
    catch_country = defaultdict(lambda: defaultdict(float))
    for sid, year, area, country, t in c.execute(
            'SELECT species_id,year,area,country,catch_tonnes FROM catches WHERE species_id IS NOT NULL'):
        catch_year[sid][year] += t
        catch_area[sid][area or 'Not stated'] += t
        catch_country[sid][countries.get(country, country or 'Not stated')] += t

    lengths = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0.0, 0.0])))
    meta = {}
    for sid, year, source, lt, did, n, s, title, series in c.execute(
            '''SELECT l.species_id,l.year,l.source,l.length_type,l.dataset_id,l.n_measured,l.sum_cm,d.title,d.series_id
               FROM length_stats l LEFT JOIN dataset_series d ON d.source=l.source AND d.dataset_id=l.dataset_id'''):
        if not n:
            continue
        key = (source, series or did, lt)
        meta[key] = dataset_title(source, did, title, series)
        rec = lengths[sid][key][year]
        rec[0] += n
        rec[1] += s

    trends_by_name = defaultdict(list)
    for t in trends:
        trends_by_name[t['canonical_name']].append(t)

    index = []
    classes = sorted({r[2] for r in species if r[2]})
    out = PUBLIC / 'data' / 'species'
    for sid, name, fish_class, family in species:
        rec = {'name': name, 'class': fish_class or '', 'family': family or ''}
        src = ids[sid]
        rec['aphia'] = src.get('OBIS') or src.get('ICES') or ''
        rec['fao'] = src.get('FAO', '')
        rec['neon'] = 'NEON' in src

        occ, y0, y1 = span[sid] if sid in span else (0, None, None)
        rec['occ'] = [occ, y0, y1]
        decades = defaultdict(list)
        for (d, la, lo), n in cells[sid].items() if sid in cells else ():
            decades[d].append((la, lo, n))
        rec['dec'] = []
        for d in sorted(decades):
            rows = sorted(decades[d])
            total = sum(n for _, _, n in rows)
            lat = sorted((la - 89.5, n) for la, _, n in rows)
            shares = [(la - 89.5, n / effort[(d, la, lo)]) for la, lo, n in rows if effort[(d, la, lo)]]
            weight = sum(s for _, s in shares)
            rec['dec'].append({
                'd': d, 'n': total, 'c': len(rows),
                'lat': round(sum(v * n for v, n in lat) / total, 1),
                'lo': weighted_percentile(lat, .05), 'hi': weighted_percentile(lat, .95),
                'adj': round(sum(v * s for v, s in shares) / weight, 1) if weight else None,
                'cells': [x for r in rows for x in r]})

        years = catch_year[sid] if sid in catch_year else None
        if years:
            rec['catch'] = {
                't': round_num(sum(years.values())),
                'years': [[y, round_num(years[y])] for y in sorted(years)],
                'areas': sorted(([a, round_num(t)] for a, t in catch_area[sid].items()), key=lambda r: -r[1]),
                'countries': sorted(([a, round_num(t)] for a, t in catch_country[sid].items()), key=lambda r: -r[1])}

        rec['len'] = []
        if sid in lengths:
            for key, by_year in lengths[sid].items():
                total = sum(v[0] for v in by_year.values())
                rec['len'].append({
                    'src': key[0], 'title': meta[key], 'type': key[2], 'n': round_num(total, 0),
                    'rows': [[y, round_num(by_year[y][0], 0), round(by_year[y][1] / by_year[y][0], 2)]
                             for y in sorted(by_year)]})
            rec['len'].sort(key=lambda x: (-len(x['rows']), -x['n'], x['title']))
        rec['trends'] = [[t['length_type'], t['first_year'], t['last_year'], t['datasets_with_repeat_years'],
                          round_num(t['measured_individuals'], 0), t['mean_length_cm'], t['slope_cm_per_decade'],
                          t['slope_pct_per_decade'], t['t_stat'], t['trend']] for t in trends_by_name.get(name, ())]
        write_json(out / f'{slug(name)}.json', rec)

        flags = (1 if occ else 0) | (2 if years else 0) | (4 if rec['len'] else 0) | (8 if rec['trends'] else 0)
        lo_year = [y for y in (y0, min(years) if years else None,
                               *[r['rows'][0][0] for r in rec['len']]) if y is not None]
        hi_year = [y for y in (y1, max(years) if years else None,
                               *[r['rows'][-1][0] for r in rec['len']]) if y is not None]
        index.append([name, family or '', classes.index(fish_class) if fish_class else -1, flags, occ,
                      round(sum(years.values())) if years else 0,
                      min(lo_year) if lo_year else 0, max(hi_year) if hi_year else 0])
    index.sort(key=lambda r: r[0])
    write_json(PUBLIC / 'data' / 'index.json', {'classes': classes, 'rows': index})

    flat = defaultdict(list)
    for (d, la, lo), n in sorted(effort.items()):
        flat[str(d)] += [la, lo, n]
    write_json(PUBLIC / 'data' / 'effort.json', flat)
    return len(index)


def build_land():
    """Decode the Natural Earth land TopoJSON into flat lon,lat rings."""
    topo = json.loads((HERE / 'land-110m.json').read_text(encoding='utf-8'))
    (sx, sy), (tx, ty) = topo['transform']['scale'], topo['transform']['translate']
    arcs = []
    for arc in topo['arcs']:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((round(x * sx + tx, 2), round(y * sy + ty, 2)))
        arcs.append(pts)
    rings = []

    def ring(refs):
        pts = []
        for r in refs:
            a = arcs[r] if r >= 0 else arcs[~r][::-1]
            pts += a[1:] if pts else a
        # Rings run straight across the antimeridian, so unroll them to continuous
        # longitudes. A ring around the pole (Antarctica) is then closed along the map
        # edge, and any ring reaching past 180 degrees gets a copy on the other side.
        lon = [pts[0][0]]
        for (a, _), (b, _) in zip(pts, pts[1:]):
            step = b - a
            lon.append(lon[-1] + step - 360 * round(step / 360))
        out = list(zip(lon, (p[1] for p in pts)))
        if abs(lon[-1] - lon[0]) > 180:
            out += [(lon[-1], -90), (lon[0], -90)]
        low, high = min(p[0] for p in out), max(p[0] for p in out)
        for shift in (-360, 0, 360):
            if low + shift < 180 and high + shift > -180:
                rings.append([v for x, y in out for v in (round(x + shift, 2), y)])

    def geometry(g):
        if g['type'] == 'GeometryCollection':
            for x in g['geometries']:
                geometry(x)
        elif g['type'] == 'Polygon':
            for r in g['arcs']:
                ring(r)
        elif g['type'] == 'MultiPolygon':
            for poly in g['arcs']:
                for r in poly:
                    ring(r)

    for obj in topo['objects'].values():
        geometry(obj)
    write_json(PUBLIC / 'data' / 'land.json', rings)


def build_downloads(exports):
    target = PUBLIC / 'downloads'
    target.mkdir(parents=True, exist_ok=True)
    out = []
    for name, label in DOWNLOADS:
        src = exports / name
        dest = target / (name[:-4] + '.zip')
        with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            stamp = (2026, 1, 1, 0, 0, 0)     # fixed, so unchanged data gives an unchanged zip
            info = zipfile.ZipInfo(name, stamp)
            info.compress_type = zipfile.ZIP_DEFLATED
            with open(src, 'rb') as f, z.open(info, 'w') as w:
                shutil.copyfileobj(f, w)
            info = zipfile.ZipInfo('ATTRIBUTION.txt', stamp)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, ATTRIBUTION)
        assert dest.stat().st_size < 25 * 2**20, f'{dest} is over the Cloudflare 25 MiB file limit'
        out.append((dest.name, label, src.stat().st_size, dest.stat().st_size))
    return out


def rows_html(rows):
    html = []
    for i, cells in enumerate(rows):
        cls = ' class="z"' if i % 2 else ''
        html.append(f'<tr{cls}>' + ''.join(cells) + '</tr>')
    return '\n'.join(html)


def td(text, cls=None):
    return f'<td class="{cls}">{text}</td>' if cls else f'<td>{text}</td>'


def holdings(c):
    q = lambda s: c.execute(s).fetchone()
    rows, sp, y0, y1 = q("""SELECT (SELECT SUM(accepted) FROM imports WHERE source='OBIS' AND kind='occurrence'),
                            COUNT(DISTINCT species_id),MIN(year),MAX(year) FROM coverage WHERE occurrence_n>0""")
    out = [('Occurrence', 'OBIS', rows, sp, f'{y0}–{y1}')]
    rows, sp, y0, y1 = q("SELECT COUNT(*),COUNT(DISTINCT species_id),MIN(year),MAX(year) FROM catches WHERE species_id IS NOT NULL")
    out.append(('Catch', 'FAO FishStat', rows, sp, f'{y0}–{y1}'))
    for src, label in (('OBIS', 'OBIS'), ('ICES', 'ICES DATRAS')):
        rows, sp, y0, y1 = q(f"SELECT SUM(records),COUNT(DISTINCT species_id),MIN(year),MAX(year) FROM length_stats WHERE source='{src}'")
        out.append(('Body length', label, rows, sp, f'{y0}–{y1}'))
    rows, sp = q("SELECT COUNT(*),COUNT(DISTINCT species_id) FROM source_taxa WHERE source='NEON'")
    out.append(('Checklist', 'NSF NEON', rows, sp, '—'))
    return out


def pct(x):
    return ('+' if x > 0 else '−') + f'{abs(x):.1f}%'


def render(trends, c, downloads, species_count):
    by_key = {(t['canonical_name'], t['length_type']): t for t in trends}
    home_rows = []
    for key in HOME_TRENDS:
        t = by_key[key]
        link = f'<a href="species.html?name={key[0].replace(" ", "+")}"><i>{key[0]}</i></a>'
        home_rows.append([td(link), td(LENGTH_LABELS[key[1]]), td(f"{t['first_year']}–{t['last_year']}", 'n'),
                          td(pct(t['slope_pct_per_decade']), 'n'), td(RESULT_LABELS[t['trend']])])
    counts = defaultdict(int)
    for t in trends:
        counts[t['trend']] += 1
    held = holdings(c)
    groups = c.execute("SELECT SUM(rejected) FROM imports WHERE source='FAO'").fetchone()[0]
    y0 = min(int(h[4][:4]) for h in held if h[4] != '—')
    y1 = max(int(h[4][-4:]) for h in held if h[4] != '—')
    values = {
        'species': fmt(species_count), 'year_first': str(y0), 'year_last': str(y1),
        'holdings_rows': rows_html([[td(h[0]), td(h[1]), td(fmt(h[2]), 'n'), td(fmt(h[3]), 'n'), td(h[4], 'n')] for h in held]),
        'group_rows': fmt(groups or 0),
        'estimates': fmt(len(trends)), 'trend_species': fmt(len({t['canonical_name'] for t in trends})),
        'decreasing': fmt(counts['decreasing']), 'increasing': fmt(counts['increasing']),
        'no_change': fmt(counts['no clear change']),
        'home_trend_rows': rows_html(home_rows),
        'download_rows': rows_html([[td(f'<a href="downloads/{n}">{n}</a>', 'd'), td(label),
                                     td(f'{csv_size / 1e6:.1f} MB', 'n'), td(f'{zip_size / 1e6:.1f} MB', 'n')]
                                    for n, label, csv_size, zip_size in downloads]),
    }
    shared = {k: (TEMPLATES / f'_{k}.html').read_text(encoding='utf-8') for k in ('header', 'footer')}
    for page in TEMPLATES.glob('[!_]*.html'):
        text = page.read_text(encoding='utf-8')
        for k, v in shared.items():
            text = text.replace('{{' + k + '}}', v)
        for k, v in values.items():
            text = text.replace('{{' + k + '}}', v)
        left = re.findall(r'\{\{\w+\}\}', text)
        assert not left, f'{page.name}: unfilled {left}'
        (PUBLIC / page.name).write_text(text, encoding='utf-8', newline='\n')
    return values


def check(c, values):
    """Refuse to publish if the generated files disagree with the database."""
    rows = json.loads((PUBLIC / 'data' / 'index.json').read_text(encoding='utf-8'))['rows']
    db_species = c.execute('SELECT COUNT(*) FROM species').fetchone()[0]
    assert len(rows) == db_species, 'species index is incomplete'
    occ = c.execute('SELECT SUM(occurrence_n) FROM coverage').fetchone()[0]
    assert sum(r[4] for r in rows) == occ, 'occurrence totals differ'
    tonnes = c.execute('SELECT SUM(catch_tonnes) FROM catches WHERE species_id IS NOT NULL').fetchone()[0]
    assert abs(sum(r[5] for r in rows) - tonnes) < len(rows), 'catch totals differ'
    files = list((PUBLIC / 'data' / 'species').glob('*.json'))
    assert len(files) == db_species, 'species files do not match (a case clash?)'
    sample = c.execute("SELECT SUM(n) FROM spatial_cells WHERE species_id=(SELECT species_id FROM species WHERE canonical_name='Gadus morhua')").fetchone()[0]
    cod = json.loads((PUBLIC / 'data' / 'species' / 'gadus_morhua.json').read_text(encoding='utf-8'))
    assert sum(d['n'] for d in cod['dec']) == sample, 'cod cell totals differ'
    total = sum(p.stat().st_size for p in PUBLIC.rglob('*') if p.is_file())
    count = sum(1 for p in PUBLIC.rglob('*') if p.is_file())
    assert count < 20000, 'over the Cloudflare free-plan file limit'
    print(f'checked: {len(rows):,} species, {count:,} files, {total / 1e6:.1f} MB in public/')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--home', type=Path, default=ROOT.parent, help='FishRangeDB project folder')
    a = ap.parse_args()
    db = a.home / 'database' / 'fishrange.sqlite'
    c = sqlite3.connect(f'file:{db.as_posix()}?mode=ro', uri=True)
    shutil.rmtree(PUBLIC / 'data', ignore_errors=True)
    shutil.rmtree(PUBLIC / 'downloads', ignore_errors=True)
    (PUBLIC / 'data').mkdir(parents=True)

    trends = load_trends(a.home, c)
    write_json(PUBLIC / 'data' / 'trends.json', [
        [t['canonical_name'], t['length_type'], t['first_year'], t['last_year'], t['datasets_with_repeat_years'],
         round_num(t['measured_individuals'], 0), t['mean_length_cm'], t['slope_cm_per_decade'],
         t['slope_pct_per_decade'], t['t_stat'], t['trend']] for t in trends])
    countries = json.loads((HERE / 'fao_countries.json').read_text(encoding='utf-8'))
    species_count = build_species(c, trends, countries)
    build_land()
    downloads = build_downloads(a.home / 'exports')
    values = render(trends, c, downloads, species_count)
    check(c, values)
    c.close()


if __name__ == '__main__':
    main()
