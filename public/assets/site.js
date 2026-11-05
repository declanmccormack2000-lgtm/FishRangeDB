/* Helpers shared by every page. */
'use strict';
const FRD = {
  LENGTHS: { TL: 'Total', FL: 'Fork', SL: 'Standard', PCL: 'Precaudal', unspecified: 'Not stated' },
  RESULTS: { decreasing: 'Decreasing', increasing: 'Increasing', 'no clear change': 'No clear change' },

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
  num(x) { return Number(x).toLocaleString('en-GB'); },
  tonnes(t) { return t > 0 && t < 1 ? 'under 1 t' : `${FRD.num(Math.round(t))} t`; },
  years(a, b) { return a === b ? String(a) : `${a}–${b}`; },
  percent(x) { return `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}%`; },
  signed(x, digits) { return `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(digits)}`; },
  lat(x) { return x === null || x === undefined ? '—' : `${Math.abs(x).toFixed(1)}° ${x < 0 ? 'S' : 'N'}`; },
  lon(x) { return `${Math.abs(x).toFixed(1)}° ${x < 0 ? 'W' : 'E'}`; },
  speciesUrl(name) { return `species.html?name=${encodeURIComponent(name).replace(/%20/g, '+')}`; },
  speciesFile(name) { return `data/species/${name.toLowerCase().replace(/ /g, '_')}.json`; },
  speciesLink(name) { return FRD.el('a', { href: FRD.speciesUrl(name) }, FRD.el('i', {}, name)); },
  async json(url) {
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
      FRD.el('button', { class: 'btn', type: 'button', disabled: page === 0, onclick: () => go(page - 1) }, 'Previous'),
      FRD.el('span', {}, `Page ${FRD.num(page + 1)} of ${FRD.num(pages)}`),
      FRD.el('button', { class: 'btn', type: 'button', disabled: page >= pages - 1, onclick: () => go(page + 1) }, 'Next'));
  },
};
