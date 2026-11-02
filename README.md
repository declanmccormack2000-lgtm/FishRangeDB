# FishRangeDB — resumable global fish species coverage database

**Version:** 0.3.0 (30 October 2026)  
**Status:** Working, tested database/importer and an OPTIONAL OBIS GeoParquet adapter. Synthetic records used by unit tests are not added to the delivered database.

### Changes in 0.3.0

- **Body lengths from OBIS measurements** (`tools/obis_lengths.py`) and a new `length_stats` table (schema version 3, now 4 with `dataset_series`; run `init` to upgrade).
- **Size trends:** `exports/species_length_by_year.csv` (mean, SD and sample size per species, length type and year) and `exports/species_size_trends.csv` (within-dataset change per decade with a verdict). See "Body sizes and size trends" below.
- **FAO catch import** (`tools/fao_capture.py`) and `exports/species_catch_by_area.csv`.
- Hybrid names (`A b x C d`) and "X or Y" group labels are no longer read as species.
- **ICES DATRAS trawl-survey lengths** (`tools/datras.py`) added as source `ICES`. See "ICES DATRAS survey lengths" below.

### Changes in 0.2.0

- **Fish filter fixed for WoRMS/OBIS taxonomy.** OBIS classifies ray-finned fishes as classes `Teleostei`, `Holostei`, `Chondrostei`, `Cladistii` (gigaclass `Actinopterygii`) and cartilaginous fishes as `Elasmobranchii`/`Holocephali`. Version 0.1 only accepted `Actinopterygii`/`Chondrichthyes`, so it imported only hagfishes, lampreys and coelacanths (44 species). The v0.1 database is kept in `backups/database_v0.1_2026-10-30/`.
- **OBIS adapter uses species-level names** (`interpreted.species` and its AphiaID), so subspecies roll up to their species and genus-only records are flagged instead of mislabelled as rank `species`.
- **OBIS summary mode aggregates inside DuckDB** (species × year × grid cell) and writes each Parquet file in one SQLite transaction. It no longer creates a temporary CSV or re-hashes unchanged files. `--mode full` still uses the CSV row-by-row path.
- **New `effort_cells` table:** all accepted fish records per year × grid cell, used to normalize species maps by sampling effort (see `docs/SCHEMA.md`).
- **NEON catalog fixed:** the API returns `dwc:`-prefixed fields; synonyms are now mapped to their accepted name.
- Schema version 2. Run `init` once to upgrade a version-1 database in place.

## 1. Five-minute Windows setup

1. Install **Python 3.11 or newer**, with **Add Python to PATH** enabled. For OBIS bulk data, optionally install the AWS CLI and DuckDB as described below.
2. Unzip `fishrange-db-starter.zip` into any directory. To minimize copying, place the project folder on your secondary drive, for example `D:\FishRangeDB-project` (replace **D:** with your actual drive letter).
3. Open PowerShell in the unzipped project directory.
4. Create the *persistent data home* on the secondary drive:

```powershell
python .\fishdb.py --home "D:\FishRangeDB" init
python .\fishdb.py --home "D:\FishRangeDB" status
python .\fishdb.py --home "D:\FishRangeDB" verify
```

These commands require no extra Python packages and do not download any research data.

**Do not store the 400 GB of data inside the source-code project folder.** The `--home` folder is where the persistent database, raw files, checkpoints and exports live. You can update the source code separately without touching them.

## 2. Folder layout

```text
D:\FishRangeDB\
  database\
    fishrange.sqlite      <-- MAIN persistent SQLite database; do not delete
    obis_completed\      <-- per-file OBIS completion manifests, if enabled
  raw\                  <-- original downloaded files (keep these)
    obis\occurrence\     <-- optional official OBIS bulk Parquet files
    obis_staging\        <-- temporary CSV conversions (removed after success)
  exports\              <-- regenerated summaries and quality reports
  logs\
```

The SQLite database is initialized with the database schema and source registry, but zero research species/catch/occurrence records. Run imports to populate it. The test suite has separate synthetic temporary databases.

## 3. First real catalog: NSF NEON fish taxonomy (automatic, free)

The [NSF NEON Fish Taxonomy API](https://data.neonscience.org/data-api/endpoints/taxonomy/) exposes a public fish taxon inventory (the portal listed 1,879 fish taxon entries at the time of development, including genus-only and synonyms; this is **not 1,879 verified species**). Its official API needs no API key for basic taxonomy queries. This is a good small real-data smoke test before OBIS.

```powershell
# Download the first page of the OFFICIAL NEON FISH taxonomy checklist and import it.
python .\tools\neon_catalog.py --home "D:\FishRangeDB" --max-pages 1

# Then download and import all remaining pages, resuming previous work.
python .\tools\neon_catalog.py --home "D:\FishRangeDB"

python .\fishdb.py --home "D:\FishRangeDB" status
python .\fishdb.py --home "D:\FishRangeDB" export
```

Original API JSON pages are cached under `raw/neon/`, and each page is imported only once by checksum. The core import uses `--assume-fish` only because the request explicitly selects NEON's `FISH` taxon list. It still rejects genus-only names. Species catalog entries are **not evidence of actual historical occurrence**.

## 4. Pilot a small occurrence CSV/TSV dataset

Download a small, authoritative dataset using the provider's website and put it under `D:\FishRangeDB\raw\`. Verify its column names and terms first.

For a Darwin Core-like occurrence file with `scientificName`, `class`, `year`, `decimalLatitude` and `decimalLongitude`:

```powershell
python .\fishdb.py --home "D:\FishRangeDB" ingest --file "D:\FishRangeDB\raw\sample-occurrences.csv" --source OBIS --kind occurrence --mode summary
python .\fishdb.py --home "D:\FishRangeDB" status
python .\fishdb.py --home "D:\FishRangeDB" export
```

If the input lacks a taxonomic class, **do not** use `--assume-fish` until it has independently been filtered to real finfish. For different header names provide a JSON `--column-map`, using `examples/column_map.example.json` as a template.

**Important: the default `summary` mode stores annual species coverage and 1°×1° bins, but not exact coordinates for every record.** This is intended for an inexpensive global coverage audit. Use `--mode full` from the start if you need to store every imported observation. Do not change the mode for the same source file in the same database; the importer prohibits this because it could double-count.

## 5. Recommended first big dataset: OBIS GeoParquet

OBIS recommends its GeoParquet files on AWS for large-scale data analysis, rather than scraping the OBIS API. According to the OBIS documentation, the snapshot is around **50 GB**; available size may change. Sources and citation: https://github.com/iobis/obis-open-data and https://obis.org/data/access/ . The **full OBIS data product is CC BY-NC 4.0**, even though its providers offer a mixture of licenses. Consult the `licenses.tsv` file and publisher citations. Do not assume unrestricted commercial reuse.

Install the official [AWS CLI](https://aws.amazon.com/cli/) on Windows (or use OBIS's documented methods). From PowerShell:

```powershell
# Download/synchronize original Parquet files to your SECONDARY DRIVE.
aws s3 sync --no-sign-request s3://obis-open-data/occurrence/ "D:\FishRangeDB\raw\obis\occurrence\"
aws s3 cp --no-sign-request s3://obis-open-data/licenses.tsv "D:\FishRangeDB\raw\obis\licenses.tsv"

# Install the optional local Parquet-to-CSV adapter dependency.
python -m pip install duckdb

# PILOT: import the first 3 previously synced OBIS source datasets.
python .\tools\obis_batch.py --home "D:\FishRangeDB" --input "D:\FishRangeDB\raw\obis\occurrence" --max-files 3

# AFTER checking the reports, continue where it left off (run again as needed):
python .\tools\obis_batch.py --home "D:\FishRangeDB" --input "D:\FishRangeDB\raw\obis\occurrence"

# Inspect and export the current results.
python .\fishdb.py --home "D:\FishRangeDB" status
python .\fishdb.py --home "D:\FishRangeDB" verify
python .\fishdb.py --home "D:\FishRangeDB" export
```

The OBIS adapter reads one Parquet source file at a time, excludes absence and dropped records and filters to fish classes (WoRMS names). In the default `summary` mode, DuckDB aggregates the file to species × year × 1° cell counts, and the counts, the `imports` row and any issue counts are committed in **one** SQLite transaction. A small JSON manifest is then saved under `database/obis_completed/`. Use `--threads` and `--memory-limit` to tune DuckDB. Original Parquet files remain for reproducibility.

If interrupted, just rerun the **identical** command. A file is either fully committed or not at all, so the run restarts at the first unfinished file. In `--mode full`, records go through a temporary CSV and the core importer resumes from the last committed row. If OBIS replaces a previously imported source Parquet file in a newer release, the adapter **stops rather than combining incompatible snapshots**: create a new snapshot database for a refreshed release. AWS CLI sync handles download retries; the adapter handles import retries.

**Capacity:** With 400 GB free, an approximately 50 GB compressed OBIS snapshot plus temporary conversion space is plausible. Actual space for SQLite summaries, indexes and other sources will vary and should be monitored. Do not attempt to import all raw observations into `--mode full` without measuring disk and runtime costs first.

## 6. Other datasets, including catches and body sizes

### GBIF

GBIF offers authenticated asynchronous downloads, including `SPECIES_LIST` and `SIMPLE_CSV`; register for a free account: https://techdocs.gbif.org/en/data-use/api-downloads . Filter the download to fish using GBIF taxonomy, retain the downloadable DOI and metadata, and place it in `raw/gbif/`. Once the species data have standard taxonomic columns, import like:

```powershell
python .\fishdb.py --home "D:\FishRangeDB" ingest --file "D:\FishRangeDB\raw\gbif\occurrence.csv" --source GBIF --kind occurrence
```

For huge GBIF bulk results, use provider-approved bulk downloads instead of paging the REST search API (which caps offset pagination).

### Body sizes and size trends (OBIS measurements)

OBIS keeps measurements in the ExtendedMeasurementOrFact (eMoF) extension of each occurrence. `tools/obis_lengths.py` imports fish body lengths in two stages:

```powershell
# 1. One resumable pass over the local OBIS Parquet files (~25 min); stages candidates in raw\obis_staging\obis_lengths.duckdb
python .\tools\obis_lengths.py --home "D:\FishRangeDB" extract --input "D:\FishRangeDB\raw\obis\occurrence"
# 2. Classify, convert and load (seconds; re-runnable, replaces all OBIS length data)
python .\tools\obis_lengths.py --home "D:\FishRangeDB" load
# 3. Group programmes published as one OBIS dataset per year into series (looks up dataset titles; re-runnable)
python .\tools\obis_lengths.py --home "D:\FishRangeDB" series
python .\fishdb.py --home "D:\FishRangeDB" export
```

The load stage:
- **Classifies** each measurement as total (TL), fork (FL), standard (SL) or pre-caudal (PCL) length, or `unspecified`. Lengths of other things are excluded: widths, carapace, fins, gonads, nets, sampling tracks, longitude, length-weight parameters, prey and predator lengths, and min/max/mean summaries.
- **Converts units** to cm and drops values outside 0.1–2000 cm or more than 10× above / 20× below the species median, which catches mm/cm slips.
- **Drops ambiguous event-level lengths.** Event-level measurements are copied to every species caught in that event, so they are kept only when the occurrence carries exactly one length of that type.

Length types are never mixed: a fork length is shorter than a total length for the same fish.

**Trends** (`species_size_trends.csv`) are estimated **within datasets**: years and mean lengths are centred within each dataset before fitting one pooled slope. A change in *which* surveys exist cannot create a trend, for example a juvenile survey starting after an adult fishery sample ends. A verdict needs:
- at least 5 distinct years spanning at least 10 years, from datasets measured in at least 2 years,
- at least 100 measured fish,
- |t| ≥ 3 (strict, because thousands of species are tested at once).

Otherwise the verdict is `no clear change` or `insufficient data`.

**Dataset series.** Some monitoring programmes publish one OBIS dataset per survey year, and a within-dataset trend can't be estimated from single-year datasets. The `series` stage looks up OBIS dataset titles, removes years, year ranges and "during YYYY", and groups datasets **only when two or more share the same remaining title**. One explicit link (`SERIES_LINKS` in `tools/obis_lengths.py`) joins NOAA's National Coral Reef Monitoring Program assessments for the Florida Keys and Dry Tortugas to the Reef Visual Census series they continue from 2014. The groups are kept in the `dataset_series` table and listed in `exports/dataset_series.csv`. Trends and dataset counts use the series; the raw `length_stats.dataset_id` is unchanged. As of 30 October 2026 this forms two series: Florida Keys (11 datasets, 1994–2018) and Dry Tortugas (8 datasets, 1999–2016). A trend is a change in the **sampled** size. Fishing pressure, gear, season, area or age composition within a dataset can all cause it, and it is not evidence of genetic shrinking.

### ICES DATRAS survey lengths (automated)

`tools/datras.py` downloads haul (HH) and length-frequency (HL) records for every DATRAS survey from the official web service. It keeps only the needed columns as gzipped CSV in `raw\datras\<survey>\`. The download is resumable and runs up to 3 surveys in parallel, sequentially within each survey.

```powershell
python .\tools\datras.py --home "D:\FishRangeDB" download          # optionally --survey NS-IBTS BITS --years 2020 2021
python .\tools\datras.py --home "D:\FishRangeDB" load              # re-runnable; replaces all ICES length rows
python .\fishdb.py --home "D:\FishRangeDB" export
```

The load stage works as follows:
- **Join and filter hauls.** HL is joined to HH on the haul key. Invalid (`I`), partly valid (`P`) and no-oxygen (`N`) hauls are dropped, along with non-fish taxa.
- **Length types.** Mantle, carapace, shell and fin lengths (LenMeasType 5–11, 13) and plus-groups (LngtCode 9) are dropped. Lengths with type "not known" (−9) are treated as **total length**, which the IBTS/BTS manuals prescribe for fish; countries started reporting code 1 in different years.
- **Units.** Length classes become cm midpoints: a 1 cm class "10" is 10.5 cm and a 1 mm class "101" is 10.15 cm.
- **Raising to the full catch.** Each length class is weighted by the number of fish it represents in the catch: `HLNoAtLngt × SubFactor`, or `× HaulDur/60` for per-hour (CPUE) data. Means are therefore not biased toward size categories that were measured more completely. For ICES, `length_stats.n_measured` holds these **raised numbers**, not the count of fish physically measured.
- **Datasets.** Each dataset is survey × quarter × gear (e.g. `DATRAS:NS-IBTS:Q1:GOV`), so trends compare a survey with itself.
- **Species.** AphiaIDs are resolved through species already linked from OBIS. Unknown IDs are looked up once in WoRMS and cached in `raw\datras\worms_aphia_cache.json`.
- **No occurrences.** DATRAS hauls are also published to OBIS, so only lengths are added, to avoid double-counting records and map cells.

Licence: CC BY 4.0, cite "ICES Database of Trawl Surveys (DATRAS), ICES, Copenhagen".

### Other length measurements (NOAA etc.)

Use `--kind length`. It accepts `length_cm`/`length`, count/`sample_n` and a year. When a unit is absent, specify `--length-unit cm`, `mm`, etc. **DATRAS haul and length rows must be joined correctly by survey/haul keys first**, and use the official units metadata: https://datras.ices.dk/webservices/webservices.aspx . A single length-frequency row contributes `sample_n × length_cm` to its count-weighted average. Ensure identical gear, species, sex/size class and survey methods when interpreting trends.

```powershell
python .\fishdb.py --home "D:\FishRangeDB" ingest --file "D:\FishRangeDB\raw\ices\prepared_length.csv" --source ICES --kind length --length-unit cm
```

### FAO global capture production (automated)

`tools/fao_capture.py` reads FAO's official bulk ZIP directly. It keeps finfish (ASFIS major group PISCES) in tonnes live weight, drops zero-tonne rows, joins ISO3 country codes and FAO major fishing area names, and imports in `--mode full`, so every species × country × area × year row is kept in `catches`:

```powershell
python .\fishdb.py --home "D:\FishRangeDB" download --url "https://www.fao.org/fishery/static/Data/Capture_2026.1.0.zip" --output "fao/Capture_2026.1.0.zip"
python .\tools\fao_capture.py --home "D:\FishRangeDB" --zip "D:\FishRangeDB\raw\fao\Capture_2026.1.0.zip"
```

`exports/species_catch_by_area.csv` gives tonnes per species, year and FAO area. Family, genus, "nei" and hybrid items go to `catch_groups`, about a third of finfish tonnage. A new FAO release (`Capture_<year>.1.0.zip`, published each March) has different content, so import it into a **new** database rather than adding it to this one; otherwise years would be double-counted. Licence: CC BY 4.0, cite "FAO FishStat Global capture production, release 2026.1.0".

### Other capture volumes (NOAA etc.)

Use `--kind catch` with **species scientific names** in a field (or mapped column), year, `catch` and `unit`. For files that omit a unit, you **must** supply `--catch-unit tonnes` or another verified unit. Year columns in wide FishStat exports must be unpivoted to long form before ingestion; the current prototype does **not** perform automatic FishStat parsing. **Areas are reporting/fishing regions, not precise catch coordinates.** Non-species categories are stored in `catch_groups`, not counted as species.

```powershell
python .\fishdb.py --home "D:\FishRangeDB" ingest --file "D:\FishRangeDB\raw\fao\prepared_catch.csv" --source FAO --kind catch --catch-unit tonnes
```

### Taxonomy and synonyms

Use `--kind catalog` for vetted finfish species checklists. The importer accepts `acceptedScientificName` as the authoritative name where provided, records source-specific taxon IDs, and retains original name assertions. Use `--kind synonym` for an **authoritative** crosswalk containing `scientificName` (synonym) and `acceptedScientificName` (accepted), plus fish-class metadata. That command can merge an older species row into its accepted species while retaining coverage. Conflicting names are flagged rather than silently resolved. Full taxonomic reconciliation across competing authorities is **not automatic** in version 0.1.

## 7. Pausing/resuming and later ChatGPT sessions

**You do not need to keep this chat open, keep your PC awake, or restart from scratch.** When an import is interrupted, the database remembers the last successfully committed row. Original source files are identified by SHA-256 hashes. Re-running exactly the same `ingest` command resumes. Re-running a completed import does not add it again. The `download` command can resume `.part` files from servers supporting HTTP Range requests.

Commands to run *at any time*:

```powershell
python .\fishdb.py --home "D:\FishRangeDB" status --json | Out-File -Encoding utf8 "D:\FishRangeDB\exports\status.json"
python .\fishdb.py --home "D:\FishRangeDB" verify
python .\fishdb.py --home "D:\FishRangeDB" export
```

In a new ChatGPT conversation, say **"Continue my FishRangeDB project, version 0.1"** and upload this source-code ZIP plus **`exports/status.json`** or the relevant script/log. You do **not** need to upload the huge raw files or SQLite database simply to discuss the next step; they stay on your drive. To have me directly analyze the actual data in a later chat, upload a compact export or a small subset. I cannot remotely access your drive or run the downloading in the background.

For backups, close any running imports and copy the entire `database/` directory, including the OBIS completion manifests. Source files in `raw/` should be retained or be recoverable from their cited publisher snapshot. Never delete the SQLite `.sqlite` file assuming the tiny `status.json` contains the full data.

## 8. Data quality and scientific limitations

- **Not a complete worldwide database yet** — as of 0.2.0 it holds the OBIS (mostly marine) snapshot and the NEON catalog; freshwater coverage needs GBIF. FAO catch volumes are imported (by country and FAO area, not coordinates); body lengths come from 97 OBIS datasets (mainly NOAA coral-reef monitoring, Canadian Pacific and Maritimes trawl surveys, Australian surveys) plus ICES DATRAS trawl surveys (North Sea, Baltic, Northeast Atlantic). OBIS programmes published one dataset per year are grouped into series (see "Dataset series"); a programme whose yearly titles differ in other ways is not grouped automatically.
- **Not an estimate of natural range** — observed localities and coarse grid counts depend on uneven sampling effort. The earliest observation is not the original native range.
- **Not directly comparable CPUE** — raw catch volume without standardized effort cannot measure stock abundance.
- **Size changes need a standardized survey** — count-weighted means may change due to sampling selectivity, region, sex, gear and age composition; do not call this evolutionary shrinking.
- **No cross-provider duplicate removal of observations yet** — one specimen can appear independently in OBIS and GBIF. Summed source counts could overcount globally. Counts are source-specific for this reason.
- **Partial ID deduplication** — `--mode full` deduplicates repeated occurrences using provided provider identifiers, while `summary` mode deduplicates *re-imported files*, but cannot find overlapping rows across different file exports.
- **Old synonyms still require reconciliation** — matching accepted scientific names is straightforward; disputed taxonomy needs an explicit reference version.
- **Citation and licensing** — maintain original provider details and citations; the full OBIS GeoParquet snapshot is noncommercial by default.

## 9. Developer tests

```powershell
python -m unittest discover -s tests -v
```

All tests operate on disposable, **synthetic** data in temporary folders; no synthetic fish observation data ships in the initialized research database.

For the complete command reference:

```powershell
python .\fishdb.py --help
python .\fishdb.py ingest --help
```
