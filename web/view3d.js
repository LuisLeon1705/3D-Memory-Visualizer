// Constelación de una memoria CTHG de proyecto.
//
// - X · el árbol del repositorio es el cielo: el centro es «todo el proyecto» (las reglas sin
//   ruta, el núcleo); cada carpeta o archivo con recuerdos es un astro, y las líneas de la
//   constelación unen cada astro con su carpeta madre. Las ramas se reparten en abanico según
//   cuántos recuerdos cuelgan de ellas.
// - Y · el tiempo es la altura: lo más reciente flota más arriba sobre su astro.
// - Z · χ decide la luz y la física: +1 (verificado) = brillante y bien atado a su ruta;
//   −1 (descartado) = tenue, translúcido y casi sin atracción, así que deriva hacia fuera.
"use strict";

const KIND_COLORS = {
  regla: "#f0b44c",
  decision: "#9b8cff",
  hecho: "#5fb3d9",
  incidente: "#ff6b6b",
  convencion: "#7fd18b",
  plan: "#e879f9",
  comando: "#3fd6c8",
  sesion: "#969caa",
};
const KIND_LABELS = {
  regla: "Regla",
  decision: "Decisión",
  hecho: "Hecho",
  incidente: "Incidente",
  convencion: "Convención",
  plan: "Plan",
  comando: "Comando",
  sesion: "Sesión",
};
const ORIGIN_COLORS = {
  repo: "#f0b44c",
  importado: "#c99a5b",
  agente: "#9a8fb0",
  usuario: "#ff6b6b",
  sesion: "#3fd6c8",
};
const EDGE_STYLE = {
  causa: { color: [240, 180, 76], label: "causa" },
  relacion: { color: [95, 179, 217], label: "relación" },
  menciona: { color: [150, 156, 170], label: "menciona" },
  precede: { color: [63, 214, 200], label: "precede" },
  contradice: { color: [235, 80, 90], dash: [4, 4], label: "contradice" },
  sustituye: { color: [176, 122, 217], dash: [6, 3], label: "sustituye" },
};
const KIND_RADIUS = { regla: 4.6, decision: 4.6, hecho: 4.2, incidente: 4.4, convencion: 4.0, plan: 4.0, comando: 4.0, sesion: 3.4 };
/// Distance between tree levels on the floor of the sky.
const LEVEL_R = 230;
/// Height span of the time axis above each star.
const TIME_SPAN = 260;

function chiColor(z) {
  // −1 carmesí · 0 gris · +1 oro
  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  const neg = [200, 50, 58], mid = [92, 98, 110], pos = [227, 180, 90];
  const t = Math.max(-1, Math.min(1, z));
  const [a, b, u] = t < 0 ? [mid, neg, -t] : [mid, pos, t];
  return `rgb(${lerp(a[0], b[0], u)},${lerp(a[1], b[1], u)},${lerp(a[2], b[2], u)})`;
}

function rgbOf(col) {
  if (col.startsWith("#")) {
    const n = parseInt(col.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return col.match(/\d+/g).map(Number);
}

// Deterministic pseudo-random so the sky and the first layout are stable between reloads.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function parentOf(path) {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

class View3D {
  constructor(canvas, tooltip) {
    this.c = canvas;
    this.g = canvas.getContext("2d");
    this.tooltip = tooltip;
    this.bodies = [];
    this.links = [];
    this.edges = [];
    this.byId = new Map();
    this.hubs = new Map();
    this.cam = { yaw: 0.55, pitch: 0.62, dist: 1600, tx: 0, ty: 0, tz: 0 };
    this.opts = {
      color: "kind",
      coreOnly: false,
      showPlans: false,
      showStale: true,
      autorotate: false,
      edges: { causa: true, relacion: false, menciona: false, precede: false, contradice: true, sustituye: true },
      layers: { memory: true, code: true, imports: true, calls: false },
      hiddenKinds: new Set(),
      search: "",
    };
    this.code = null;
    this.codeFiles = new Map();
    this.selectedFile = null;
    this.reachHubs = null;
    this.reachAnchored = null;
    this.alpha = 1;
    this.hover = null;
    this.selected = null;
    this.onSelect = () => {};
    this.onSelectFile = () => {};
    this.dpr = window.devicePixelRatio || 1;
    this._makeSky();
    this._bind();
    this._resize();
    new ResizeObserver(() => this._resize()).observe(canvas);
    requestAnimationFrame((t) => this._frame(t));
  }

  // ───────────── structure ─────────────
  setGraph(g, code, viewKey) {
    const prev = new Map(this.bodies.map((b) => [b.key, b]));
    this.name = g.name;
    this.code = code || null;
    this.codeFiles = new Map();
    if (this.code && this.code.files) {
      for (const f of this.code.files) this.codeFiles.set(f.path, f);
    }
    this.byId = new Map();
    const nodes = g.nodes.map((n) => Object.assign({}, n, { key: "n" + n.id, nb: [], isHub: false }));
    for (const n of nodes) this.byId.set(n.id, n);
    this.edges = g.edges.filter((e) => this.byId.has(e.f) && this.byId.has(e.t));
    for (const e of this.edges) {
      this.byId.get(e.f).nb.push(e);
      this.byId.get(e.t).nb.push(e);
    }

    // Stars: every anchored path and its folders, up to the root (the whole project).
    const hubs = new Map();
    const hub = (path) => {
      if (hubs.has(path)) return hubs.get(path);
      const h = {
        key: "h:" + path,
        path,
        isHub: true,
        root: path === "",
        label: path === "" ? `${g.name || "proyecto"} · todo` : path.split("/").pop(),
        depth: path === "" ? 0 : path.split("/").length,
        members: [],
        children: [],
        parent: null,
        fileInfo: null,
      };
      hubs.set(path, h);
      if (path !== "") {
        const p = hub(parentOf(path));
        h.parent = p;
        p.children.push(h);
      }
      return h;
    };
    hub("");
    for (const n of nodes) {
      const h = hub(n.p || "");
      n.hub = h.key;
      h.members.push(n);
    }
    // Include all indexed files in the sky tree layout (union of memory and code)
    if (this.code && this.code.files) {
      for (const f of this.code.files) {
        const h = hub(f.path);
        h.fileInfo = f;
      }
    }
    // Weight = memories + files in the subtree: stable radial placement
    const weigh = (h) => (h.weight = h.members.length + (h.fileInfo ? 1 : 0) + h.children.reduce((s, c) => s + weigh(c), 0) || 1);
    const root = hubs.get("");
    weigh(root);
    const place = (h, a0, a1) => {
      h.theta = (a0 + a1) / 2;
      h.targetR = h.depth * LEVEL_R;
      h.layer = -h.depth * 34;
      const kids = h.children.slice().sort((a, b) => a.path.localeCompare(b.path));
      const total = kids.reduce((s, c) => s + c.weight, 0) || 1;
      let a = a0;
      for (const c of kids) {
        const span = ((a1 - a0) * c.weight) / total;
        place(c, a, a + span);
        a += span;
      }
    };
    place(root, -Math.PI, Math.PI);
    this.hubs = hubs;
    this.byKey = new Map([...hubs.values()].map((h) => [h.key, h]));
    this.maxDepth = Math.max(...[...hubs.values()].map((h) => h.depth));
    this.extent = Math.max(LEVEL_R, this.maxDepth * LEVEL_R);

    // Time: rank among all memories, so the oldest sit low and the newest float high.
    const ys = [...new Set(nodes.map((n) => n.y))].sort((a, b) => a - b);
    const rank = new Map(ys.map((y, i) => [y, ys.length > 1 ? i / (ys.length - 1) : 1]));

    const rand = rng(7);
    this.bodies = [];
    for (const h of hubs.values()) {
      Object.assign(h, { x: Math.cos(h.theta) * h.targetR, y3: h.layer, z3: Math.sin(h.theta) * h.targetR, vx: 0, vy: 0, vz: 0 });
      h.charge = h.root ? 4200 : 2200;
      this.bodies.push(h);
    }
    for (const n of nodes) {
      const h = this.byKey.get(n.hub);
      n.u = n.vis ? (n.z + 1) / 2 : 0;
      n.t01 = rank.get(n.y);
      n.home = h.layer + 50 + TIME_SPAN * n.t01;
      const p = prev.get(n.key);
      if (p) Object.assign(n, { x: p.x, y3: p.y3, z3: p.z3, born: p.born });
      else {
        const a = rand() * Math.PI * 2, r = 40 + 130 * (1 - n.u) + rand() * 30;
        Object.assign(n, { x: h.x + Math.cos(a) * r, y3: n.home, z3: h.z3 + Math.sin(a) * r, born: performance.now() });
      }
      n.vx = n.vy = n.vz = 0;
      n.charge = 380 + 520 * n.u;
      this.bodies.push(n);
    }

    this.links = [];
    for (const h of hubs.values()) if (h.parent) this.links.push({ a: h.parent, b: h, kind: "tree" });
    for (const n of nodes) {
      const u = n.u;
      this.links.push({ a: n, b: this.byKey.get(n.hub), kind: "leaf", rest: 38 + 150 * (1 - u), k: 0.002 + 0.07 * Math.pow(u, 1.5) });
    }

    if (this.selected) this.selected = this.byId.get(this.selected.id) || null;
    const switched = this.viewKey !== viewKey;
    this.viewKey = viewKey;
    this.alpha = prev.size && !switched ? Math.max(this.alpha, 0.5) : 1;
    if (switched) this.resetCamera(!prev.size);
  }

  _nodeShown(n) {
    if (this.opts.hiddenKinds.has(n.k)) return false;
    if (this.opts.coreOnly && !n.core) return false;
    if (n.pot && !this.opts.showPlans) return false;
    if (!this.opts.showStale && (n.stale || (n.vis && n.z <= -0.75))) return false;
    return true;
  }

  _hasMemShown(h) {
    return h.members.some((n) => this._nodeShown(n)) || h.children.some((c) => this._hasMemShown(c));
  }

  _hasCode(h) {
    return !!h.fileInfo || h.children.some((c) => this._hasCode(c));
  }

  _shown(b) {
    if (!b.isHub) {
      if (!this.opts.layers.memory) return false;
      return this._nodeShown(b);
    }
    if (b.root) return true;
    const hasMem = this.opts.layers.memory && this._hasMemShown(b);
    const hasCode = this.opts.layers.code && this._hasCode(b);
    return hasMem || hasCode;
  }

  setRuleReach(n) {
    if (!n) {
      this.reachHubs = null;
      this.reachAnchored = null;
      return;
    }
    const anchor = n.p || "";
    const anchored = new Set();
    for (const h of this.hubs.values()) {
      if (h.root && anchor === "") anchored.add("");
      else if (anchor !== "" && (h.path === anchor || h.path.startsWith(anchor + "/"))) {
        anchored.add(h.path);
      }
    }
    const neighbors = new Set();
    if (this.code && this.code.imports) {
      for (const imp of this.code.imports) {
        if (anchored.has(imp.from)) neighbors.add(imp.to);
        if (anchored.has(imp.to)) neighbors.add(imp.from);
      }
    }
    this.reachAnchored = anchored;
    this.reachHubs = new Set([...anchored, ...neighbors]);
  }

  refresh() {
    this.alpha = Math.max(this.alpha, 0.4);
  }

  stats() {
    const shown = this.bodies.filter((b) => !b.isHub && this._shown(b));
    const vis = shown.filter((n) => n.vis);
    const mean = vis.length ? vis.reduce((s, n) => s + n.z, 0) / vis.length : 0;
    return {
      shown: shown.length,
      total: this.byId.size,
      core: shown.filter((n) => n.core).length,
      stars: [...this.hubs.values()].filter((h) => this._shown(h)).length,
      chi: mean,
    };
  }

  // ───────────── physics ─────────────
  _step() {
    const a = this.alpha;
    const act = this.bodies.filter((b) => this._shown(b));
    const n = act.length;
    const CUT = 320 * 320;
    for (let i = 0; i < n; i++) {
      const p = act[i];
      for (let j = i + 1; j < n; j++) {
        const q = act[j];
        const dx = p.x - q.x, dy = p.y3 - q.y3, dz = p.z3 - q.z3;
        const d2 = dx * dx + dy * dy + dz * dz + 30;
        if (d2 > CUT) continue;
        const f = (a * Math.sqrt(p.charge * q.charge)) / d2;
        const inv = 1 / Math.sqrt(d2);
        const fx = dx * inv * f, fy = dy * inv * f * 0.3, fz = dz * inv * f;
        p.vx += fx; p.vy += fy; p.vz += fz;
        q.vx -= fx; q.vy -= fy; q.vz -= fz;
      }
    }
    for (const l of this.links) {
      if (l.kind !== "leaf" || !this._shown(l.a)) continue;
      const dx = l.b.x - l.a.x, dz = l.b.z3 - l.a.z3;
      const d = Math.sqrt(dx * dx + dz * dz) || 1;
      const f = (l.k * (d - l.rest) * a) / d;
      l.a.vx += dx * f; l.a.vz += dz * f;
    }
    for (const b of act) {
      if (b.isHub) {
        // Stars are pinned to the tree; they only glide there when the view changes.
        const hx = Math.cos(b.theta) * b.targetR, hz = Math.sin(b.theta) * b.targetR;
        b.x += (hx - b.x) * 0.12; b.y3 += (b.layer - b.y3) * 0.12; b.z3 += (hz - b.z3) * 0.12;
        b.vx = b.vy = b.vz = 0;
        continue;
      }
      b.vy += (b.home - b.y3) * 0.04 * a; // height is time
      b.vx *= 0.62; b.vy *= 0.62; b.vz *= 0.62;
      b.x += b.vx; b.y3 += b.vy; b.z3 += b.vz;
    }
    this.alpha = Math.max(0.025, a * 0.988);
  }

  // ───────────── camera ─────────────
  _project(x, y, z) {
    const c = this.cam;
    x -= c.tx; y -= c.ty; z -= c.tz;
    const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    const rx = x * cy - z * sy;
    let rz = x * sy + z * cy;
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const ry = y * cp - rz * sp;
    rz = y * sp + rz * cp;
    const depth = rz + c.dist;
    if (depth < 30) return null;
    const f = Math.min(this.w, this.h) * 1.25;
    const s = f / depth;
    return { x: this.w / 2 + rx * s, y: this.h / 2 - ry * s, s, d: depth };
  }

  _resize() {
    const r = this.c.getBoundingClientRect();
    this.w = Math.max(10, r.width);
    this.h = Math.max(10, r.height);
    this.c.width = Math.round(this.w * this.dpr);
    this.c.height = Math.round(this.h * this.dpr);
  }

  _bind() {
    let drag = null;
    this.c.addEventListener("contextmenu", (e) => e.preventDefault());
    this.c.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey, moved: 0 };
      this.c.setPointerCapture(e.pointerId);
      this.c.classList.add("drag");
    });
    this.c.addEventListener("pointermove", (e) => {
      const r = this.c.getBoundingClientRect();
      this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) {
        const k = this.cam.dist / 900;
        const cy = Math.cos(this.cam.yaw), sy = Math.sin(this.cam.yaw);
        const cp = Math.cos(this.cam.pitch), sp = Math.sin(this.cam.pitch);
        this.cam.tx -= (dx * cy + dy * sy * sp) * k;
        this.cam.ty += dy * cp * k;
        this.cam.tz -= (-dx * sy + dy * cy * sp) * k;
      } else {
        const up = Math.cos(this.cam.pitch) >= 0 ? 1 : -1;
        this.cam.yaw += dx * 0.006 * up;
        this.cam.pitch += dy * 0.005;
      }
    });
    this.c.addEventListener("pointerup", () => {
      if (drag && drag.moved < 5) {
        if (this.hover && this.hover.isHub && this.hover.fileInfo) {
          this.selectedFile = this.hover;
          this.selected = null;
          this.setRuleReach(null);
          this.onSelectFile(this.hover);
        } else if (this.hover && !this.hover.isHub) {
          this.selected = this.hover;
          this.selectedFile = null;
          this.setRuleReach(this.selected);
          this.onSelect(this.selected);
        } else {
          if (this.hover && this.hover.isHub) this.focus(this.hover);
          this.selected = null;
          this.selectedFile = null;
          this.setRuleReach(null);
          this.onSelect(null);
          this.onSelectFile(null);
        }
      }
      drag = null;
      this.c.classList.remove("drag");
    });
    this.c.addEventListener("pointerleave", () => { this.mouse = null; });
    this.c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.cam.dist = Math.max(220, Math.min(4200, this.cam.dist * Math.exp(e.deltaY * 0.0012)));
    }, { passive: false });
    this.c.addEventListener("dblclick", () => { if (this.hover) this.focus(this.hover); });
  }

  _normAngle(a) {
    const tau = Math.PI * 2;
    return ((((a + Math.PI) % tau) + tau) % tau) - Math.PI;
  }

  focus(b) {
    this.cam.yaw = this._normAngle(this.cam.yaw);
    this.cam.pitch = this._normAngle(this.cam.pitch);
    this.anim = { from: { ...this.cam }, to: { ...this.cam, tx: b.x, ty: b.y3, tz: b.z3, dist: Math.min(this.cam.dist, 650) }, t0: performance.now() };
  }

  select(id, focus = true) {
    const n = this.byId.get(id);
    if (!n) return;
    this.selected = n;
    if (focus) this.focus(n);
    this.onSelect(n);
  }

  resetCamera(instant = false) {
    const ext = this.extent || 600;
    this.cam.yaw = this._normAngle(this.cam.yaw);
    this.cam.pitch = this._normAngle(this.cam.pitch);
    const to = { yaw: 0.55, pitch: 0.62, dist: 700 + ext * 1.9, tx: 0, ty: TIME_SPAN * 0.35, tz: 0 };
    if (instant) Object.assign(this.cam, to);
    else this.anim = { from: { ...this.cam }, to, t0: performance.now() };
  }

  // ───────────── sky ─────────────
  _makeSky() {
    const rand = rng(1311);
    this.stars = [];
    for (let i = 0; i < 520; i++) {
      const u = rand() * 2 - 1, th = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      this.stars.push({ x: r * Math.cos(th), y: u, z: r * Math.sin(th), m: rand() < 0.08 ? 1.6 : 0.4 + rand() * 0.8, ph: rand() * 6.28, sp: 0.5 + rand() * 2 });
    }
    // Decorative constellations: short chains of nearby stars.
    this.figures = [];
    for (let f = 0; f < 9; f++) {
      let cur = Math.floor(rand() * this.stars.length);
      const chain = [cur];
      for (let k = 0; k < 3 + Math.floor(rand() * 3); k++) {
        const s = this.stars[cur];
        let best = -1, bd = 1e9;
        this.stars.forEach((o, j) => {
          if (chain.includes(j)) return;
          const d = (o.x - s.x) ** 2 + (o.y - s.y) ** 2 + (o.z - s.z) ** 2;
          if (d < bd && d > 0.004) { bd = d; best = j; }
        });
        if (best < 0) break;
        chain.push(best);
        cur = best;
      }
      this.figures.push(chain);
    }
  }

  _skyPoint(s) {
    const c = this.cam;
    const cy = Math.cos(c.yaw * 0.35), sy = Math.sin(c.yaw * 0.35);
    const rx = s.x * cy - s.z * sy;
    let rz = s.x * sy + s.z * cy;
    const cp = Math.cos(c.pitch * 0.35), sp = Math.sin(c.pitch * 0.35);
    const ry = s.y * cp - rz * sp;
    rz = s.y * sp + rz * cp;
    if (rz < 0.15) return null;
    const f = Math.max(this.w, this.h) * 0.8;
    return { x: this.w / 2 + (rx / rz) * f, y: this.h / 2 - (ry / rz) * f };
  }

  _drawSky(g, t) {
    const pts = this.stars.map((s) => this._skyPoint(s));
    g.lineWidth = 0.7;
    g.strokeStyle = "rgba(120,150,220,0.13)";
    for (const ch of this.figures) {
      g.beginPath();
      let started = false;
      for (const i of ch) {
        const p = pts[i];
        if (!p) { started = false; continue; }
        if (!started) { g.moveTo(p.x, p.y); started = true; } else g.lineTo(p.x, p.y);
      }
      g.stroke();
    }
    this.stars.forEach((s, i) => {
      const p = pts[i];
      if (!p || p.x < -5 || p.y < -5 || p.x > this.w + 5 || p.y > this.h + 5) return;
      const tw = 0.55 + 0.45 * Math.sin(t * 0.001 * s.sp + s.ph);
      g.fillStyle = `rgba(200,215,255,${0.25 + 0.5 * tw * (s.m / 2)})`;
      g.fillRect(p.x, p.y, s.m, s.m);
    });
  }

  _ring(g, r, y, alpha, label) {
    g.beginPath();
    let first = true;
    const lp = label ? this._project(r * 0.71, y, r * 0.71) : null;
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const p = this._project(Math.cos(a) * r, y, Math.sin(a) * r);
      if (!p) { first = true; continue; }
      if (first) { g.moveTo(p.x, p.y); first = false; } else g.lineTo(p.x, p.y);
    }
    g.setLineDash([6, 8]);
    g.strokeStyle = `rgba(120,140,190,${alpha})`;
    g.lineWidth = 1;
    g.stroke();
    g.setLineDash([]);
    if (label && lp) {
      g.font = '10px "Cascadia Mono", Consolas, monospace';
      g.fillStyle = `rgba(150,165,210,${Math.min(0.8, alpha * 5)})`;
      g.fillText(label, lp.x + 8, lp.y + 16);
    }
  }

  // ───────────── render ─────────────
  _color(n) {
    if (this.opts.color === "chi") return n.vis ? chiColor(n.z) : "#5a606a";
    if (this.opts.color === "origin") return ORIGIN_COLORS[n.o] || "#999";
    return KIND_COLORS[n.k] || "#999";
  }

  _matches(b) {
    const q = this.opts.search;
    if (!q) return false;
    if (b.isHub) return b.path.toLowerCase().includes(q);
    return b.l.toLowerCase().includes(q) || b.t.toLowerCase().includes(q) || (b.p || "").toLowerCase().includes(q);
  }

  _frame(t) {
    requestAnimationFrame((tt) => this._frame(tt));
    if (this.anim) {
      const u = Math.min(1, (t - this.anim.t0) / 650);
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      for (const k of ["yaw", "pitch", "dist", "tx", "ty", "tz"]) this.cam[k] = this.anim.from[k] + (this.anim.to[k] - this.anim.from[k]) * e;
      if (u >= 1) this.anim = null;
    } else if (this.opts.autorotate) this.cam.yaw += 0.0012;
    if (this.bodies.length) {
      this._step();
      if (this.alpha > 0.3) this._step();
    }

    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    this._drawSky(g, t);
    if (!this.bodies.length) return;

    // One dashed ring per level of the tree.
    for (let d = 1; d <= this.maxDepth; d++) this._ring(g, d * LEVEL_R, -d * 34, 0.1, `nivel ${d}`);

    const proj = new Map();
    for (const b of this.bodies) {
      if (!this._shown(b)) continue;
      const p = this._project(b.x, b.y3, b.z3);
      if (p) proj.set(b, p);
    }
    const sel = this.selected;
    const near = new Set();
    if (sel) {
      near.add(sel.id);
      for (const e of sel.nb) { near.add(e.f); near.add(e.t); }
    }
    const dimmed = (b) => sel && !b.isHub && !near.has(b.id);
    const searching = !!this.opts.search;

    // Constellation lines: each star to its parent folder.
    for (const l of this.links) {
      if (l.kind !== "tree") continue;
      const a = proj.get(l.a), b = proj.get(l.b);
      if (!a || !b) continue;
      g.strokeStyle = "rgba(150,175,255,0.5)";
      g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }

    // Branches: memory → its star. χ is read in the line.
    for (const l of this.links) {
      if (l.kind !== "leaf") continue;
      const n = l.a;
      const a = proj.get(n), b = proj.get(l.b);
      if (!a || !b) continue;
      const u = n.u;
      let al = 0.04 + 0.5 * Math.pow(u, 1.3);
      if (sel) al *= near.has(n.id) ? 2.2 : 0.2;
      if (searching && !this._matches(n)) al *= 0.3;
      const [r, gg, bb] = rgbOf(this._color(n));
      g.strokeStyle = `rgba(${r},${gg},${bb},${Math.min(1, al)})`;
      g.lineWidth = 0.4 + 1.4 * u;
      g.setLineDash(n.vis && n.z < 0 ? [2, 4] : []);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    g.setLineDash([]);

    // Import edges: fine lines between files
    if (this.opts.layers.imports && this.code && this.code.imports) {
      for (const imp of this.code.imports) {
        const A = this.hubs.get(imp.from), B = this.hubs.get(imp.to);
        if (!A || !B) continue;
        const a = proj.get(A), b = proj.get(B);
        if (!a || !b) continue;
        const touchesReach = this.reachHubs && (this.reachHubs.has(imp.from) && this.reachHubs.has(imp.to));
        let al = touchesReach ? 0.95 : (this.reachHubs ? 0.08 : 0.35);
        g.strokeStyle = touchesReach ? "rgba(95, 215, 255, 0.95)" : `rgba(80, 180, 220, ${al})`;
        g.lineWidth = touchesReach ? 1.8 : 0.8;
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
    }

    // Call edges: thickness proportional to call count
    if (this.opts.layers.calls && this.code && this.code.calls) {
      for (const call of this.code.calls) {
        const A = this.hubs.get(call.from), B = this.hubs.get(call.to);
        if (!A || !B) continue;
        const a = proj.get(A), b = proj.get(B);
        if (!a || !b) continue;
        const al = this.reachHubs ? 0.1 : 0.55;
        g.strokeStyle = `rgba(176, 122, 217, ${al})`;
        const width = Math.min(5.0, 0.8 + Math.log2(call.count + 1) * 0.9);
        g.lineWidth = width;
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
    }

    // Cross edges (causes, contradictions, replacements) on demand or around the selection.
    for (const e of this.edges) {
      const st = EDGE_STYLE[e.k];
      const touches = sel && (e.f === sel.id || e.t === sel.id);
      if (!st || (!this.opts.edges[e.k] && !touches)) continue;
      const A = this.byId.get(e.f), B = this.byId.get(e.t);
      const a = proj.get(A), b = proj.get(B);
      if (!a || !b) continue;
      const al = touches ? 0.8 : 0.25 * (0.4 + 0.6 * Math.min(A.u, B.u));
      g.strokeStyle = `rgba(${st.color[0]},${st.color[1]},${st.color[2]},${al})`;
      g.lineWidth = touches ? 1.5 : 0.9;
      g.setLineDash(st.dash || []);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    g.setLineDash([]);

    // Bodies, back to front.
    const order = [...proj.entries()].sort((a, b) => b[1].d - a[1].d);
    const now = performance.now();
    const labels = [];
    let hover = null, hoverD = 1e9;
    const m = this.mouse;
    for (const [b, p] of order) {
      const r = b.isHub ? this._drawHub(g, b, p, now, searching && this._matches(b)) : this._drawNode(g, b, p, now, dimmed(b), searching && !this._matches(b));
      if (m) {
        const d = Math.hypot(m.x - p.x, m.y - p.y);
        if (d < Math.max(r + 4, 7) && d < hoverD) { hover = b; hoverD = d; }
      }
      let prio = 0;
      if (b.isHub) prio = b.root ? 1500 : searching && this._matches(b) ? 1800 : 900 - b.depth * 120;
      else if (sel === b) prio = 3000;
      else if (searching && this._matches(b)) prio = 2000;
      else if (sel && near.has(b.id)) prio = 1200;
      else if (b.core && b.u > 0.55) prio = 330 * p.s;
      else if (p.s > 1.5 && b.u > 0.3) prio = 80 * p.s;
      if (prio > 0) labels.push({ b, p, r, prio });
    }
    if (hover) labels.push({ b: hover, p: proj.get(hover), r: 6, prio: 2900 });
    this._drawLabels(g, labels);
    this.hover = hover;
    this._tooltip(hover);
  }

  _drawHub(g, h, p, now, matched) {
    if (h.root) {
      const pul = 0.5 + 0.5 * Math.sin(now * 0.0016);
      const R = 11 * Math.max(0.7, p.s * 1.1);
      const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, R * 6);
      gr.addColorStop(0, "rgba(255,255,255,0.55)");
      gr.addColorStop(0.25, "rgba(200,215,255,0.18)");
      gr.addColorStop(1, "rgba(200,215,255,0)");
      g.fillStyle = gr;
      g.beginPath(); g.arc(p.x, p.y, R * 6, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 2; i++) {
        g.strokeStyle = `rgba(215,56,63,${0.35 * (1 - ((pul + i * 0.5) % 1))})`;
        g.lineWidth = 1;
        g.beginPath(); g.arc(p.x, p.y, R * (1.6 + 2.2 * ((pul + i * 0.5) % 1)), 0, Math.PI * 2); g.stroke();
      }
      this._sparkle(g, p.x, p.y, R * 1.7, "rgba(255,255,255,0.95)");
      g.fillStyle = "#fff";
      g.beginPath(); g.arc(p.x, p.y, R * 0.55, 0, Math.PI * 2); g.fill();
      return R;
    }
    if (h.fileInfo) {
      if (!this.opts.layers.code) return 0;
      const isReach = this.reachHubs && this.reachHubs.has(h.path);
      const isAnchored = this.reachAnchored && this.reachAnchored.has(h.path);
      const isNeighbor = this.reachHubs && !isAnchored && this.reachHubs.has(h.path);
      const isSelected = this.selectedFile && this.selectedFile.path === h.path;
      const hasRules = h.fileInfo.rules && h.fileInfo.rules.length > 0;
      const isError = h.fileInfo.status === "error";

      let al = this.reachHubs ? (isAnchored ? 1.0 : (isNeighbor ? 0.9 : 0.12)) : (hasRules ? 0.95 : 0.45);
      if (matched) al = 1.0;

      const R = (isAnchored ? 6.5 : (hasRules ? 5.2 : 3.4)) * Math.max(0.6, p.s * 1.1);

      const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, R * 4);
      if (isError) {
        gr.addColorStop(0, `rgba(255, 107, 107, ${0.45 * al})`);
        gr.addColorStop(1, "rgba(255, 107, 107, 0)");
      } else if (isAnchored) {
        gr.addColorStop(0, `rgba(240, 180, 76, ${0.5 * al})`);
        gr.addColorStop(1, "rgba(240, 180, 76, 0)");
      } else if (isNeighbor) {
        gr.addColorStop(0, `rgba(95, 179, 217, ${0.45 * al})`);
        gr.addColorStop(1, "rgba(95, 179, 217, 0)");
      } else if (hasRules) {
        gr.addColorStop(0, `rgba(160, 200, 255, ${0.35 * al})`);
        gr.addColorStop(1, "rgba(160, 200, 255, 0)");
      } else {
        gr.addColorStop(0, `rgba(140, 160, 200, ${0.18 * al})`);
        gr.addColorStop(1, "rgba(140, 160, 200, 0)");
      }
      g.fillStyle = gr;
      g.beginPath(); g.arc(p.x, p.y, R * 4, 0, Math.PI * 2); g.fill();

      if (hasRules || isAnchored || isNeighbor) {
        const col = isError ? "rgba(255, 107, 107, 1)" : isAnchored ? "rgba(240, 180, 76, 1)" : isNeighbor ? "rgba(95, 179, 217, 1)" : `rgba(215, 230, 255, ${al})`;
        this._sparkle(g, p.x, p.y, R * 1.5, col);
      } else {
        g.fillStyle = isError ? "#ff6b6b" : `rgba(180, 195, 225, ${al})`;
        g.beginPath(); g.arc(p.x, p.y, R * 0.7, 0, Math.PI * 2); g.fill();
      }

      if (isError) {
        g.fillStyle = "#ff6b6b";
        g.font = `bold ${Math.max(10, Math.round(R * 1.6))}px sans-serif`;
        g.fillText("!", p.x + R + 1, p.y - 1);
      }

      if (isSelected) {
        g.strokeStyle = "#fff";
        g.lineWidth = 1.4;
        g.beginPath(); g.arc(p.x, p.y, R + 4, 0, Math.PI * 2); g.stroke();
      }

      return R;
    }
    const own = h.members.length > 0;
    const R = (own ? 5 : 3.6) * Math.max(0.6, p.s * 1.1);
    const al = matched ? 1 : own ? 0.95 : 0.55;
    const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, R * 4);
    gr.addColorStop(0, `rgba(170,190,255,${0.35 * al})`);
    gr.addColorStop(1, "rgba(170,190,255,0)");
    g.fillStyle = gr;
    g.beginPath(); g.arc(p.x, p.y, R * 4, 0, Math.PI * 2); g.fill();
    this._sparkle(g, p.x, p.y, R * 1.6, matched ? "rgba(255,230,160,1)" : `rgba(215,225,255,${al})`);
    return R;
  }

  _sparkle(g, x, y, r, col) {
    g.fillStyle = col;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const rr = i % 2 === 0 ? r : r * 0.22;
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
  }

  _drawNode(g, n, p, now, dim, unmatched) {
    const u = n.u;
    const grow = Math.min(1, (now - (n.born || 0)) / 700);
    let r = (KIND_RADIUS[n.k] || 4) * (0.5 + 0.7 * u) * Math.max(0.45, p.s * 1.05) * (0.3 + 0.7 * grow);
    if (n.core) r *= 1.15;
    let al = n.vis ? 0.1 + 0.9 * Math.pow(u, 1.2) : 0.07;
    if (dim) al *= 0.25;
    if (unmatched) al *= 0.25;
    const [cr, cg, cb] = rgbOf(this._color(n));
    if (u > 0.55 && n.vis) {
      const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4);
      gr.addColorStop(0, `rgba(${cr},${cg},${cb},${0.32 * al * u})`);
      gr.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      g.fillStyle = gr;
      g.beginPath(); g.arc(p.x, p.y, r * 4, 0, Math.PI * 2); g.fill();
    }
    g.beginPath();
    g.arc(p.x, p.y, r, 0, Math.PI * 2);
    if (u < 0.3 || !n.vis) {
      // Translucent: a faint hollow speck for what nothing supports.
      g.fillStyle = `rgba(${cr},${cg},${cb},${al * 0.35})`;
      g.fill();
      g.strokeStyle = `rgba(${cr},${cg},${cb},${al})`;
      g.lineWidth = 0.8;
      g.stroke();
    } else {
      g.fillStyle = `rgba(${cr},${cg},${cb},${al})`;
      g.fill();
      if (n.anch) {
        g.fillStyle = `rgba(255,255,255,${0.8 * al})`;
        g.beginPath(); g.arc(p.x, p.y, Math.max(0.8, r * 0.35), 0, Math.PI * 2); g.fill();
      }
    }
    if (n.cons) {
      g.strokeStyle = `rgba(240,180,76,${al})`;
      g.lineWidth = 1.2;
      g.beginPath(); g.arc(p.x, p.y, r + 2.5, 0, Math.PI * 2); g.stroke();
    }
    if (n.stale) {
      // Obsolete: crossed out until verify sees the repo match it again.
      g.strokeStyle = `rgba(215,56,63,${Math.max(0.4, al)})`;
      g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(p.x - r - 2, p.y - r - 2); g.lineTo(p.x + r + 2, p.y + r + 2); g.stroke();
    }
    if (n.core && !dim) this._sparkle(g, p.x, p.y, r * 2.2, `rgba(${cr},${cg},${cb},${0.55 * Math.max(al, 0.4)})`);
    if (this.selected === n) {
      g.strokeStyle = "#fff";
      g.lineWidth = 1.4;
      g.beginPath(); g.arc(p.x, p.y, r + 5, 0, Math.PI * 2); g.stroke();
    }
    return r;
  }

  _drawLabels(g, labels) {
    labels.sort((a, b) => b.prio - a.prio);
    const placed = [];
    let count = 0;
    for (const L of labels) {
      if (count > 70) break;
      const b = L.b;
      const isHub = b.isHub;
      const raw = isHub ? b.label : b.l;
      const text = raw.length > 42 ? raw.slice(0, 41) + "…" : raw;
      const size = b.root ? 13 : 10.5;
      g.font = `${b.root ? 600 : isHub ? 500 : 400} ${size}px "Segoe UI", system-ui, sans-serif`;
      const w = g.measureText(text).width;
      const x = L.p.x + L.r + 5, y = L.p.y + 4;
      const rect = [x - 2, y - size, x + w + 2, y + 4];
      if (L.prio < 2500 && placed.some((q) => rect[0] < q[2] && rect[2] > q[0] && rect[1] < q[3] && rect[3] > q[1])) continue;
      placed.push(rect);
      count++;
      if (isHub) g.fillStyle = b.root ? "rgba(255,255,255,0.95)" : "rgba(175,195,255,0.85)";
      else g.fillStyle = `rgba(230,226,218,${0.35 + 0.6 * Math.max(b.u, L.prio > 1000 ? 1 : 0)})`;
      g.fillText(text, x, y);
    }
  }

  _tooltip(b) {
    const tt = this.tooltip;
    if (!b || !this.mouse) { tt.classList.add("hidden"); return; }
    tt.classList.remove("hidden");
    tt.style.left = this.mouse.x + "px";
    tt.style.top = this.mouse.y + "px";
    tt.innerHTML = "";
    if (b.isHub) {
      tt.append(b.root ? "todo el proyecto (reglas sin ruta)" : b.path);
      const s = document.createElement("b");
      if (b.fileInfo) {
        const sym = b.fileInfo.symbols;
        const rCount = b.fileInfo.rules.length;
        s.textContent = `${b.fileInfo.lang} · ${sym} símbolo${sym === 1 ? "" : "s"} · ${rCount} regla${rCount === 1 ? "" : "s"}${b.fileInfo.status === "error" ? " · [error escaneo]" : ""}`;
        s.style.color = b.fileInfo.status === "error" ? "#ff6b6b" : "rgba(175,195,255,0.9)";
      } else {
        const n = b.members.filter((m) => this._nodeShown(m)).length;
        s.textContent = `${n} recuerdo${n === 1 ? "" : "s"} aquí`;
        s.style.color = "rgba(175,195,255,0.9)";
      }
      tt.append(s);
      return;
    }
    tt.append(b.l);
    const s = document.createElement("b");
    s.textContent = b.vis ? `χ ${b.z >= 0 ? "+" : ""}${b.z.toFixed(2)} · ${b.tag}` : b.pot ? "plan · aún no ocurre" : "fuera de esta vista";
    s.style.color = b.vis ? chiColor(b.z) : "#8b919b";
    tt.append(s);
  }
}

window.View3D = View3D;
window.KIND_COLORS = KIND_COLORS;
window.KIND_LABELS = KIND_LABELS;
window.ORIGIN_COLORS = ORIGIN_COLORS;
window.EDGE_STYLE = EDGE_STYLE;
window.chiColor = chiColor;
