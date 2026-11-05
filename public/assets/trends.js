/* Filterable, sortable table of every size-trend estimate. */
'use strict';
(async function () {
  const { el, num } = FRD;
  const PAGE = 50;
  const status = document.getElementById('status');
  const results = document.getElementById('results');
  const pager = document.getElementById('pager');
  const q = document.getElementById('q'), result = document.getElementById('result'), length = document.getElementById('length');
  document.getElementById('filters').addEventListener('submit', e => e.preventDefault());

  /* rows: name, type, first, last, surveys, fish, mean, cm/decade, %/decade, t, result */
  let rows;
  try {
    rows = await FRD.json('data/trends.json');
  } catch (e) {
    status.textContent = 'The estimates could not be loaded.';
    return;
  }
  const COLUMNS = [
    { label: 'Species', key: 0 }, { label: 'Length', key: 1 }, { label: 'Years', key: 2, numeric: true },
    { label: 'Surveys', key: 4, numeric: true }, { label: 'Fish', key: 5, numeric: true },
    { label: 'Per decade', key: 8, numeric: true }, { label: 'Result', key: 10 }];
  let sort = { key: 8, dir: 1 }, page = 0;

  function render() {
    const needle = q.value.trim().toLowerCase();
    const shown = rows.filter(r => (!needle || r[0].toLowerCase().includes(needle)) &&
      (!result.value || r[10] === result.value) && (!length.value || r[1] === length.value));
    shown.sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      return sort.dir * (typeof x === 'number' ? x - y : String(x).localeCompare(String(y)));
    });
    const pages = Math.ceil(shown.length / PAGE);
    page = Math.min(page, Math.max(pages - 1, 0));
    status.textContent = shown.length ? `${num(shown.length)} estimates shown.` : 'No estimates match these filters.';

    const head = el('tr', {}, COLUMNS.map(c => el('th', {
      scope: 'col', class: c.numeric ? 'n' : null,
      'aria-sort': c.key === sort.key ? (sort.dir > 0 ? 'ascending' : 'descending') : null,
    }, el('button', { type: 'button', onclick: () => {
      sort = { key: c.key, dir: c.key === sort.key ? -sort.dir : 1 };
      page = 0;
      render();
    } }, c.label))));
    const body = shown.slice(page * PAGE, (page + 1) * PAGE).map((r, i) => el('tr', { class: i % 2 ? 'z' : null },
      el('td', {}, FRD.speciesLink(r[0])), el('td', {}, FRD.LENGTHS[r[1]]),
      el('td', { class: 'n' }, `${r[2]}–${r[3]}`), el('td', { class: 'n' }, num(r[4])), el('td', { class: 'n' }, num(r[5])),
      el('td', { class: 'n' }, FRD.percent(r[8])), el('td', {}, FRD.RESULTS[r[10]])));
    results.replaceChildren();
    if (shown.length) {
      results.append(el('div', { class: 'scroll' }, el('div', { class: 'frame', style: 'min-width: 640px' }, el('table', {}, head, body))));
    }
    FRD.pager(pager, page, pages, p => { page = p; render(); scrollTo(0, 0); });
  }
  q.addEventListener('input', () => { page = 0; render(); });
  result.addEventListener('change', () => { page = 0; render(); });
  length.addEventListener('change', () => { page = 0; render(); });
  render();
})();
