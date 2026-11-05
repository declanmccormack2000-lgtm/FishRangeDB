/* The species record page. */
'use strict';
(async function () {
  const { el, num } = FRD;
  const title = document.getElementById('species-title');
  const sub = document.getElementById('species-sub');
  const host = document.getElementById('record');
  const name = new URLSearchParams(location.search).get('name') || '';

  const notFound = message => {
    title.textContent = 'Species not found';
    sub.replaceChildren(message, ' ', el('a', { href: 'search.html', style: 'color: var(--link-hover)' }, 'Search the archive'));
  };
  if (!/^[A-Za-z]+ [a-z-]+$/.test(name)) return notFound('No species was named.');
  let rec;
  try {
    rec = await FRD.json(FRD.speciesFile(name));
  } catch (e) {
    return notFound(`We hold no record for ${name}.`);
  }

  document.title = `${rec.name} - FishRangeDB`;
  title.replaceChildren(el('i', {}, rec.name));
  sub.textContent = [rec.family, rec.class].filter(Boolean).join(', ') || 'Family not stated';

  const panel = (heading, ...kids) => {
    const section = el('section', { class: 'panel' }, el('h2', {}, heading), kids);
    host.append(section);
    return section;
  };

  /* Summary */
  const [occ, y0, y1] = rec.occ;
  const facts = [];
  const fact = (k, ...v) => facts.push(el('dt', {}, `${k}:`), el('dd', {}, v));
  if (occ) fact('Occurrence', `${num(occ)} records, ${FRD.years(y0, y1)}`);
  if (rec.catch) {
    const ys = rec.catch.years;
    fact('Catch', `${FRD.tonnes(rec.catch.t)} reported, ${FRD.years(ys[0][0], ys[ys.length - 1][0])}`);
  }
  if (rec.len.length) {
    const years = rec.len.flatMap(d => d.rows.map(r => r[0]));
    fact('Body length', `${rec.len.length} ${rec.len.length === 1 ? 'dataset' : 'datasets'}, ${FRD.years(Math.min(...years), Math.max(...years))}`);
  }
  if (rec.aphia) {
    fact('WoRMS', el('a', { href: `https://www.marinespecies.org/aphia.php?p=taxdetails&id=${encodeURIComponent(rec.aphia)}` }, `AphiaID ${rec.aphia}`));
    if (occ) fact('OBIS', el('a', { href: `https://obis.org/taxon/${encodeURIComponent(rec.aphia)}` }, 'Taxon page'));
  }
  if (rec.fao) fact('FAO code', rec.fao);
  if (rec.neon) fact('Checklist', 'Listed by NSF NEON');
  const record = el('a', { href: FRD.speciesFile(rec.name) }, 'JSON');
  fact('This record', record);
  panel('Summary', el('dl', { class: 'labels' }, facts));

  rangePanel();
  lengthPanel();
  catchPanel();

  function rangePanel() {
    if (!rec.dec.length) {
      if (occ) panel('Recorded Range', el('p', {}, 'None of these records carry usable coordinates.'));
      return;
    }
    const byDecade = new Map(rec.dec.map(d => [d.d, d]));
    const list = d => {
      const out = [];
      for (let i = 0; i < d.cells.length; i += 3) out.push([d.cells[i], d.cells[i + 1], d.cells[i + 2]]);
      return out;
    };
    const every = list({ cells: rec.dec.flatMap(d => d.cells) });
    const options = [...rec.dec].reverse().map(d => el('option', { value: d.d }, `${d.d}s`));
    const select = (id, label, ...opts) => el('div', { class: 'field' },
      el('label', { for: id }, label), el('select', { id }, opts));
    const period = select('map-period', 'Period', el('option', { value: '' }, 'All years'), options);
    const compare = select('map-compare', 'Compare with', el('option', { value: '' }, 'No comparison'), options.map(o => o.cloneNode(true)));
    const colour = select('map-colour', 'Shade by',
      el('option', { value: 'count' }, 'Records'), el('option', { value: 'share' }, 'Share of all fish records'));
    const view = select('map-view', 'View', el('option', { value: 'fit' }, 'Fit to records'), el('option', { value: 'world' }, 'World'));
    const controls = el('div', { class: 'controls' }, period, compare, colour, view);
    const mapHost = el('div', { class: 'map' });
    const legend = el('div', { class: 'legend' });
    const caption = el('figcaption', {});
    panel('Recorded Range',
      controls, el('figure', {}, mapHost, legend, caption),
      el('p', {}, 'Cells mark where the species was recorded, not where it lives. A cell left empty may simply not have been sampled, and the earliest record is not the original range. Shading by share divides these records by all fish records in the same cell and period.'),
      el('h3', {}, 'Latitude by Decade'),
      FRD.table([{ label: 'Decade' }, { label: 'Records', numeric: true }, { label: 'Cells', numeric: true },
        { label: 'Mean latitude', numeric: true }, { label: 'Middle 90%', numeric: true }, { label: 'Effort-adjusted', numeric: true }],
      [...rec.dec].reverse().map(d => [`${d.d}s`, num(d.n), num(d.c), FRD.lat(d.lat),
        `${FRD.lat(d.lo)} to ${FRD.lat(d.hi)}`, FRD.lat(d.adj)]), 600),
      el('p', {}, 'Mean latitude is weighted by records. Effort-adjusted latitude weights each cell by its share of all fish records, so heavily sampled seas count for less. In decades with few records, these figures are unreliable.'));

    const map = new FRD.Map(mapHost, legend);
    map.canvas.setAttribute('aria-label', `Map of recorded grid cells for ${rec.name}. The table below gives the same range by decade.`);
    let effort = null;
    const pick = id => document.getElementById(id).value;

    const count = (rows, into) => {
      for (const [la, lo, n] of rows) into.set(`${la},${lo}`, (into.get(`${la},${lo}`) || 0) + n);
      return into;
    };
    const effortFor = decades => {
      const total = new Map();
      for (const d of decades) {
        const f = effort[d] || [];
        for (let i = 0; i < f.length; i += 3) {
          const key = `${f[i]},${f[i + 1]}`;
          total.set(key, (total.get(key) || 0) + f[i + 2]);
        }
      }
      return total;
    };
    const bin = (value, bins) => FRD.Map.RAMP[bins.findIndex(b => value < b[0])];

    async function render() {
      const p = pick('map-period'), q = pick('map-compare');
      const shading = pick('map-colour');
      document.getElementById('map-colour').disabled = Boolean(q);
      const label = p ? `${p}s` : 'All years';
      const cells = new Map();
      let items, fitted;
      if (q && p && p !== q) {
        const [early, late] = [Math.min(p, q), Math.max(p, q)];
        const a = count(list(byDecade.get(early)), new Map()), b = count(list(byDecade.get(late)), new Map());
        for (const [k, n] of a) cells.set(k, b.has(k)
          ? { color: FRD.Map.BOTH, text: `${num(n)} in ${early}s, ${num(b.get(k))} in ${late}s` }
          : { color: FRD.Map.EARLIER, text: `${num(n)} in ${early}s, none in ${late}s` });
        for (const [k, n] of b) if (!a.has(k)) cells.set(k, { color: FRD.Map.LATER, text: `none in ${early}s, ${num(n)} in ${late}s` });
        items = [[FRD.Map.EARLIER, `${early}s only`], [FRD.Map.LATER, `${late}s only`], [FRD.Map.BOTH, 'Both']];
        caption.textContent = `Recorded cells of ${rec.name}, ${early}s compared with ${late}s. Source: OBIS. Sampling also differs between the two periods.`;
        fitted = [...cells.keys()].map(k => k.split(',').map(Number));
      } else {
        const rows = p ? list(byDecade.get(+p)) : every;
        const counts = count(rows, new Map());
        if (shading === 'share') {
          effort = effort || await FRD.json('data/effort.json');
          const totals = effortFor(p ? [p] : Object.keys(effort));
          for (const [k, n] of counts) {
            const share = n / (totals.get(k) || n);
            cells.set(k, { color: bin(share, FRD.Map.SHARE_BINS), text: `${(share * 100).toFixed(1)}% of ${num(totals.get(k) || n)} fish records` });
          }
          items = FRD.Map.SHARE_BINS.map((b, i) => [FRD.Map.RAMP[i], b[1]]);
        } else {
          for (const [k, n] of counts) cells.set(k, { color: bin(n, FRD.Map.COUNT_BINS), text: `${num(n)} ${n === 1 ? 'record' : 'records'}` });
          items = FRD.Map.COUNT_BINS.map((b, i) => [FRD.Map.RAMP[i], b[1]]);
        }
        caption.textContent = `Recorded cells of ${rec.name}, ${label}, 1° grid. Source: OBIS.`;
        fitted = rows;
      }
      map.show(cells, items);
      pick('map-view') === 'world' ? map.world() : map.fit(fitted);
    }
    controls.addEventListener('change', render);
    FRD.json('data/land.json').then(land => { map.land = land; map.draw(); }).catch(() => {});
    render();
  }

  function lengthPanel() {
    if (!rec.len.length) return;
    const kids = [];
    if (rec.trends.length) {
      kids.push(FRD.table([{ label: 'Length' }, { label: 'Years', numeric: true }, { label: 'Surveys', numeric: true },
        { label: 'Fish', numeric: true }, { label: 'Mean', numeric: true }, { label: 'Per decade', numeric: true }, { label: 'Result' }],
      rec.trends.map(t => [FRD.LENGTHS[t[0]], FRD.years(t[1], t[2]), num(t[3]), num(t[4]), `${t[5].toFixed(1)} cm`,
        `${FRD.percent(t[7])} (${FRD.signed(t[6], 2)} cm)`, FRD.RESULTS[t[9]]]), 620));
      kids.push(el('p', {}, 'A result describes the fish that were sampled. Fishing pressure, gear, season or age composition can each cause it, and it is not evidence of evolutionary change.'));
    }
    const label = d => `${d.title} (${FRD.LENGTHS[d.type].toLowerCase()}, ${d.src === 'ICES' ? 'ICES' : 'OBIS'})`;
    const pickable = rec.len.filter(d => d.rows.length >= 2);
    if (pickable.length) {
      const select = el('select', { id: 'length-dataset' }, pickable.map((d, i) => el('option', { value: i }, label(d))));
      const chart = el('div', { class: 'chart' });
      const caption = el('figcaption', {});
      const rows = el('div', {});
      const show = () => {
        const d = pickable[+select.value];
        FRD.lineChart(chart, {
          points: d.rows.map(r => [r[0], r[2]]),
          formatY: (v, digits, axis) => axis ? v.toFixed(digits) : `${v.toFixed(1)} cm`,
          label: `Line chart of mean ${FRD.LENGTHS[d.type].toLowerCase()} length of ${rec.name} by year in ${d.title}. The table below lists each year.`,
          tooltip: p => `${p[0]}: ${p[1].toFixed(1)} cm, ${num(d.rows.find(r => r[0] === p[0])[1])} fish`,
        });
        caption.textContent = `Mean length (cm) by year in ${d.title}. Source: ${d.src === 'ICES' ? 'ICES DATRAS' : 'OBIS'}.`;
        rows.replaceChildren(FRD.table([{ label: 'Year' }, { label: 'Fish', numeric: true }, { label: 'Mean length', numeric: true }],
          [...d.rows].reverse().map(r => [String(r[0]), num(r[1]), `${r[2].toFixed(1)} cm`])));
      };
      select.addEventListener('change', show);
      kids.push(el('div', { class: 'controls' }, el('div', { class: 'field', style: 'flex-basis: 100%' },
        el('label', { for: 'length-dataset' }, 'Survey or dataset'), select)));
      kids.push(el('figure', {}, chart, caption));
      kids.push(el('details', {}, el('summary', {}, 'Yearly figures'), rows));
      panel('Body Length', kids);
      show();
    } else {
      panel('Body Length', kids);
    }
    const once = rec.len.filter(d => d.rows.length < 2);
    const last = host.lastElementChild;
    if (once.length) last.append(el('p', { style: 'margin-top: 10px' }, `A further ${num(once.length)} ${once.length === 1 ? 'dataset holds' : 'datasets hold'} lengths from a single year.`));
    if (rec.len.some(d => d.src === 'ICES')) last.append(el('p', { style: 'margin-top: 10px' }, 'ICES fish counts are raised to the whole catch of each haul, so they are larger than the number of fish measured. Each survey is shown alone because surveys differ in gear, season and area.'));
  }

  function catchPanel() {
    if (!rec.catch) return;
    const c = rec.catch, chart = el('div', { class: 'chart' });
    const top = (rows, n) => {
      const shown = rows.slice(0, n).map(r => [r[0], FRD.tonnes(r[1])]);
      const rest = rows.slice(n).reduce((s, r) => s + r[1], 0);
      if (rest) shown.push([`${num(rows.length - n)} others`, FRD.tonnes(rest)]);
      return shown;
    };
    const column = [{ label: 'Area' }, { label: 'Catch', numeric: true }];
    panel('Catch',
      el('figure', {}, chart, el('figcaption', {}, `Reported catch of ${rec.name} by year, tonnes. Source: FAO FishStat.`)),
      el('h3', {}, 'By FAO Area'), FRD.table(column, top(c.areas, 10)),
      el('h3', {}, 'By Country'), FRD.table([{ label: 'Country' }, column[1]], top(c.countries, 10)),
      el('p', {}, 'Catch is what was reported, by country and FAO fishing area. It does not measure stock size or give fishing positions.'));
    FRD.lineChart(chart, {
      points: c.years, zero: true,
      formatY: (v, digits, axis) => axis ? compact(v) : FRD.tonnes(v),
      label: `Line chart of reported catch of ${rec.name} by year, in tonnes.`,
    });
    function compact(v) {
      if (v >= 1e6) return `${+(v / 1e6).toFixed(2)}M`;
      if (v >= 1e3) return `${+(v / 1e3).toFixed(1)}k`;
      return String(+v.toFixed(1));
    }
  }

  if (!occ && !rec.catch && !rec.len.length) {
    panel('Records', el('p', {}, 'This name comes from a checklist. We hold no occurrence, catch or body-length records for it.'));
  }
})();
