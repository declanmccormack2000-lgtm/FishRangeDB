/* The species record page. */
'use strict';
(async function () {
  const { el, num, t } = FRD;
  const title = document.getElementById('species-title');
  const sub = document.getElementById('species-sub');
  const host = document.getElementById('record');
  const name = new URLSearchParams(location.search).get('name') || '';
  const where = (la, lo) => `${FRD.lat(la - 89.5)}, ${FRD.lon(lo - 179.5)}`;

  const notFound = message => {
    title.textContent = t('not_found');
    sub.replaceChildren(message, ' ', el('a', { href: 'search.html', style: 'color: var(--link-hover)' }, t('search_archive')));
  };
  if (!/^[A-Za-z]+ [a-z-]+$/.test(name)) return notFound(t('no_name'));
  let rec, countries = {};
  try {
    rec = await FRD.json(FRD.speciesFile(name));
  } catch (e) {
    return notFound(t('no_record', { name }));
  }
  if (rec.catch) countries = await FRD.json('data/countries.json').catch(() => ({}));

  document.title = `${rec.name} - FishRangeDB`;
  title.replaceChildren(el('i', {}, rec.name));
  sub.textContent = [rec.family, rec.class].filter(Boolean).join(', ') || t('family_unknown');

  const panel = (heading, ...kids) => {
    const section = el('section', { class: 'panel' }, el('h2', {}, heading), kids);
    host.append(section);
    return section;
  };

  /* Summary */
  const [occ, y0, y1] = rec.occ;
  const facts = [];
  const fact = (k, ...v) => facts.push(el('dt', {}, FRD.lang === 'ja' ? `${k}：` : `${k}:`), el('dd', {}, v));
  if (occ) fact(t('occurrence'), t('occ_fact', { n: num(occ), years: FRD.years(y0, y1) }));
  if (rec.catch) {
    const ys = rec.catch.years;
    fact(t('catch'), t('catch_fact', { t: FRD.tonnes(rec.catch.t), years: FRD.years(ys[0][0], ys[ys.length - 1][0]) }));
  }
  if (rec.len.length) {
    const years = rec.len.flatMap(d => d.rows.map(r => r[0]));
    const span = FRD.years(Math.min(...years), Math.max(...years));
    fact(t('body_length'), rec.len.length === 1 ? t('len_fact_one', { years: span }) : t('len_fact', { n: num(rec.len.length), years: span }));
  }
  if (rec.aphia) {
    fact(t('worms'), el('a', { href: `https://www.marinespecies.org/aphia.php?p=taxdetails&id=${encodeURIComponent(rec.aphia)}` }, `AphiaID ${rec.aphia}`));
    if (occ) fact(t('obis'), el('a', { href: `https://obis.org/taxon/${encodeURIComponent(rec.aphia)}` }, t('taxon_page')));
  }
  if (rec.fao) fact(t('fao_code'), rec.fao);
  if (rec.neon) fact(t('checklist'), t('neon_listed'));
  fact(t('this_record'), el('a', { href: FRD.speciesFile(rec.name) }, 'JSON'));
  panel(t('summary'), el('dl', { class: 'labels' }, facts));

  rangePanel();
  lengthPanel();
  catchPanel();

  function rangePanel() {
    if (!rec.dec.length) {
      if (occ) panel(t('range_h'), el('p', {}, t('no_coords')));
      return;
    }
    const byDecade = new Map(rec.dec.map(d => [d.d, d]));
    const list = d => {
      const out = [];
      for (let i = 0; i < d.cells.length; i += 3) out.push([d.cells[i], d.cells[i + 1], d.cells[i + 2]]);
      return out;
    };
    const decade = d => t('decade', { d });
    const every = list({ cells: rec.dec.flatMap(d => d.cells) });
    const options = [...rec.dec].reverse().map(d => el('option', { value: d.d }, decade(d.d)));
    const select = (id, label, ...opts) => el('div', { class: 'field' },
      el('label', { for: id }, label), el('select', { id }, opts));
    const controls = el('div', { class: 'controls' },
      select('map-period', t('period'), el('option', { value: '' }, t('all_years')), options),
      select('map-compare', t('compare_with'), el('option', { value: '' }, t('no_comparison')), options.map(o => o.cloneNode(true))),
      select('map-colour', t('shade_by'), el('option', { value: 'count' }, t('records')), el('option', { value: 'share' }, t('share'))),
      select('map-view', t('view'), el('option', { value: 'fit' }, t('fit')), el('option', { value: 'world' }, t('world'))));
    const mapHost = el('div', { class: 'map' });
    const legend = el('div', { class: 'legend' });
    const caption = el('figcaption', {});
    panel(t('range_h'),
      controls, el('figure', {}, mapHost, legend, caption),
      el('p', {}, t('range_note')),
      el('h3', {}, t('lat_h')),
      FRD.table([{ label: t('col_decade') }, { label: t('col_records'), numeric: true }, { label: t('col_cells'), numeric: true },
        { label: t('col_mean_lat'), numeric: true }, { label: t('col_mid90'), numeric: true }, { label: t('col_adj'), numeric: true }],
      [...rec.dec].reverse().map(d => [decade(d.d), num(d.n), num(d.c), FRD.lat(d.lat),
        t('to', { a: FRD.lat(d.lo), b: FRD.lat(d.hi) }), FRD.lat(d.adj)]), 600),
      el('p', {}, t('lat_note')));

    const map = new FRD.Map(mapHost, legend);
    map.canvas.setAttribute('aria-label', t('map_aria', { name: rec.name }));
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
    const bin = (value, bins) => FRD.Map.RAMP[bins.findIndex(b => value < b)];
    const at = key => where(...key.split(',').map(Number));
    let lastView = null;

    async function render() {
      const p = pick('map-period'), q = pick('map-compare');
      const shading = pick('map-colour');
      document.getElementById('map-colour').disabled = Boolean(q);
      const cells = new Map();
      let items, fitted;
      if (q && p && p !== q) {
        const early = decade(Math.min(p, q)), late = decade(Math.max(p, q));
        const a = count(list(byDecade.get(Math.min(p, q))), new Map()), b = count(list(byDecade.get(Math.max(p, q))), new Map());
        for (const [k, n] of a) {
          cells.set(k, b.has(k)
            ? { color: FRD.Map.BOTH, text: `${at(k)}: ${t('cmp_both_text', { a: num(n), b: num(b.get(k)), early, late })}` }
            : { color: FRD.Map.EARLIER, text: `${at(k)}: ${t('cmp_early_text', { a: num(n), early, late })}` });
        }
        for (const [k, n] of b) if (!a.has(k)) cells.set(k, { color: FRD.Map.LATER, text: `${at(k)}: ${t('cmp_late_text', { b: num(n), early, late })}` });
        items = [[FRD.Map.EARLIER, t('only', { d: early })], [FRD.Map.LATER, t('only', { d: late })], [FRD.Map.BOTH, t('both')]];
        caption.textContent = t('cmp_caption', { name: rec.name, early, late });
        fitted = [...cells.keys()].map(k => k.split(',').map(Number));
      } else {
        const rows = p ? list(byDecade.get(+p)) : every;
        const counts = count(rows, new Map());
        if (shading === 'share') {
          effort = effort || await FRD.json('data/effort.json');
          const totals = effortFor(p ? [p] : Object.keys(effort));
          for (const [k, n] of counts) {
            const all = totals.get(k) || n, share = n / all;
            cells.set(k, { color: bin(share, FRD.Map.SHARE_BINS), text: `${at(k)}: ${t('share_text', { p: (share * 100).toFixed(1), n: num(all) })}` });
          }
          items = FRD.Map.SHARE_BINS.map((b, i) => [FRD.Map.RAMP[i], t(`sbin_${i + 1}`)]);
        } else {
          for (const [k, n] of counts) {
            cells.set(k, { color: bin(n, FRD.Map.COUNT_BINS), text: `${at(k)}: ${n === 1 ? t('record_one') : t('record_n', { n: num(n) })}` });
          }
          items = FRD.Map.COUNT_BINS.map((b, i) => [FRD.Map.RAMP[i], t(`bin_${i + 1}`)]);
        }
        caption.textContent = t('range_caption', { name: rec.name, period: p ? decade(p) : t('all_years') });
        fitted = rows;
      }
      map.show(cells, items);
      const view = `${pick('map-view')}|${p}|${q}`;
      if (view !== lastView) { lastView = view; pick('map-view') === 'world' ? map.world() : map.fit(fitted); }
    }
    controls.addEventListener('change', render);
    render();
  }

  function datasetTitle(d) {
    const m = d.src === 'ICES' && /^(.+), quarter (\d), gear (.+)$/.exec(d.title);
    return m ? t('ices_title', { survey: m[1], q: m[2], gear: m[3] }) : d.title;
  }

  function lengthPanel() {
    if (!rec.len.length) return;
    const kids = [];
    if (rec.trends.length) {
      kids.push(FRD.table([{ label: t('col_length') }, { label: t('col_years'), numeric: true }, { label: t('col_surveys'), numeric: true },
        { label: t('col_fish'), numeric: true }, { label: t('col_mean'), numeric: true }, { label: t('col_per_decade'), numeric: true }, { label: t('col_result') }],
      rec.trends.map(x => [FRD.lengthName(x[0]), FRD.years(x[1], x[2]), num(x[3]), num(x[4]), t('cm', { v: x[5].toFixed(1) }),
        `${FRD.percent(x[7])} (${FRD.signed(x[6], 2)} cm)`, FRD.result(x[9])]), 620));
      kids.push(el('p', {}, t('caveat')));
    }
    const source = d => (d.src === 'ICES' ? 'ICES DATRAS' : 'OBIS');
    const label = d => t('dataset_label', { title: datasetTitle(d), type: FRD.lengthName(d.type), src: d.src === 'ICES' ? 'ICES' : 'OBIS' });
    const pickable = rec.len.filter(d => d.rows.length >= 2);
    if (pickable.length) {
      const select = el('select', { id: 'length-dataset' }, pickable.map((d, i) => el('option', { value: i }, label(d))));
      const chart = el('div', { class: 'chart' });
      const caption = el('figcaption', {});
      const rows = el('div', {});
      const show = () => {
        const d = pickable[+select.value], title = datasetTitle(d);
        FRD.lineChart(chart, {
          points: d.rows.map(r => [r[0], r[2]]),
          formatY: (v, digits, axis) => axis ? v.toFixed(digits) : t('cm', { v: v.toFixed(1) }),
          label: t('len_aria', { type: FRD.lengthName(d.type), name: rec.name, title }),
          tooltip: p => t('len_tip', { y: p[0], v: p[1].toFixed(1), n: num(d.rows.find(r => r[0] === p[0])[1]) }),
        });
        caption.textContent = t('len_caption', { title, src: source(d) });
        rows.replaceChildren(FRD.table([{ label: t('col_year') }, { label: t('col_fish'), numeric: true }, { label: t('col_mean_length'), numeric: true }],
          [...d.rows].reverse().map(r => [String(r[0]), num(r[1]), t('cm', { v: r[2].toFixed(1) })])));
      };
      select.addEventListener('change', show);
      kids.push(el('div', { class: 'controls' }, el('div', { class: 'field', style: 'flex-basis: 100%' },
        el('label', { for: 'length-dataset' }, t('survey_label')), select)));
      kids.push(el('figure', {}, chart, caption));
      kids.push(el('details', {}, el('summary', {}, t('yearly')), rows));
      panel(t('body_length'), kids);
      show();
    } else {
      panel(t('body_length'), kids);
    }
    const once = rec.len.filter(d => d.rows.length < 2);
    const last = host.lastElementChild;
    if (once.length) last.append(el('p', { style: 'margin-top: 10px' }, once.length === 1 ? t('single_one') : t('single_n', { n: num(once.length) })));
    if (rec.len.some(d => d.src === 'ICES')) last.append(el('p', { style: 'margin-top: 10px' }, t('ices_note')));
  }

  function areaName(a) {
    if (!a || a === 'Not stated') return t('not_stated');
    if (FRD.lang !== 'ja') return a;
    const code = a.slice(0, 2);
    return FRD_AREAS_JA[code] ? `${code} ${FRD_AREAS_JA[code]}` : a;
  }

  function countryName(code) {
    if (!code) return t('not_stated');
    const names = countries[code];
    return names ? names[FRD.lang === 'ja' ? 1 : 0] : code;
  }

  function catchPanel() {
    if (!rec.catch) return;
    const c = rec.catch, chart = el('div', { class: 'chart' });
    const top = (rows, n, name) => {
      const shown = rows.slice(0, n).map(r => [name(r[0]), FRD.tonnes(r[1])]);
      const rest = rows.slice(n).reduce((s, r) => s + r[1], 0);
      if (rows.length > n) shown.push([t('others', { n: num(rows.length - n) }), FRD.tonnes(rest)]);
      return shown;
    };
    const tonnes = { label: t('col_catch'), numeric: true };
    panel(t('catch'),
      el('figure', {}, chart, el('figcaption', {}, t('catch_caption', { name: rec.name }))),
      el('h3', {}, t('by_area')), FRD.table([{ label: t('col_area') }, tonnes], top(c.areas, 10, areaName)),
      el('h3', {}, t('by_country')), FRD.table([{ label: t('col_country') }, tonnes], top(c.countries, 10, countryName)),
      el('p', {}, t('catch_note')));
    FRD.lineChart(chart, {
      points: c.years, zero: true,
      formatY: (v, digits, axis) => axis ? compact(v) : FRD.tonnes(v),
      label: t('catch_aria', { name: rec.name }),
    });
    function compact(v) {
      if (FRD.lang === 'ja') {
        if (v >= 1e4) return `${+(v / 1e4).toFixed(1)}万`;
        return String(+v.toFixed(1));
      }
      if (v >= 1e6) return `${+(v / 1e6).toFixed(2)}M`;
      if (v >= 1e3) return `${+(v / 1e3).toFixed(1)}k`;
      return String(+v.toFixed(1));
    }
  }

  if (!occ && !rec.catch && !rec.len.length) {
    panel(t('records_h'), el('p', {}, t('checklist_only')));
  }
})();
