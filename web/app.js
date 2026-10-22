// Memoria 3D: abre la memoria de cualquier repo, fíltrala y explica cada recuerdo.
"use strict";

const $ = (id) => document.getElementById(id);
const view = new View3D($("view"), $("tooltip"));
let memories = [];
let current = null;
let graph = null;
let code = null;
let lastCodeMtime = null;

let layers = { memory: true, code: true, imports: true, calls: false };
try {
  const saved = localStorage.getItem("memviz_layers");
  if (saved) layers = Object.assign(layers, JSON.parse(saved));
} catch (e) {}

function saveLayers() {
  try {
    localStorage.setItem("memviz_layers", JSON.stringify(layers));
  } catch (e) {}
}

/// The page re-reads the memory this often: the hooks keep writing it while you work.
const REFRESH_MS = 15000;

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  const v = await r.json();
  if (!r.ok) throw new Error(v.error || r.statusText);
  return v;
}

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of kids) e.append(k);
  return e;
}

// ───────────── tabs ─────────────
async function loadTabs(select) {
  memories = await getJSON("/api/memories");
  const nav = $("memories");
  nav.innerHTML = "";
  for (const m of memories) {
    const x = el("span", { class: "x", title: "cerrar" }, "×");
    x.addEventListener("click", (e) => { e.stopPropagation(); closeTab(m.id); });
    const b = el("button", { type: "button", title: `${m.file}`, onclick: () => open(m.id) }, m.label, el("small", {}, m.scope), x);
    b.dataset.id = m.id;
    nav.append(b);
  }
  const target = select && memories.some((m) => m.id === select) ? select : current && memories.some((m) => m.id === current) ? current : memories[0] && memories[0].id;
  if (target) open(target);
  else clearView();
}

function clearView() {
  current = null;
  graph = { name: "", nodes: [], edges: [], hyper: [] };
  code = null;
  lastCodeMtime = null;
  view.setGraph(graph, null, "none");
  view.selected = null;
  view.selectedFile = null;
  view.setRuleReach(null);
  showInfo(null);
  $("filePanel").classList.add("hidden");
  $("indexNotice").classList.add("hidden");
  renderKinds();
  renderStats();
  $("source").textContent = "";
  showEmpty("Ninguna memoria abierta.", true);
}

async function closeTab(id) {
  await getJSON(`/api/close?m=${encodeURIComponent(id)}`);
  if (current === id) current = null;
  loadTabs();
}

function showEmpty(msg, offerOpen = false) {
  const box = $("empty");
  box.innerHTML = "";
  if (msg) {
    const inner = el("div", {}, msg);
    if (offerOpen) inner.append(el("br"), el("button", { type: "button", onclick: openFinder }, "＋ Abrir repo"));
    box.append(inner);
  }
  box.classList.toggle("hidden", !msg);
}

async function open(id, keepView = false) {
  try {
    graph = await getJSON(`/api/graph?m=${encodeURIComponent(id)}`);
  } catch (e) {
    showEmpty(`No se pudo leer la memoria: ${e.message}`);
    return;
  }
  try {
    code = await getJSON(`/api/code?m=${encodeURIComponent(id)}`);
    lastCodeMtime = code.mtime;
  } catch (e) {
    code = { files: [], imports: [], calls: [], notice: "sin índice: ejecuta `cthg index` en el repo", mtime: 0 };
    lastCodeMtime = 0;
  }

  // Por defecto: Memoria activa; Código e Importaciones activas solo si hay índice; Llamadas apagada.
  const hasSavedLayers = (() => {
    try { return localStorage.getItem("memviz_layers") !== null; } catch (e) { return false; }
  })();
  if (!hasSavedLayers) {
    const hasIndex = code && code.files && code.files.length > 0;
    layers.memory = true;
    layers.code = !!hasIndex;
    layers.imports = !!hasIndex;
    layers.calls = false;
    saveLayers();
  }

  view.opts.layers = Object.assign({}, layers);
  syncLayerToggles();
  updateIndexNotice();

  current = id;
  for (const b of $("memories").children) b.classList.toggle("active", b.dataset.id === id);
  $("source").textContent = graph.source;
  $("source").title = graph.source;
  showEmpty(graph.nodes.length ? "" : "Esta memoria está vacía todavía: lo que se aprenda con `cthg learn` aparecerá aquí.");
  view.setGraph(graph, code, keepView ? view.viewKey : id);
  renderKinds();
  renderStats();
  if (view.selected) showInfo(view.selected);
  else if (view.selectedFile) showFileMap(view.selectedFile.path);
}

// ───────────── repo finder ─────────────
let repos = [];
let finderSel = 0;
let finderPoll = null;

const fold = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

async function openFinder() {
  $("finder").classList.remove("hidden");
  $("finderError").classList.add("hidden");
  $("repoSearch").value = "";
  finderSel = 0;
  $("repoSearch").focus();
  await refreshRepos();
}

function closeFinder() {
  $("finder").classList.add("hidden");
  clearTimeout(finderPoll);
}

async function refreshRepos() {
  const r = await getJSON("/api/repos");
  repos = r.repos;
  const withMemory = repos.filter((x) => x.memory).length;
  $("finderStatus").textContent = r.scanning
    ? `buscando repos… ${repos.length} hasta ahora`
    : `${repos.length} repos · ${withMemory} con memoria`;
  renderRepos();
  clearTimeout(finderPoll);
  if (r.scanning && !$("finder").classList.contains("hidden")) finderPoll = setTimeout(refreshRepos, 800);
}

function filteredRepos() {
  const words = fold($("repoSearch").value).split(/\s+/).filter(Boolean);
  const list = repos.filter((r) => words.every((w) => fold(r.name + " " + r.path).includes(w)));
  // Memories first, then the rest; recent ones keep their order on top.
  return list.sort((a, b) => (b.recent - a.recent) || (b.memory - a.memory));
}

function renderRepos() {
  const box = $("repoList");
  box.innerHTML = "";
  const list = filteredRepos();
  finderSel = Math.min(finderSel, Math.max(0, list.length - 1));
  if (!list.length) {
    box.append(el("div", { class: "repo-empty" }, repos.length ? "Nada coincide. Prueba con «Elegir carpeta…»." : "Todavía no hay repos encontrados."));
    return;
  }
  list.slice(0, 200).forEach((r, i) => {
    const row = el(
      "div",
      { class: "repo" + (r.memory ? "" : " none") + (i === finderSel ? " sel" : ""), title: r.path },
      el("span", { class: "mark" }, r.memory ? "◆" : "○"),
      el("span", {}, el("span", { class: "name" }, r.name), el("span", { class: "path" }, r.pretty)),
      el("span", { class: "tag" }, r.recent ? "reciente" : r.memory ? "con memoria" : "sin memoria"),
    );
    row.addEventListener("click", () => openRepo(r.path));
    box.append(row);
  });
  const sel = box.querySelector(".repo.sel");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}

async function openRepo(path) {
  try {
    const r = await getJSON(`/api/open?path=${encodeURIComponent(path)}`);
    closeFinder();
    await loadTabs(r.id);
  } catch (e) {
    $("finderError").textContent = e.message;
    $("finderError").classList.remove("hidden");
  }
}

async function pickFolder() {
  try {
    const r = await getJSON("/api/pick");
    if (r.cancel) return;
    closeFinder();
    await loadTabs(r.id);
  } catch (e) {
    $("finderError").textContent = e.message;
    $("finderError").classList.remove("hidden");
  }
}

function bindFinder() {
  $("openRepo").addEventListener("click", openFinder);
  $("finderClose").addEventListener("click", closeFinder);
  $("finder").addEventListener("click", (e) => { if (e.target === $("finder")) closeFinder(); });
  $("pickFolder").addEventListener("click", pickFolder);
  $("rescan").addEventListener("click", async () => { await getJSON("/api/rescan"); refreshRepos(); });
  $("repoSearch").addEventListener("input", () => { finderSel = 0; $("finderError").classList.add("hidden"); renderRepos(); });
  $("repoSearch").addEventListener("keydown", (e) => {
    const list = filteredRepos();
    if (e.key === "ArrowDown") { finderSel = Math.min(finderSel + 1, list.length - 1); renderRepos(); e.preventDefault(); }
    if (e.key === "ArrowUp") { finderSel = Math.max(finderSel - 1, 0); renderRepos(); e.preventDefault(); }
    if (e.key === "Enter" && list[finderSel]) openRepo(list[finderSel].path);
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") { e.preventDefault(); openFinder(); }
    if (e.key === "Escape" && !$("finder").classList.contains("hidden")) closeFinder();
  });
}

// ───────────── legend & controls ─────────────
function renderKinds() {
  const box = $("kinds");
  box.innerHTML = "";
  const counts = {};
  for (const n of graph.nodes) counts[n.k] = (counts[n.k] || 0) + 1;
  for (const [k, label] of Object.entries(KIND_LABELS)) {
    if (!counts[k]) continue;
    const off = view.opts.hiddenKinds.has(k);
    const chip = el("span", { class: "kind" + (off ? " off" : ""), style: `--c:${KIND_COLORS[k]}`, title: "mostrar / ocultar" }, el("i"), label, el("small", {}, String(counts[k])));
    chip.addEventListener("click", () => {
      if (view.opts.hiddenKinds.has(k)) view.opts.hiddenKinds.delete(k);
      else view.opts.hiddenKinds.add(k);
      view.refresh();
      renderKinds();
      renderStats();
    });
    box.append(chip);
  }
}

function renderEdgeToggles() {
  const box = $("edgeToggles");
  box.innerHTML = "";
  for (const [k, st] of Object.entries(EDGE_STYLE)) {
    const b = el("button", { type: "button", style: `--c:rgb(${st.color.join(",")})` }, st.label);
    b.classList.toggle("on", view.opts.edges[k]);
    b.addEventListener("click", () => {
      view.opts.edges[k] = !view.opts.edges[k];
      b.classList.toggle("on", view.opts.edges[k]);
    });
    box.append(b);
  }
}

function renderStats() {
  const s = view.stats();
  $("stats").textContent =
    `${s.shown}/${s.total} recuerdos · ${s.core} en el núcleo\n` +
    `${s.stars} astros (rutas) · χ medio ${s.chi >= 0 ? "+" : ""}${s.chi.toFixed(2)}`;
}

function bindControls() {
  $("colormode").addEventListener("change", (e) => { view.opts.color = e.target.value; });
  for (const id of ["coreOnly", "showPlans", "showStale", "autorotate"]) {
    $(id).addEventListener("change", (e) => {
      view.opts[id] = e.target.checked;
      view.refresh();
      renderStats();
    });
  }
  $("search").addEventListener("input", (e) => { view.opts.search = e.target.value.trim().toLowerCase(); });
  $("reload").addEventListener("click", () => current && open(current, true));
  $("infoClose").addEventListener("click", () => {
    view.selected = null;
    view.setRuleReach(null);
    showInfo(null);
    view.refresh();
  });
  $("fileClose").addEventListener("click", () => {
    view.selectedFile = null;
    $("filePanel").classList.add("hidden");
    view.refresh();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      view.selected = null;
      view.selectedFile = null;
      view.setRuleReach(null);
      showInfo(null);
      $("filePanel").classList.add("hidden");
      view.refresh();
    }
    if (e.key === "r" && document.activeElement.tagName !== "INPUT") view.resetCamera();
  });
  bindLayerControls();
  renderEdgeToggles();
}

function syncLayerToggles() {
  $("layerMemory").checked = layers.memory;
  $("layerCode").checked = layers.code;
  $("layerImports").checked = layers.imports;
  $("layerCalls").checked = layers.calls;
}

function updateIndexNotice() {
  const box = $("indexNotice");
  if (!box) return;
  if (code && code.notice) {
    box.textContent = code.notice;
    box.classList.remove("hidden");
  } else {
    box.classList.add("hidden");
  }
}

function bindLayerControls() {
  const map = {
    layerMemory: "memory",
    layerCode: "code",
    layerImports: "imports",
    layerCalls: "calls",
  };
  for (const [elemId, layerKey] of Object.entries(map)) {
    const el = $(elemId);
    if (!el) continue;
    el.addEventListener("change", (e) => {
      layers[layerKey] = e.target.checked;
      saveLayers();
      view.opts.layers[layerKey] = e.target.checked;
      view.refresh();
      renderStats();
    });
  }
}

async function showFileMap(path) {
  if (!path || !current) return;
  let data;
  try {
    data = await getJSON(`/api/file?m=${encodeURIComponent(current)}&path=${encodeURIComponent(path)}`);
  } catch (e) {
    return;
  }

  $("info").classList.add("hidden");
  view.selected = null;
  view.setRuleReach(null);

  const panel = $("filePanel");
  panel.classList.remove("hidden");

  $("filePath").textContent = data.path;
  $("fileKind").textContent = `ARCHIVO · ${data.kind.replace('_', ' ').toUpperCase()}`;

  const notice = $("fileNotice");
  if (data.kind === "not_indexed") {
    notice.textContent = "archivo no indexado: reglas ancladas sin símbolos";
    notice.classList.remove("hidden");
  } else if (data.kind === "new_file") {
    notice.textContent = "archivo nuevo: aún no está en el índice";
    notice.classList.remove("hidden");
  } else {
    notice.classList.add("hidden");
  }

  // 1. Reglas ancladas al archivo y carpetas
  const rulesSec = $("fileRulesSection");
  const rulesList = $("fileRules");
  rulesList.innerHTML = "";
  if (data.direct_rules && data.direct_rules.length > 0) {
    rulesSec.classList.remove("hidden");
    for (const r of data.direct_rules) {
      const card = el("div", { class: "rule-card" },
        el("div", { class: "rule-head" },
          el("span", { class: "rule-tag" }, `#${r.id} ${r.kind}`),
          el("span", { class: "rule-chi" }, `χ ${r.chi >= 0 ? "+" : ""}${r.chi.toFixed(2)} · ${r.tag}`)
        ),
        el("div", { class: "rule-body" }, r.label || r.text)
      );
      card.addEventListener("click", () => {
        panel.classList.add("hidden");
        view.select(r.id);
      });
      rulesList.append(card);
    }
  } else {
    rulesSec.classList.add("hidden");
  }

  // 2. En vecinos
  const neighSec = $("fileNeighborsSection");
  const neighList = $("fileNeighborRules");
  neighList.innerHTML = "";
  if (data.neighbor_rules && data.neighbor_rules.length > 0) {
    neighSec.classList.remove("hidden");
    for (const r of data.neighbor_rules) {
      const card = el("div", { class: "rule-card" },
        el("div", { class: "rule-head" },
          el("span", { class: "rule-tag" }, `#${r.id} ${r.kind}`),
          el("span", { class: "rule-chi" }, `χ ${r.chi >= 0 ? "+" : ""}${r.chi.toFixed(2)} · ${r.tag}`)
        ),
        el("div", { class: "rule-body" }, r.label || r.text)
      );
      card.addEventListener("click", () => {
        panel.classList.add("hidden");
        view.select(r.id);
      });
      neighList.append(card);
    }
  } else {
    neighSec.classList.add("hidden");
  }

  // 3. Importaciones
  const depsSec = $("fileDepsSection");
  const importsList = $("fileImports");
  const importedByList = $("fileImportedBy");
  importsList.innerHTML = "";
  importedByList.innerHTML = "";
  const hasImports = data.imports && data.imports.length > 0;
  const hasImportedBy = data.imported_by && data.imported_by.length > 0;
  if (hasImports || hasImportedBy) {
    depsSec.classList.remove("hidden");
    if (hasImports) {
      for (const imp of data.imports) {
        const item = el("div", { class: "dep-item", title: imp }, `→ ${imp}`);
        item.addEventListener("click", () => {
          showFileMap(imp);
          const h = view.hubs.get(imp);
          if (h) view.focus(h);
        });
        importsList.append(item);
      }
    } else {
      importsList.append(el("div", { class: "scale-hint" }, "—"));
    }

    if (hasImportedBy) {
      for (const by of data.imported_by) {
        const item = el("div", { class: "dep-item", title: by }, `← ${by}`);
        item.addEventListener("click", () => {
          showFileMap(by);
          const h = view.hubs.get(by);
          if (h) view.focus(h);
        });
        importedByList.append(item);
      }
    } else {
      importedByList.append(el("div", { class: "scale-hint" }, "—"));
    }
  } else {
    depsSec.classList.add("hidden");
  }

  // 4. Símbolos (públicos primero, tests contados no listados)
  const symSec = $("fileSymbolsSection");
  const symSummary = $("fileSymbolsSummary");
  const symList = $("fileSymbols");
  symList.innerHTML = "";
  if (data.symbols && data.symbols.length > 0) {
    symSec.classList.remove("hidden");
    const testCount = data.symbols.filter(s => s.test).length;
    const nonTest = data.symbols.filter(s => !s.test);
    const pubCount = nonTest.filter(s => s.public).length;
    const privCount = nonTest.length - pubCount;

    symSummary.textContent = `${pubCount} públicos · ${privCount} privados` + (testCount > 0 ? ` · ${testCount} en tests` : "");
    nonTest.sort((a, b) => (b.public - a.public) || (a.line - b.line));

    for (const s of nonTest) {
      const line = el("div", { class: "symbol-line" },
        el("span", { class: "symbol-kind" }, s.kind),
        el("span", { class: "symbol-name" }, s.parent ? `${s.parent}::${s.name}` : s.name),
        s.public ? el("small", { style: "color: #5fb3d9; font-size: 10px;" }, "pub") : null
      );
      const item = el("div", { class: "symbol-item" + (s.public ? " pub" : "") }, line);
      if (s.signature && s.signature !== "-") {
        item.append(el("div", { class: "symbol-sig" }, s.signature));
      }
      if (s.decorators && s.decorators.length > 0) {
        item.append(el("div", { class: "symbol-dec" }, s.decorators.join(" ")));
      }
      symList.append(item);
    }
  } else {
    symSec.classList.add("hidden");
  }

  // Hermanos (si es archivo nuevo)
  const sibSec = $("fileSiblingsSection");
  const sibList = $("fileSiblings");
  sibList.innerHTML = "";
  if (data.siblings && data.siblings.length > 0) {
    sibSec.classList.remove("hidden");
    for (const sib of data.siblings) {
      const symNames = sib.public_symbols.map(s => s.name).slice(0, 4).join(", ");
      const item = el("div", { class: "sibling-item" },
        el("b", {}, sib.path),
        symNames ? el("div", { class: "scale-hint" }, symNames) : null
      );
      item.addEventListener("click", () => {
        showFileMap(sib.path);
        const h = view.hubs.get(sib.path);
        if (h) view.focus(h);
      });
      sibList.append(item);
    }
  } else {
    sibSec.classList.add("hidden");
  }
}

// ───────────── info panel ─────────────
function fmtTime(y) {
  if (!y) return "—";
  const d = new Date(y * 1000);
  return isNaN(d) ? String(y) : d.toLocaleString("es");
}

function showInfo(n) {
  const box = $("info");
  if (!n) { box.classList.add("hidden"); return; }
  $("filePanel").classList.add("hidden");
  view.selectedFile = null;
  view.setRuleReach(n);
  view.refresh();
  box.classList.remove("hidden");

  const kind = $("infoKind");
  kind.innerHTML = "";
  kind.append(`${KIND_LABELS[n.k] || n.k} · ${n.o}`);
  const flags = [["core", "núcleo"], ["anch", "anclado"], ["cons", "consolidado"], ["pot", "plan"], ["stale", "obsoleto"]];
  for (const [f, label] of flags) if (n[f]) kind.append(el("span", { class: `flag ${f}` }, label));

  $("infoLabel").textContent = n.l;
  $("infoText").textContent = n.t !== n.l ? n.t : "";
  $("chiMark").style.left = `${((Math.max(-1, Math.min(1, n.z)) + 1) / 2) * 100}%`;
  $("chiNums").innerHTML = "";
  const nums = $("chiNums");
  const b = (s) => el("b", {}, s);
  if (n.vis) nums.append("χ ", b(`${n.z >= 0 ? "+" : ""}${n.z.toFixed(2)}`), ` (${n.tag}) · E `, b(n.e.toFixed(2)), " · A ", b(n.a.toFixed(2)));
  else nums.append(n.pot ? "plan: aún no ocurre (χ −1 hasta que se cumpla)" : "fuera de la vista");

  const meta = $("infoMeta");
  meta.innerHTML = "";
  const row = (k, v) => { if (v !== "" && v !== undefined && v !== null) meta.append(el("dt", {}, k), el("dd", {}, String(v))); };
  row("ruta", n.p ? n.p + (n.s ? `::${n.s}` : "") : "— (todo el proyecto)");
  row("rama", n.b || "tronco");
  row("commit", n.c);
  row("aprendido", fmtTime(n.y));
  row("α / β", `${n.al.toFixed(1)} / ${n.be.toFixed(1)}`);
  row("activación", `${n.act.toFixed(2)} · ${n.rc} veces inyectado`);
  row("origen", n.src);
  row("id", `#${n.id}`);

  const neigh = $("infoNeigh");
  neigh.innerHTML = "";
  for (const e of n.nb) {
    const otherId = e.f === n.id ? e.t : e.f;
    const o = view.byId.get(otherId);
    if (!o) continue;
    const st = EDGE_STYLE[e.k] || { color: [150, 150, 150], label: e.k };
    const dir = e.f === n.id ? "→" : "←";
    const line = el("div", { class: "edge", style: `--c:rgb(${st.color.join(",")})` }, el("small", {}, `${dir} ${st.label}`), o.l);
    line.addEventListener("click", () => view.select(otherId));
    neigh.append(line);
  }
}

view.onSelect = showInfo;
view.onSelectFile = (h) => {
  if (h) showFileMap(h.path);
  else $("filePanel").classList.add("hidden");
};
bindControls();
bindFinder();
loadTabs()
  .then(() => { if (!memories.length) openFinder(); })
  .catch((e) => showEmpty(`No se pudo contactar con memviz: ${e.message}`));
setInterval(async () => {
  if (current && !document.hidden) {
    try {
      graph = await getJSON(`/api/graph?m=${encodeURIComponent(current)}`);
      const nextCode = await getJSON(`/api/code?m=${encodeURIComponent(current)}`);
      if (nextCode.mtime !== lastCodeMtime) {
        code = nextCode;
        lastCodeMtime = nextCode.mtime;
        updateIndexNotice();
      }
      view.setGraph(graph, code, true);
      renderKinds();
      renderStats();
    } catch (e) {}
  }
}, REFRESH_MS);
