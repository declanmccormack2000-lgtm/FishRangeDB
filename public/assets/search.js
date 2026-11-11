/* Search over the species index, in the browser: scientific names, families and common names. */
'use strict';
(async function () {
  const { el, num, t } = FRD;
  const PAGE = 50, GROUPS = 20, FLAGS = { occurrence: 1, catch: 2, length: 4, trend: 8 };
  const form = document.getElementById('search');
  const status = document.getElementById('status');
  const named = document.getElementById('named');
  const results = document.getElementById('results');
  const pager = document.getElementById('pager');
  const fields = ['q', 'type', 'class', 'sort'].map(id => document.getElementById(id));
  const [qField, typeField, classField, sortField] = fields;

  const params = new URLSearchParams(location.search);
  fields.forEach(f => { f.value = params.get(f.name) || ''; if (f.selectedIndex === -1) f.selectedIndex = 0; });
  let page = Math.max(0, (parseInt(params.get('page'), 10) || 1) - 1);

  let index, names;
  try {
    [index, names] = await Promise.all([FRD.json('data/index.json'), FRD.json('data/names.json')]);
  } catch (e) {
    status.textContent = t('load_failed_list');
    return;
  }
  index.classes.forEach((c, i) => classField.append(el('option', { value: i }, c)));
  classField.value = params.get('class') || '';
  // names.rows: [name, kind, taxon, [species index, ...]]; kind 's' species, 'g' genus, 'f' family name.
  const folded = names.rows.map(r => FRD.fold(r[0]));

  function keep(r) {
    const flag = FLAGS[typeField.value] || 0;
    const cls = classField.value === '' ? null : +classField.value;
    return (!flag || r[3] & flag) && (cls === null || r[2] === cls);
  }
  function order(rows) {
    if (sortField.value === 'occ') return [...rows].sort((a, b) => b[4] - a[4]);
    if (sortField.value === 'catch') return [...rows].sort((a, b) => b[5] - a[5]);
    return rows;
  }

  /* Common names containing the query; one group per name, so species sharing a name stay together. */
  function nameGroups(q) {
    const f = FRD.fold(q);
    if (f.length < 2) return [];
    const hits = [];
    folded.forEach((n, i) => {
      if (!n.includes(f)) return;
      const r = names.rows[i];
      const species = order(r[3].map(x => index.rows[x]).filter(keep));
      // 'ハタ' is an exact match for the family name 'ハタ科', as 'grouper' is for 'Groupers'.
      const exact = n === f || n.replace(/[科属]$|e?s$/, '') === f.replace(/e?s$/, '');
      if (species.length) hits.push({ r, species, rank: (exact ? 0 : n.startsWith(f) ? 1 : 2) + (r[1] === 's' ? 0 : 0.5) });
    });
    return hits.sort((a, b) => a.rank - b.rank || b.species.length - a.species.length || a.r[0].length - b.r[0].length);
  }

  function scientific(q) {
    const s = q.toLowerCase().replace(/\s+/g, ' ');
    let rows = index.rows.filter(r => keep(r) && (!s || r[0].toLowerCase().includes(s) || r[1].toLowerCase().includes(s)));
    rows = order(rows);
    if (s && !sortField.value) {
      const starts = r => r[0].toLowerCase().startsWith(s);
      rows = [...rows].sort((a, b) => starts(b) - starts(a));   // stable, so names stay in order
    }
    return rows;
  }

  const columns = () => [{ label: t('col_species') }, { label: t('col_common') }, { label: t('col_family') },
    { label: t('col_occ'), numeric: true }, { label: t('col_catch'), numeric: true }, { label: t('col_years'), numeric: true }];
  const cells = r => [FRD.speciesLink(r[0]), FRD.rowCommon(r), r[1] || '—', r[4] ? num(r[4]) : '—',
    r[5] ? FRD.tonnes(r[5]) : '—', r[6] ? FRD.years(r[6], r[7]) : '—'];

  function groupLabel(r, n) {
    const [name, kind, taxon] = r;
    const what = kind === 'g' ? t('name_of_genus', { taxon }) : kind === 'f' ? t('name_of_family', { taxon }) : '';
    return [el('strong', {}, name), what ? ` ${what}` : '', ` — ${t('n_species', { n: num(n) })}`];
  }

  /* One table; each common name is a row group headed by the name. */
  function groupTable(groups) {
    const cols = columns();
    const head = el('thead', {}, el('tr', {}, cols.map(c => el('th', { scope: 'col', class: c.numeric ? 'n' : null }, c.label))));
    const bodies = groups.map(g => el('tbody', {},
      el('tr', { class: 'group' }, el('th', { scope: 'rowgroup', colspan: cols.length }, groupLabel(g.r, g.species.length))),
      g.species.map((r, i) => el('tr', { class: i % 2 ? 'z' : null },
        cells(r).map((cell, j) => el('td', { class: cols[j].numeric ? 'n' : null }, cell))))));
    return el('div', { class: 'scroll' }, el('div', { class: 'frame', style: 'min-width: 720px' }, el('table', {}, head, bodies)));
  }

  function render() {
    const q = qField.value.trim();
    const groups = nameGroups(q);
    const rows = scientific(q);
    named.replaceChildren();
    if (groups.length) {
      const shown = groups.slice(0, GROUPS);
      named.append(el('h3', {}, t('common_h')), groupTable(shown));
      if (groups.length > GROUPS) named.append(el('p', {}, t('more_names', { n: num(groups.length - GROUPS) })));
      if (rows.length) named.append(el('h3', {}, t('scientific_h')));
    }
    const pages = Math.ceil(rows.length / PAGE);
    page = Math.min(page, Math.max(pages - 1, 0));
    const chunk = rows.slice(page * PAGE, (page + 1) * PAGE);
    const total = new Set([...rows, ...groups.flatMap(g => g.species)]).size;
    status.textContent = total ? t('found', { n: num(total) }) : t('no_match');
    results.replaceChildren();
    if (chunk.length) results.append(FRD.table(columns(), chunk.map(cells), 720));
    FRD.pager(pager, page, pages, p => { page = p; render(); syncUrl(); scrollTo(0, 0); });
  }

  function syncUrl() {
    const out = new URLSearchParams();
    fields.forEach(f => { if (f.value) out.set(f.name, f.value); });
    if (page) out.set('page', page + 1);
    const qs = out.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  }

  form.addEventListener('submit', e => { e.preventDefault(); page = 0; render(); syncUrl(); });
  [typeField, classField, sortField].forEach(f => f.addEventListener('change', () => { page = 0; render(); syncUrl(); }));
  let timer;
  qField.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { page = 0; render(); syncUrl(); }, 150); });
  render();
})();
