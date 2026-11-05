# FishRangeDB website

The public website for FishRangeDB, an archive of fish occurrence, catch and body-length records by the McCormack Marine Institute.

Live site: https://fishrangedb.declanmccormack2000.workers.dev

It is a static site. Cloudflare Workers Builds deploys the `public/` folder whenever `main` changes (see `wrangler.jsonc`). There is no server and no database behind it: search runs in the browser over `public/data/index.json`, and each species has one JSON file in `public/data/species/`.

## Rebuilding after the data changes

The database itself is not in this repository. With the FishRangeDB project on your computer and this repository at `<project>/website`:

```
python build/build_site.py --home D:\FishRangeDB
```

This reads `database/fishrange.sqlite` and `exports/`, rewrites everything in `public/` except `public/assets/`, and stops with an error if the output disagrees with the database. Then commit and push.

| Path | What it is |
|---|---|
| `build/build_site.py` | Generates pages, data and downloads |
| `build/templates/` | Page templates. Edit these, not `public/*.html` |
| `build/land-110m.json` | Natural Earth 1:110m land (public domain), via world-atlas 2.0.2 |
| `build/fao_countries.json` | Country names from the FAO FishStat code list |
| `public/assets/` | Hand-written CSS and JavaScript |
| `public/data/`, `public/downloads/` | Generated. Do not edit |

## Data licences

Attribute each source and follow its licence. OBIS: CC BY-NC 4.0 (bulk snapshot, non-commercial use). FAO FishStat and ICES DATRAS: CC BY 4.0. Coastlines: Natural Earth, public domain.
