/* Helpers shared by every page. */
'use strict';
const FRD = {
  lang: document.documentElement.lang === 'ja' ? 'ja' : 'en',
  root: document.documentElement.dataset.root || '',

  /* FRD.t('found', {n: 3}) */
  t(key, slots) {
    const text = (FRD_TEXT[FRD.lang] || FRD_TEXT.en)[key] ?? FRD_TEXT.en[key] ?? key;
    return slots ? text.replace(/\{(\w+)\}/g, (m, k) => (k in slots ? slots[k] : m)) : text;
  },

  /* el('a', {href: x}, 'text', child): builds DOM, so data is never parsed as HTML. */
  el(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid !== null && kid !== undefined && kid !== false) node.append(kid);
    }
    return node;
  },
  num(x) { return Number(x).toLocaleString(FRD.lang === 'ja' ? 'ja-JP' : 'en-GB'); },
  tonnes(t) { return t > 0 && t < 1 ? FRD.t('under_1t') : FRD.t('t', { n: FRD.num(Math.round(t)) }); },
  years(a, b) { return a === b ? String(a) : `${a}–${b}`; },
  percent(x) { return `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}%`; },
  signed(x, digits) { return `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(digits)}`; },
  lat(x) {
    if (x === null || x === undefined) return '—';
    const v = Math.abs(x).toFixed(1);
    return FRD.lang === 'ja' ? `${x < 0 ? '南緯' : '北緯'}${v}°` : `${v}° ${x < 0 ? 'S' : 'N'}`;
  },
  lon(x) {
    const v = Math.abs(x).toFixed(1);
    return FRD.lang === 'ja' ? `${x < 0 ? '西経' : '東経'}${v}°` : `${v}° ${x < 0 ? 'W' : 'E'}`;
  },
  lengthName(code) { return FRD.t(`len_${code}`); },
  result(code) { return FRD.t(code); },
  speciesUrl(name) { return `species.html?name=${encodeURIComponent(name).replace(/%20/g, '+')}`; },
  speciesFile(name) { return `${FRD.root}data/species/${name.toLowerCase().replace(/ /g, '_')}.json`; },
  speciesLink(name) { return FRD.el('a', { href: FRD.speciesUrl(name) }, FRD.el('i', {}, name)); },
  async json(path) {
    const url = path.startsWith(FRD.root + 'data/') || /^https?:/.test(path) ? path : FRD.root + path;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  },
  /* table([{label, numeric}], [[cell, ...], ...], minWidth) */
  table(columns, rows, minWidth) {
    const head = FRD.el('tr', {}, columns.map(c => FRD.el('th', { scope: 'col', class: c.numeric ? 'n' : null }, c.label)));
    const body = rows.map((r, i) => FRD.el('tr', { class: i % 2 ? 'z' : null },
      r.map((cell, j) => FRD.el('td', { class: columns[j].numeric ? 'n' : null }, cell))));
    return FRD.el('div', { class: 'scroll' },
      FRD.el('div', { class: 'frame', style: `min-width: ${minWidth || 420}px` }, FRD.el('table', {}, head, body)));
  },
  pager(host, page, pages, go) {
    host.replaceChildren();
    if (pages < 2) return;
    host.append(
      FRD.el('button', { class: 'btn', type: 'button', disabled: page === 0, onclick: () => go(page - 1) }, FRD.t('previous')),
      FRD.el('span', {}, FRD.t('page_of', { page: FRD.num(page + 1), pages: FRD.num(pages) })),
      FRD.el('button', { class: 'btn', type: 'button', disabled: page >= pages - 1, onclick: () => go(page + 1) }, FRD.t('next')));
  },
};

/* Keep the query and anchor when switching language, so a species page opens in the other language. */
(function () {
  const link = document.getElementById('lang-switch');
  if (!link) return;
  const update = () => { link.href = link.getAttribute('href').split(/[?#]/)[0] + location.search + location.hash; };
  update();
  addEventListener('hashchange', update);
  link.addEventListener('click', update);
})();
