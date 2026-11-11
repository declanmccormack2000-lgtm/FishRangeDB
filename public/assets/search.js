/* Search over the species index, in the browser. */
'use strict';
(async function () {
  const { el, num } = FRD;
  const PAGE = 50, FLAGS = { occurrence: 1, catch: 2, length: 4, trend: 8 };
  const form = document.getElementById('search');
  const status = document.getElementById('status');
  const results = document.getElementById('results');
  const pager = document.getElementById('pager');
  const fields = ['q', 'type', 'class', 'sort'].map(id => document.getElementById(id));
  const [qField, typeField, classField, sortField] = fields;

  const params = new URLSearchParams(location.search);
  fields.forEach(f => { f.value = params.get(f.name) || ''; if (f.selectedIndex === -1) f.selectedIndex = 0; });
  let page = Math.max(0, (parseInt(params.get('page'), 10) || 1) - 1);

  let index;
  try {
    index = await FRD.json('data/index.json');
  } catch (e) {
    status.textContent = FRD.t('load_failed_list');
    return;
  }
  index.classes.forEach((c, i) => classField.append(el('option', { value: i }, c)));
  classField.value = params.get('class') || '';

  function matches() {
    const q = qField.value.trim().toLowerCase().replace(/\s+/g, ' ');
    const flag = FLAGS[typeField.value] || 0;
    const cls = classField.value === '' ? null : +classField.value;
    let rows = index.rows.filter(r =>
      (!flag || r[3] & flag) && (cls === null || r[2] === cls) &&
      (!q || r[0].toLowerCase().includes(q) || r[1].toLowerCase().includes(q)));
    if (sortField.value === 'occ') rows = [...rows].sort((a, b) => b[4] - a[4]);
    else if (sortField.value === 'catch') rows = [...rows].sort((a, b) => b[5] - a[5]);
    else if (q) {
      const starts = r => r[0].toLowerCase().startsWith(q);
      rows = [...rows].sort((a, b) => starts(b) - starts(a));   // stable, so names stay in order
    }
    return rows;
  }

  function render() {
    const rows = matches();
    const pages = Math.ceil(rows.length / PAGE);
    page = Math.min(page, Math.max(pages - 1, 0));
    const chunk = rows.slice(page * PAGE, (page + 1) * PAGE);
    status.textContent = rows.length ? FRD.t('found', { n: num(rows.length) }) : FRD.t('no_match');
    results.replaceChildren();
    if (chunk.length) {
      results.append(FRD.table(
        [{ label: FRD.t('col_species') }, { label: FRD.t('col_family') }, { label: FRD.t('col_occ'), numeric: true }, { label: FRD.t('col_catch'), numeric: true }, { label: FRD.t('col_years'), numeric: true }],
        chunk.map(r => [FRD.speciesLink(r[0]), r[1] || '—', r[4] ? num(r[4]) : '—', r[5] ? FRD.tonnes(r[5]) : '—', r[6] ? FRD.years(r[6], r[7]) : '—']), 620));
    }
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
  qField.addEventListener('input', () => { page = 0; render(); syncUrl(); });
  render();
})();
