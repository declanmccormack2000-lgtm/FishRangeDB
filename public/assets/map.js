/* World map of 1° grid cells, drawn on a canvas in plate carree. */
'use strict';
FRD.Map = class {
  static RAMP = ['#8fbfe0', '#5a9bcc', '#337ab7', '#23527c', '#0f2f4f'];
  static COUNT_BINS = [[1, '1'], [10, '2–9'], [100, '10–99'], [1000, '100–999'], [Infinity, '1,000 or more']];
  static SHARE_BINS = [[.01, 'Under 1%'], [.05, '1–5%'], [.2, '5–20%'], [.5, '20–50%'], [Infinity, '50% or more']];
  static EARLIER = '#c2570c';
  static LATER = '#337ab7';
  static BOTH = '#a0a0a0';

  constructor(host, legend) {
    this.legendHost = legend;
    this.canvas = FRD.el('canvas', { width: 1316, height: 658, role: 'img' });
    this.tip = FRD.el('div', { class: 'tip' });
    host.append(this.canvas, this.tip);
    this.cells = new Map();
    this.view = { lon0: -180, lat1: 90, span: 360 };
    this.canvas.addEventListener('pointermove', e => this.hover(e));
    this.canvas.addEventListener('pointerleave', () => { this.tip.style.display = 'none'; });
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  resize() {
    const box = this.canvas.getBoundingClientRect();
    if (!box.width) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(box.width * ratio);
    if (w !== this.canvas.width) {
      this.canvas.width = w;
      this.canvas.height = Math.round(w / 2);
      this.draw();
    }
  }

  /* Frame the given cells at 2:1, or the whole world when they cover most of it. */
  fit(cells) {
    let lon0 = 180, lon1 = -180, lat0 = 90, lat1 = -90;
    for (const [la, lo] of cells) {
      lon0 = Math.min(lon0, lo - 180); lon1 = Math.max(lon1, lo - 179);
      lat0 = Math.min(lat0, la - 90); lat1 = Math.max(lat1, la - 89);
    }
    if (lon0 > lon1) return this.world();
    let span = Math.max((lon1 - lon0) * 1.15, (lat1 - lat0) * 2.3, 60);
    if (span >= 300) return this.world();
    const left = Math.min(Math.max((lon0 + lon1) / 2 - span / 2, -180), 180 - span);
    const top = Math.max(Math.min((lat0 + lat1) / 2 + span / 4, 90), -90 + span / 2);
    this.view = { lon0: left, lat1: top, span };
    this.draw();
  }

  world() { this.view = { lon0: -180, lat1: 90, span: 360 }; this.draw(); }

  px(lon, lat) {
    const k = this.canvas.width / this.view.span;
    return [(lon - this.view.lon0) * k, (this.view.lat1 - lat) * k];
  }

  /* cells: Map of "lat,lon" -> {value, color, text} */
  show(cells, legend) {
    this.cells = cells;
    this.legend = legend;
    this.draw();
  }

  draw() {
    const g = this.canvas.getContext('2d'), { width, height } = this.canvas;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, width, height);
    const k = width / this.view.span;
    const land = this.land || [];
    g.fillStyle = '#e4e4e4';
    g.beginPath();
    for (const r of land) {
      for (let i = 0; i < r.length; i += 2) {
        const [x, y] = this.px(r[i], r[i + 1]);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
    }
    g.fill('evenodd');
    const size = Math.max(Math.ceil(k), 2);
    for (const [key, c] of this.cells) {
      const [la, lo] = key.split(',').map(Number);
      const [x, y] = this.px(lo - 180, la - 89);
      g.fillStyle = c.color;
      g.fillRect(Math.floor(x), Math.floor(y), size, size);
    }
    g.strokeStyle = '#808080';
    g.lineWidth = Math.max(1, width / 1316);
    g.beginPath();
    for (const r of land) {
      for (let i = 0; i < r.length; i += 2) {
        const [x, y] = this.px(r[i], r[i + 1]);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
    }
    g.stroke();
    this.drawLegend();
  }

  drawLegend() {
    const items = this.legend || [];
    this.legendHost.replaceChildren(...items.map(([color, label]) =>
      FRD.el('span', {}, FRD.el('i', { style: `background: ${color}` }), label)));
  }

  hover(e) {
    const box = this.canvas.getBoundingClientRect();
    const f = this.view.span / box.width;
    const lon = this.view.lon0 + (e.clientX - box.left) * f;
    const lat = this.view.lat1 - (e.clientY - box.top) * f;
    const la = Math.floor(lat + 90), lo = Math.floor(lon + 180);
    const c = this.cells.get(`${la},${lo}`);
    if (!c) { this.tip.style.display = 'none'; return; }
    this.tip.textContent = `${FRD.lat(la - 89.5)}, ${FRD.lon(lo - 179.5)}: ${c.text}`;
    this.tip.style.display = 'block';
    const x = e.clientX - box.left, w = this.tip.offsetWidth;
    this.tip.style.left = `${x + w + 12 > box.width ? x - w - 10 : x + 10}px`;
    this.tip.style.top = `${Math.max(0, e.clientY - box.top - 34)}px`;
  }
};
