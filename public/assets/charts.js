/* One-series line chart with a crosshair and tooltip. */
'use strict';
FRD.lineChart = function (host, opts) {
  const { points, formatY, label, zero } = opts;
  const W = 640, H = 262, L = 56, R = 16, T = 14, B = 32;
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let lo = zero ? 0 : Math.min(...ys), hi = Math.max(...ys);
  if (lo === hi) { lo -= 1; hi += 1; }

  const raw = (hi - lo) / 5, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find(s => s * mag >= raw) * mag;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const sx = x => x1 === x0 ? (L + W - R) / 2 : L + (x - x0) / (x1 - x0) * (W - L - R);
  const sy = y => T + (hi - y) / (hi - lo) * (H - T - B);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label });
  const text = (x, y, s, anchor, fill, size) => svg.append(svgEl('text', {
    x, y, 'text-anchor': anchor, fill, 'font-size': size, 'font-family': '"Times New Roman", Times, serif' }, s));
  const decimals = Number.isInteger(step) ? 0 : 1;
  for (let i = 0, v = lo; v <= hi + step / 2; i++, v = lo + i * step) {
    const y = sy(v);
    svg.append(svgEl('line', { x1: L, x2: W - R, y1: y, y2: y, stroke: i ? '#eeeeee' : '#808080', 'stroke-width': 1 }));
    text(L - 8, y + 4, formatY(v, decimals, true), 'end', '#666666', 13);
  }
  const span = x1 - x0, tick = span > 100 ? 50 : span > 40 ? 20 : span > 15 ? 10 : span > 6 ? 5 : 1;
  for (let y = Math.ceil(x0 / tick) * tick; y <= x1; y += tick) text(sx(y), H - 12, y, 'middle', '#666666', 13);

  /* Years with no data break the line; a year with no neighbour gets a dot. */
  let d = '';
  points.forEach((p, i) => {
    const gap = !i || p[0] - points[i - 1][0] > 1;
    d += `${gap ? 'M' : 'L'}${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`;
    const alone = gap && (i === points.length - 1 || points[i + 1][0] - p[0] > 1);
    if (alone) svg.append(svgEl('circle', { cx: sx(p[0]), cy: sy(p[1]), r: 3, fill: '#23527c' }));
  });
  svg.append(svgEl('path', { d, fill: 'none', stroke: '#23527c', 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

  const mark = (p, anchor) => {
    const cy = sy(p[1]);
    svg.append(svgEl('circle', { cx: sx(p[0]), cy, r: 4, fill: '#23527c', stroke: '#ffffff', 'stroke-width': 2 }));
    const x = sx(p[0]) + (anchor === 'start' ? 2 : -2);
    text(x, cy < T + 22 ? cy + 18 : cy - 9, formatY(p[1]), anchor, '#000000', 14);
    const label = svg.lastChild;
    label.setAttribute('stroke', '#ffffff');
    label.setAttribute('stroke-width', 4);
    label.setAttribute('paint-order', 'stroke');
  };
  mark(points[0], 'start');
  if (points.length > 1) mark(points[points.length - 1], 'end');

  const cross = svgEl('line', { y1: T, y2: H - B, stroke: '#808080', 'stroke-width': 1, visibility: 'hidden' });
  const dot = svgEl('circle', { r: 4, fill: '#23527c', stroke: '#ffffff', 'stroke-width': 2, visibility: 'hidden' });
  svg.append(cross, dot);
  const tip = FRD.el('div', { class: 'tip' });
  host.replaceChildren(svg, tip);

  const hide = () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; };
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('pointermove', e => {
    const box = svg.getBoundingClientRect();
    const scale = W / box.width, px = (e.clientX - box.left) * scale;
    let best = points[0];
    for (const p of points) if (Math.abs(sx(p[0]) - px) < Math.abs(sx(best[0]) - px)) best = p;
    const cx = sx(best[0]), cy = sy(best[1]);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('visibility', 'visible');
    tip.textContent = opts.tooltip ? opts.tooltip(best) : `${best[0]}: ${formatY(best[1])}`;
    tip.style.display = 'block';
    const left = cx / scale + 10, w = tip.offsetWidth;
    tip.style.left = `${left + w > box.width ? cx / scale - w - 10 : left}px`;
    tip.style.top = `${Math.max(0, cy / scale - 34)}px`;
  });
};
