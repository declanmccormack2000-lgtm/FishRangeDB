/* Front-page map: every grid cell with records; click one to list its species. */
'use strict';
(async function () {
  const { el, num, t } = FRD;
  const host = document.getElementById('explore-map');
  if (!host) return;
  const detail = document.getElementById('cell-detail');
  const shade = document.getElementById('explore-shade');
  const SPECIES_BINS = [2, 10, 50, 200, Infinity];
  const PAGE = 25;
  const where = (la, lo) => [FRD.lat(la - 89.5), FRD.lon(lo - 179.5)];
  detail.replaceChildren(el('p', {}, t('cell_hint')));

  const map = new FRD.Map(host, document.getElementById('explore-legend'), { onClick: showCell });
  map.canvas.setAttribute('aria-label', t('explore_aria'));
  document.getElementById('zoom-in').addEventListener('click', () => map.zoom(1 / 2));
  document.getElementById('zoom-out').addEventListener('click', () => map.zoom(2));
  document.getElementById('zoom-world').addEventListener('click', () => map.world());

  let flat, index;
  try {
    [flat, index] = await Promise.all([FRD.json('data/cells.json'), FRD.json('data/index.json')]);
  } catch (e) {
    detail.replaceChildren(el('p', {}, t('cell_failed')));
    return;
  }
  const info = new Map();
  for (let i = 0; i < flat.length; i += 4) info.set(`${flat[i]},${flat[i + 1]}`, [flat[i + 2], flat[i + 3]]);

  function paint() {
    const bySpecies = shade.value === 'species';
    const bins = bySpecies ? SPECIES_BINS : FRD.Map.COUNT_BINS;
    const cells = new Map();
    for (const [key, [records, species]] of info) {
      const [la, lo] = key.split(',').map(Number), [lat, lon] = where(la, lo);
      cells.set(key, {
        color: FRD.Map.RAMP[bins.findIndex(b => (bySpecies ? species : records) < b)],
        text: t('cell_tip', { lat, lon, species: num(species), records: num(records) }),
      });
    }
    map.show(cells, bins.map((b, i) => [FRD.Map.RAMP[i], t(`${bySpecies ? 'sp_bin' : 'bin'}_${i + 1}`)]));
  }
  shade.addEventListener('change', paint);
  paint();

  const tiles = new Map();
  async function showCell(la, lo) {
    const [lat, lon] = where(la, lo), [records, species] = info.get(`${la},${lo}`);
    const heading = el('h3', {}, t('cell_h', { lat, lon }));
    detail.replaceChildren(heading, el('p', {}, t('cell_loading')));
    const tileKey = `${Math.floor(la / 10)}_${Math.floor(lo / 10)}`;
    let tile;
    try {
      if (!tiles.has(tileKey)) tiles.set(tileKey, FRD.json(`data/cells/${tileKey}.json`));
      tile = await tiles.get(tileKey);
    } catch (e) {
      tiles.delete(tileKey);
      detail.replaceChildren(heading, el('p', {}, t('cell_failed')));
      return;
    }
    const pairs = tile[`${la},${lo}`] || [];
    const rows = [];
    for (let i = 0; i < pairs.length; i += 2) rows.push([index.rows[pairs[i]], pairs[i + 1]]);
    const table = el('div', {}), pager = el('div', { class: 'pager' });
    const render = page => {
      table.replaceChildren(FRD.table([{ label: t('col_species') }, { label: t('col_common') }, { label: t('col_family') }, { label: t('col_records'), numeric: true }],
        rows.slice(page * PAGE, (page + 1) * PAGE).map(([r, n]) => [FRD.speciesLink(r[0]), FRD.rowCommon(r), r[1] || '—', num(n)]), 560));
      FRD.pager(pager, page, Math.ceil(rows.length / PAGE), render);
    };
    detail.replaceChildren(heading, el('p', {}, t('cell_summary', { records: num(records), species: num(species) })), table, pager);
    render(0);
  }

  /* Place search over Natural Earth names, loaded on first use. */
  const input = document.getElementById('place'), list = document.getElementById('place-list');
  let places = null, matches = [], active = -1;
  const fold = s => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  async function load() {
    if (!places) {
      places = (await FRD.json('data/places.json')).map(p => ({ p, key: fold(`${p[0]} ${p[1]}`), en: fold(p[0]), ja: p[1] }));
    }
  }
  const nameOf = p => (FRD.lang === 'ja' && p[1]) || p[0];
  function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; }
  function go(p) {
    input.value = nameOf(p);
    close();
    map.frame(p[4], p[5], p[6], p[7]);
    document.getElementById('explore-map').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function highlight(i) {
    active = i;
    [...list.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) input.setAttribute('aria-activedescendant', `place-${i}`);
  }
  input.addEventListener('focus', load, { once: true });
  input.addEventListener('input', async () => {
    await load();
    const q = fold(input.value.trim());
    list.replaceChildren();
    if (!q) return close();
    const rank = x => (x.en.startsWith(q) || x.ja.startsWith(input.value.trim()) ? 0 : 1) + (x.p[2] === 'province' ? 0.5 : 0);
    matches = places.filter(x => x.key.includes(q)).sort((a, b) => rank(a) - rank(b) || a.en.length - b.en.length).slice(0, 8);
    if (!matches.length) {
      list.append(el('li', { class: 'empty' }, t('no_places')));
    }
    matches.forEach((x, i) => {
      const p = x.p, ja = FRD.lang === 'ja';
      const extra = [t(`place_kind_${p[2]}`), ja ? p[8] : p[3]].filter(Boolean).join(ja ? '、' : ', ');
      list.append(el('li', { id: `place-${i}`, role: 'option', 'aria-selected': 'false',
        onmousedown: e => { e.preventDefault(); go(p); } }, nameOf(p), el('span', {}, ja ? `（${extra}）` : ` (${extra})`)));
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight(matches.length ? 0 : -1);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' && matches.length) { highlight(Math.min(active + 1, matches.length - 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && matches.length) { highlight(Math.max(active - 1, 0)); e.preventDefault(); }
    else if (e.key === 'Enter') { if (active >= 0 && matches[active]) go(matches[active].p); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 100));
})();
