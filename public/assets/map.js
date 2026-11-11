/* World map of 1° grid cells on a canvas, in plate carree. It wraps east to west,
   zooms with the wheel, buttons or a pinch, and pans by dragging. */
'use strict';
FRD.Map = class {
  static RAMP = ['#8fbfe0', '#5a9bcc', '#337ab7', '#23527c', '#0f2f4f'];
  static COUNT_BINS = [1, 10, 100, 1000, Infinity];
  static SHARE_BINS = [.01, .05, .2, .5, Infinity];
  static EARLIER = '#c2570c';
  static LATER = '#337ab7';
  static BOTH = '#a0a0a0';
  static MIN_SPAN = 3;

  /* opts: {onClick(la, lo), label} */
  constructor(host, legend, opts = {}) {
    this.opts = opts;
    this.legendHost = legend;
    this.canvas = FRD.el('canvas', { width: 1316, height: 658, role: 'img', tabindex: 0 });
    this.tip = FRD.el('div', { class: 'tip' });
    host.append(this.canvas, this.tip);
    this.cells = new Map();
    this.view = { cx: 0, cy: 0, span: 360 };
    this.pointers = new Map();
    const c = this.canvas;
    c.addEventListener('pointerdown', e => this.down(e));
    c.addEventListener('pointermove', e => this.move(e));
    c.addEventListener('pointerup', e => this.up(e));
    c.addEventListener('pointercancel', e => this.up(e));
    c.addEventListener('pointerleave', () => { this.tip.style.display = 'none'; });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      this.zoomAt(e.deltaY < 0 ? 1 / 1.4 : 1.4, ...this.lonLat(e));
    }, { passive: false });
    c.addEventListener('keydown', e => {
      const step = this.view.span / 8;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step / 2], ArrowDown: [0, -step / 2] };
      if (moves[e.key]) { this.setView(this.view.cx + moves[e.key][0], this.view.cy + moves[e.key][1], this.view.span); }
      else if (e.key === '+' || e.key === '=') this.zoom(1 / 1.5);
      else if (e.key === '-') this.zoom(1.5);
      else return;
      e.preventDefault();
    });
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    FRD.json(`${FRD.root}data/land.json`).then(land => { this.land = land; this.draw(); }).catch(() => {});
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

  setView(cx, cy, span) {
    span = Math.min(Math.max(span, FRD.Map.MIN_SPAN), 360);
    const half = span / 4;
    cy = span >= 360 ? 0 : Math.min(Math.max(cy, -90 + half), 90 - half);
    cx = ((cx + 180) % 360 + 360) % 360 - 180;
    this.view = { cx, cy, span };
    if (span < 90 && !this.detail && !this.loadingDetail) {
      this.loadingDetail = true;
      FRD.json(`${FRD.root}data/land-50m.json`).then(land => { this.detail = land; this.draw(); }).catch(() => {});
    }
    this.draw();
  }

  zoom(factor) { this.setView(this.view.cx, this.view.cy, this.view.span * factor); }

  zoomAt(factor, lon, lat) {
    const { cx, cy, span } = this.view;
    const next = Math.min(Math.max(span * factor, FRD.Map.MIN_SPAN), 360), f = next / span;
    this.setView(lon - (lon - cx) * f, lat - (lat - cy) * f, next);
  }

  world() { this.setView(0, 0, 360); }

  /* Frame a box, west > east when it crosses the 180° meridian. */
  frame(w, s, e, n, minSpan = 8) {
    if (e < w) e += 360;
    const span = Math.max((e - w) * 1.25, (n - s) * 2.5, minSpan);
    this.setView((w + e) / 2, (s + n) / 2, span >= 300 ? 360 : span);
  }

  /* Frame cells given as [lat_bin, lon_bin, ...], choosing the shorter way round. */
  fit(cells) {
    if (!cells.length) return this.world();
    const lons = [...new Set(cells.map(c => c[1] - 180))].sort((a, b) => a - b);
    let w = lons[0], e = lons[lons.length - 1] + 1, gap = 360 - (e - w);
    for (let i = 0; i < lons.length - 1; i++) {
      if (lons[i + 1] - lons[i] - 1 > gap) { gap = lons[i + 1] - lons[i] - 1; w = lons[i + 1]; e = lons[i] + 1; }
    }
    const lats = cells.map(c => c[0] - 90);
    this.frame(w, Math.min(...lats), e, Math.max(...lats) + 1, 60);
  }

  show(cells, legend) {
    this.cells = cells;
    this.legend = legend;
    this.draw();
  }

  lonLat(e) {
    const box = this.canvas.getBoundingClientRect();
    const f = this.view.span / box.width;
    return [this.view.cx + (e.clientX - box.left - box.width / 2) * f, this.view.cy - (e.clientY - box.top - box.height / 2) * f];
  }

  draw() {
    const g = this.canvas.getContext('2d'), { width, height } = this.canvas;
    const { cx, cy, span } = this.view, k = width / span;
    const lon0 = cx - span / 2, lat1 = cy + span / 4;
    const shifts = [-360, 0, 360].filter(s => lon0 < 180 + s && lon0 + span > -180 + s);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, width, height);
    const land = (span < 90 && this.detail) || this.land || [];
    const path = () => {
      g.beginPath();
      for (const s of shifts) {
        for (const r of land) {
          for (let i = 0; i < r.length; i += 2) {
            const x = (r[i] + s - lon0) * k, y = (lat1 - r[i + 1]) * k;
            i ? g.lineTo(x, y) : g.moveTo(x, y);
          }
          g.closePath();
        }
      }
    };
    g.fillStyle = '#e4e4e4';
    path();
    g.fill('evenodd');
    const size = Math.max(Math.ceil(k), 2);
    for (const s of shifts) {
      for (const [key, c] of this.cells) {
        const comma = key.indexOf(',');
        const la = +key.slice(0, comma), lo = +key.slice(comma + 1);
        const x = (lo - 180 + s - lon0) * k, y = (lat1 - (la - 89)) * k;
        if (x + size < 0 || x > width || y + size < 0 || y > height) continue;
        g.fillStyle = c.color;
        g.fillRect(Math.floor(x), Math.floor(y), size, size);
      }
    }
    g.strokeStyle = '#808080';
    g.lineWidth = Math.max(1, width / 1316);
    path();
    g.stroke();
    if (this.selected) {
      const [la, lo] = this.selected;
      g.strokeStyle = '#000000';
      g.lineWidth = Math.max(2, width / 658);
      for (const s of shifts) g.strokeRect((lo - 180 + s - lon0) * k, (lat1 - (la - 89)) * k, Math.max(k, 4), Math.max(k, 4));
    }
    this.legendHost.replaceChildren(...(this.legend || []).map(([color, label]) =>
      FRD.el('span', {}, FRD.el('i', { style: `background: ${color}` }), label)));
  }

  cellAt(e) {
    const [lon, lat] = this.lonLat(e);
    const la = Math.floor(lat + 90), lo = (((Math.floor(lon + 180)) % 360) + 360) % 360;
    return [la, lo];
  }

  down(e) {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.dragged = false;
    this.start = { x: e.clientX, y: e.clientY, view: { ...this.view } };
    if (this.pointers.size === 2) this.pinch = this.distance();
  }

  distance() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  move(e) {
    if (this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2 && this.pinch) {
        const d = this.distance();
        if (Math.abs(d - this.pinch) > 4) { this.zoom(this.pinch / d); this.pinch = d; this.dragged = true; }
        return;
      }
      const dx = e.clientX - this.start.x, dy = e.clientY - this.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.dragged = true;
      if (this.dragged) {
        const f = this.start.view.span / this.canvas.getBoundingClientRect().width;
        this.setView(this.start.view.cx - dx * f, this.start.view.cy + dy * f, this.start.view.span);
        this.tip.style.display = 'none';
        return;
      }
    }
    if (e.pointerType === 'touch') return;
    const [la, lo] = this.cellAt(e);
    const c = this.cells.get(`${la},${lo}`);
    if (!c) { this.tip.style.display = 'none'; this.canvas.style.cursor = 'grab'; return; }
    this.canvas.style.cursor = this.opts.onClick ? 'pointer' : 'crosshair';
    this.tip.textContent = c.text;
    this.tip.style.display = 'block';
    const box = this.canvas.getBoundingClientRect(), x = e.clientX - box.left, w = this.tip.offsetWidth;
    this.tip.style.left = `${x + w + 12 > box.width ? Math.max(0, x - w - 10) : x + 10}px`;
    this.tip.style.top = `${Math.max(0, e.clientY - box.top - 34)}px`;
  }

  up(e) {
    const tapped = this.pointers.size === 1 && !this.dragged;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (tapped && e.type === 'pointerup' && this.opts.onClick) {
      const [la, lo] = this.cellAt(e);
      if (this.cells.has(`${la},${lo}`)) { this.selected = [la, lo]; this.draw(); this.opts.onClick(la, lo); }
    }
  }
};
