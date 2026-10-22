//! What the app has open, what it remembers and what it can find — and one router that the
//! native window and the `--web` dev mode share, so both behave exactly the same.
//!
//! Nothing here is a fixed path: memories are found from whatever folder the user picks
//! (walking up to `.cthg/memoria.cthg`), the global memory from `CTHG_GLOBAL` or the home
//! folder, and repos by scanning the home folder in the background.

use crate::{code, graph};
use cthg_core::binary;
use cthg_core::index::{self, FileMapKind, ProjectIndex};
use cthg_core::score::{self, certainty_tag, View};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub const INDEX: &str = include_str!("../web/index.html");
pub const APP_JS: &str = include_str!("../web/app.js");
pub const VIEW_JS: &str = include_str!("../web/view3d.js");
pub const STYLE: &str = include_str!("../web/style.css");

/// How deep the repo search goes below the home folder.
const SCAN_DEPTH: usize = 6;
/// Folders never worth entering: caches, toolchains, dependencies, build output.
const SKIP_DIRS: &[&str] = &[
    "AppData", "node_modules", "target", ".git", ".cargo", ".rustup", ".cache", ".npm", ".gradle", ".m2",
    ".nuget", ".vscode", ".vscode-shared", ".local", ".docker", ".ollama", ".cthg", "venv", ".venv",
    "__pycache__", "dist", "build", "$Recycle.Bin", "Program Files", "Windows", "curseforge",
];
const MAX_RECENT: usize = 15;

/// One open memory (a tab).
#[derive(Clone, Debug)]
pub struct Source {
    pub id: String,
    pub label: String,
    pub scope: &'static str,
    pub file: PathBuf,
    /// The project folder (the one holding `.cthg/`); empty for the global memory.
    pub root: PathBuf,
}

/// A folder the search found: a git repo, a CTHG memory, or both.
#[derive(Clone, Debug)]
pub struct Repo {
    pub path: PathBuf,
    pub memory: bool,
}

#[derive(Default)]
pub struct State {
    pub sources: Vec<Source>,
    next: usize,
    pub recent: Vec<PathBuf>,
    pub found: Vec<Repo>,
    pub scanning: bool,
    pub code_caches: HashMap<String, (u64, Value)>,
}

pub type Shared = Arc<Mutex<State>>;

pub fn home() -> Option<PathBuf> {
    std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).ok().map(PathBuf::from)
}

/// The user's global memory: `CTHG_GLOBAL`, else `~/.cthg/global.cthg` (same rule as `cthg`).
pub fn global_file() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("CTHG_GLOBAL") {
        return Some(PathBuf::from(p));
    }
    home().map(|h| h.join(".cthg").join("global.cthg"))
}

/// Where the app keeps its recent repos and open tabs.
fn settings_file() -> Option<PathBuf> {
    home().map(|h| h.join(".cthg").join("memviz.json"))
}

/// A `.cthg` file, or the nearest `.cthg/memoria.cthg` at or above a folder.
pub fn find_memory(p: &Path) -> Option<PathBuf> {
    if p.is_file() {
        return Some(p.to_path_buf());
    }
    p.ancestors().map(|d| d.join(".cthg").join("memoria.cthg")).find(|f| f.is_file())
}

fn name_of(p: &Path) -> String {
    p.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| p.display().to_string())
}

/// `C:\Users\x\OneDrive\Escritorio\repo` → `~\OneDrive\Escritorio\repo`.
pub fn pretty(p: &Path) -> String {
    match home() {
        Some(h) if p.starts_with(&h) => format!("~{}{}", std::path::MAIN_SEPARATOR, p.strip_prefix(&h).map(|r| r.display().to_string()).unwrap_or_default()),
        _ => p.display().to_string(),
    }
}

impl State {
    pub fn new() -> Shared {
        let mut st = State::default();
        if let Some(Ok(v)) = settings_file().and_then(|f| fs::read_to_string(f).ok()).map(|t| serde_json::from_str::<Value>(&t)) {
            st.recent = v["recientes"].as_array().into_iter().flatten().filter_map(|x| x.as_str()).map(PathBuf::from).collect();
            for p in v["abiertos"].as_array().into_iter().flatten().filter_map(|x| x.as_str()) {
                let _ = st.open(Path::new(p));
            }
        }
        if let Some(g) = global_file().filter(|f| f.is_file()) {
            st.sources.push(Source { id: "global".into(), label: "global".into(), scope: "global", file: g, root: PathBuf::new() });
        }
        Arc::new(Mutex::new(st))
    }

    fn save(&self) {
        let Some(f) = settings_file() else { return };
        let open: Vec<String> = self.sources.iter().filter(|s| s.scope == "proyecto").map(|s| s.root.display().to_string()).collect();
        let recent: Vec<String> = self.recent.iter().map(|p| p.display().to_string()).collect();
        let _ = fs::create_dir_all(f.parent().unwrap_or(Path::new(".")));
        let _ = fs::write(f, json!({ "recientes": recent, "abiertos": open }).to_string());
    }

    /// Opens the memory of the repo containing `p` (or returns the tab it already has).
    pub fn open(&mut self, p: &Path) -> Result<String, String> {
        let file = find_memory(p).ok_or_else(|| {
            format!("{} no tiene memoria CTHG todavía: créala con `cthg init` en esa carpeta.", pretty(p))
        })?;
        let root = file.parent().and_then(Path::parent).map(Path::to_path_buf).unwrap_or_default();
        self.recent.retain(|r| r != &root);
        self.recent.insert(0, root.clone());
        self.recent.truncate(MAX_RECENT);
        if let Some(s) = self.sources.iter().find(|s| s.file == file) {
            let id = s.id.clone();
            self.save();
            return Ok(id);
        }
        let id = format!("p{}", self.next);
        self.next += 1;
        let source = Source { id: id.clone(), label: name_of(&root), scope: "proyecto", file, root };
        // Project tabs go before the global one.
        let at = self.sources.iter().position(|s| s.scope == "global").unwrap_or(self.sources.len());
        self.sources.insert(at, source);
        self.save();
        Ok(id)
    }

    pub fn close(&mut self, id: &str) {
        self.sources.retain(|s| s.id != id);
        self.save();
    }
}

/// Walks the home folder for git repos and CTHG memories, in the background.
pub fn scan(state: Shared) {
    {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        if st.scanning {
            return;
        }
        st.scanning = true;
    }
    std::thread::spawn(move || {
        let mut found = Vec::new();
        if let Some(h) = home() {
            walk(&h, &h, 0, &mut found);
        }
        found.sort_by_key(|r: &Repo| name_of(&r.path).to_lowercase());
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        st.found = found;
        st.scanning = false;
    });
}

fn walk(dir: &Path, home: &Path, depth: usize, out: &mut Vec<Repo>) {
    let memory = dir.join(".cthg").join("memoria.cthg").is_file();
    // The home folder itself may be a git repo; it is never "a project".
    if dir != home && (memory || dir.join(".git").exists()) {
        out.push(Repo { path: dir.to_path_buf(), memory });
    }
    if depth >= SCAN_DEPTH {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        if !ft.is_dir() || ft.is_symlink() {
            continue;
        }
        let name = e.file_name().to_string_lossy().into_owned();
        if SKIP_DIRS.contains(&name.as_str()) || (name.starts_with('.') && name != ".config") {
            continue;
        }
        walk(&e.path(), home, depth + 1, out);
    }
}

/// `%C3%A9` → `é`, `+` stays `+` (the page always uses `encodeURIComponent`).
pub fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let hex = |c: u8| (c as char).to_digit(16).map(|d| d as u8);
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(hi), Some(lo)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(hi * 16 + lo);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|kv| kv.strip_prefix(&format!("{key}="))).map(decode)
}

pub struct Reply {
    pub status: u16,
    pub ctype: &'static str,
    pub body: Vec<u8>,
}

fn json_reply(status: u16, v: Value) -> Reply {
    Reply { status, ctype: "application/json; charset=utf-8", body: v.to_string().into_bytes() }
}

fn tabs(st: &State) -> Value {
    Value::Array(
        st.sources
            .iter()
            .map(|s| json!({ "id": s.id, "label": s.label, "scope": s.scope, "file": pretty(&s.file), "root": s.root.display().to_string() }))
            .collect(),
    )
}

/// Every request of the page: static files and the `/api/*` calls.
/// `pick_folder` shows the native folder dialog (blocking); it runs without holding the lock.
pub fn route(state: &Shared, path: &str, query: &str, pick_folder: &dyn Fn() -> Option<PathBuf>) -> Reply {
    let lock = || state.lock().unwrap_or_else(|e| e.into_inner());
    match path {
        "/" | "/index.html" => Reply { status: 200, ctype: "text/html; charset=utf-8", body: INDEX.as_bytes().to_vec() },
        "/style.css" => Reply { status: 200, ctype: "text/css; charset=utf-8", body: STYLE.as_bytes().to_vec() },
        "/view3d.js" => Reply { status: 200, ctype: "text/javascript; charset=utf-8", body: VIEW_JS.as_bytes().to_vec() },
        "/app.js" => Reply { status: 200, ctype: "text/javascript; charset=utf-8", body: APP_JS.as_bytes().to_vec() },
        "/api/memories" => json_reply(200, tabs(&lock())),
        "/api/code" => {
            let id = param(query, "m").unwrap_or_default();
            let src = lock().sources.iter().find(|s| s.id == id).cloned();
            let Some(s) = src else {
                return json_reply(404, json!({ "error": "memoria desconocida" }));
            };
            if s.root.as_os_str().is_empty() {
                return json_reply(200, json!({
                    "files": [],
                    "imports": [],
                    "calls": [],
                    "mtime": 0,
                    "aggregated": false,
                    "notice": "sin índice: ejecuta `cthg index` en el repo"
                }));
            }
            let index_path = s.root.join(".cthg").join("indice.tsv");
            if !index_path.is_file() {
                return json_reply(200, json!({
                    "files": [],
                    "imports": [],
                    "calls": [],
                    "mtime": 0,
                    "aggregated": false,
                    "notice": "sin índice: ejecuta `cthg index` en el repo"
                }));
            }

            let mtime = fs::metadata(&index_path)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            // Check cache
            {
                let st = lock();
                if let Some((cached_mtime, cached_json)) = st.code_caches.get(&s.id) {
                    if *cached_mtime == mtime {
                        return json_reply(200, cached_json.clone());
                    }
                }
            }

            // Strictly read-only: parse index file without touching disk
            let content = match fs::read_to_string(&index_path) {
                Ok(c) => c,
                Err(_) => {
                    return json_reply(200, json!({
                        "files": [],
                        "imports": [],
                        "calls": [],
                        "mtime": 0,
                        "aggregated": false,
                        "notice": "sin índice: ejecuta `cthg index` en el repo"
                    }));
                }
            };

            let project_index = match index::parse_index(&content) {
                Ok(idx) => idx,
                Err(_) => {
                    return json_reply(200, json!({
                        "files": [],
                        "imports": [],
                        "calls": [],
                        "mtime": 0,
                        "aggregated": false,
                        "notice": "sin índice: ejecuta `cthg index` en el repo"
                    }));
                }
            };

            let mem_opt = binary::load(&s.file).ok();
            let scores = mem_opt
                .as_ref()
                .map(|m| score::score_all(m, &View::all()))
                .unwrap_or_default();

            let code_json = code::code_to_json(&project_index, mem_opt.as_ref(), &scores, mtime);

            // Cache it
            {
                let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
                st.code_caches.insert(s.id.clone(), (mtime, code_json.clone()));
            }

            json_reply(200, code_json)
        }
        "/api/file" => {
            let id = param(query, "m").unwrap_or_default();
            let target_path = param(query, "path").unwrap_or_default();
            let src = lock().sources.iter().find(|s| s.id == id).cloned();
            let Some(s) = src else {
                return json_reply(404, json!({ "error": "memoria desconocida" }));
            };
            if target_path.is_empty() {
                return json_reply(400, json!({ "error": "falta la ruta" }));
            }

            let index_path = s.root.join(".cthg").join("indice.tsv");
            let project_index = if index_path.is_file() {
                fs::read_to_string(&index_path)
                    .ok()
                    .and_then(|c| index::parse_index(&c).ok())
                    .unwrap_or_default()
            } else {
                ProjectIndex::default()
            };

            let exists_on_disk = s.root.join(&target_path).exists();
            let mem_opt = binary::load(&s.file).ok();
            let scores = mem_opt
                .as_ref()
                .map(|m| score::score_all(m, &View::all()))
                .unwrap_or_default();

            let map = index::file_map(
                &project_index,
                mem_opt.as_ref(),
                &scores,
                &target_path,
                exists_on_disk,
            );

            let map_kind = match map.kind {
                FileMapKind::Indexed => "indexed",
                FileMapKind::NotIndexed => "not_indexed",
                FileMapKind::NewFile => "new_file",
            };

            let rule_to_json = |id: u32| {
                if let Some(m) = mem_opt.as_ref() {
                    if let Some(node) = m.nodes.get(id as usize) {
                        let sc = scores.get(id as usize);
                        let chi = sc.map(|s| s.chi).unwrap_or(0.0);
                        return json!({
                            "id": node.id,
                            "label": node.label,
                            "text": node.text,
                            "path": node.path,
                            "kind": node.kind.name(),
                            "chi": chi,
                            "tag": certainty_tag(chi),
                        });
                    }
                }
                json!({ "id": id, "label": format!("#{id}"), "text": "", "path": "", "kind": "regla", "chi": 0.0, "tag": "sin evidencia" })
            };

            let direct_rules: Vec<Value> = map.direct_rules.into_iter().map(rule_to_json).collect();
            let neighbor_rules: Vec<Value> = map.neighbor_rules.into_iter().map(rule_to_json).collect();

            let symbols: Vec<Value> = map
                .symbols
                .into_iter()
                .map(|s| {
                    json!({
                        "name": s.name,
                        "kind": s.kind,
                        "line": s.line,
                        "end_line": s.end_line,
                        "public": s.public,
                        "parent": s.parent,
                        "test": s.test,
                        "signature": s.signature,
                        "decorators": s.decorators,
                    })
                })
                .collect();

            let siblings: Vec<Value> = map
                .siblings
                .into_iter()
                .map(|sib| {
                    json!({
                        "path": sib.path,
                        "public_symbols": sib.public_symbols.into_iter().map(|s| json!({
                            "name": s.name,
                            "kind": s.kind,
                            "signature": s.signature,
                        })).collect::<Vec<_>>(),
                    })
                })
                .collect();

            json_reply(200, json!({
                "path": map.path,
                "kind": map_kind,
                "direct_rules": direct_rules,
                "neighbor_rules": neighbor_rules,
                "imports": map.imports,
                "imported_by": map.imported_by,
                "symbols": symbols,
                "siblings": siblings,
            }))
        }
        "/api/graph" => {
            let id = param(query, "m").unwrap_or_default();
            let src = lock().sources.iter().find(|s| s.id == id).cloned();
            match src {
                // Read on every request: the hooks keep changing the memory while it is open.
                Some(s) => match binary::load(&s.file) {
                    Ok(m) => json_reply(200, graph::to_json(&m, &s.label, s.scope, &pretty(&s.file))),
                    Err(e) => json_reply(500, json!({ "error": format!("{}: {e}", pretty(&s.file)) })),
                },
                None => json_reply(404, json!({ "error": "memoria desconocida" })),
            }
        }
        "/api/repos" => {
            let st = lock();
            let mut seen = HashSet::new();
            let mut list = Vec::new();
            for p in &st.recent {
                if seen.insert(p.clone()) {
                    list.push(json!({ "path": p.display().to_string(), "pretty": pretty(p), "name": name_of(p), "memory": find_memory(p).is_some(), "recent": true }));
                }
            }
            for r in &st.found {
                if seen.insert(r.path.clone()) {
                    list.push(json!({ "path": r.path.display().to_string(), "pretty": pretty(&r.path), "name": name_of(&r.path), "memory": r.memory, "recent": false }));
                }
            }
            json_reply(200, json!({ "scanning": st.scanning, "repos": list }))
        }
        "/api/rescan" => {
            scan(state.clone());
            json_reply(200, json!({ "ok": true }))
        }
        "/api/open" => match param(query, "path") {
            Some(p) => match lock().open(Path::new(&p)) {
                Ok(id) => json_reply(200, json!({ "id": id })),
                Err(e) => json_reply(400, json!({ "error": e })),
            },
            None => json_reply(400, json!({ "error": "falta la ruta" })),
        },
        "/api/pick" => match pick_folder() {
            Some(p) => match lock().open(&p) {
                Ok(id) => json_reply(200, json!({ "id": id })),
                Err(e) => json_reply(400, json!({ "error": e })),
            },
            None => json_reply(200, json!({ "cancel": true })),
        },
        "/api/close" => {
            if let Some(id) = param(query, "m") {
                lock().close(&id);
            }
            json_reply(200, tabs(&lock()))
        }
        _ => Reply { status: 404, ctype: "text/plain; charset=utf-8", body: b"no existe".to_vec() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_paths_from_the_page() {
        assert_eq!(decode("C%3A%5CUsers%5Cleonp%5COneDrive%5CEscritorio%5Cdise%C3%B1o"), r"C:\Users\leonp\OneDrive\Escritorio\diseño");
        assert_eq!(decode("a%20b%2"), "a b%2", "a broken escape stays as it is");
        assert_eq!(decode("%é%41"), "%éA", "a % before a non-ASCII character does not panic");
    }

    #[test]
    fn finds_memories_and_repos_without_fixed_paths() {
        let base = std::env::temp_dir().join(format!("memviz-scan-{}", std::process::id()));
        let repo = base.join("Escritorio").join("proyecto");
        let deps = repo.join("node_modules").join("otro");
        fs::create_dir_all(repo.join(".cthg")).unwrap();
        fs::write(repo.join(".cthg").join("memoria.cthg"), b"x").unwrap();
        fs::create_dir_all(deps.join(".git")).unwrap();
        fs::create_dir_all(base.join("plain").join(".git")).unwrap();

        fs::create_dir_all(repo.join("src")).unwrap();
        assert_eq!(find_memory(&repo.join("src")), Some(repo.join(".cthg").join("memoria.cthg")));

        let mut found = Vec::new();
        walk(&base, &base, 0, &mut found);
        let paths: Vec<&PathBuf> = found.iter().map(|r| &r.path).collect();
        assert!(paths.contains(&&repo) && found.iter().any(|r| r.path == repo && r.memory));
        assert!(paths.contains(&&base.join("plain")), "a git repo without memory is listed too");
        assert!(!paths.iter().any(|p| p.starts_with(repo.join("node_modules"))), "dependencies are skipped");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn api_code_is_strictly_read_only_and_hash_is_invariant() {
        let base = std::env::temp_dir().join(format!("memviz-ro-{}", std::process::id()));
        let cthg_dir = base.join(".cthg");
        fs::create_dir_all(&cthg_dir).unwrap();

        let mut m = cthg_core::model::Memory::default();
        let claim = cthg_core::learn::Claim::rule("Regla test", "src/lib.rs");
        cthg_core::learn::learn(&mut m, &claim, 1.0);
        let mem_path = cthg_dir.join("memoria.cthg");
        cthg_core::binary::save(&m, &mem_path).unwrap();

        let index_content = "cthg-indice 2\nF\tsrc/lib.rs\trust\t100\t1000\t12345678\t-\nS\tfn\trun\t1\t5\t1\t-\t0\t()\t-\n";
        let index_path = cthg_dir.join("indice.tsv");
        fs::write(&index_path, index_content).unwrap();

        let bytes_before = fs::read(&index_path).unwrap();

        let shared = State::new();
        let tab_id = shared.lock().unwrap().open(&base).unwrap();

        let reply = route(&shared, "/api/code", &format!("m={tab_id}"), &|| None);
        assert_eq!(reply.status, 200);

        let body: Value = serde_json::from_slice(&reply.body).unwrap();
        assert_eq!(body["files"].as_array().unwrap().len(), 1);
        assert_eq!(body["files"][0]["path"], "src/lib.rs");
        assert_eq!(body["files"][0]["rules"].as_array().unwrap().len(), 1);

        let bytes_after = fs::read(&index_path).unwrap();
        assert_eq!(bytes_before, bytes_after, "content of indice.tsv must never change");

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn missing_or_corrupt_index_returns_notice_without_failing() {
        let base = std::env::temp_dir().join(format!("memviz-corrupt-{}", std::process::id()));
        let cthg_dir = base.join(".cthg");
        fs::create_dir_all(&cthg_dir).unwrap();

        let m = cthg_core::model::Memory::default();
        let mem_path = cthg_dir.join("memoria.cthg");
        cthg_core::binary::save(&m, &mem_path).unwrap();

        let shared = State::new();
        let tab_id = shared.lock().unwrap().open(&base).unwrap();

        // 1. Missing index
        let rep1 = route(&shared, "/api/code", &format!("m={tab_id}"), &|| None);
        assert_eq!(rep1.status, 200);
        let body1: Value = serde_json::from_slice(&rep1.body).unwrap();
        assert!(body1["files"].as_array().unwrap().is_empty());
        assert_eq!(body1["notice"], "sin índice: ejecuta `cthg index` en el repo");

        // 2. Corrupt index (wrong header)
        let index_path = cthg_dir.join("indice.tsv");
        fs::write(&index_path, "cabecera invalida\n").unwrap();

        let rep2 = route(&shared, "/api/code", &format!("m={tab_id}"), &|| None);
        assert_eq!(rep2.status, 200);
        let body2: Value = serde_json::from_slice(&rep2.body).unwrap();
        assert!(body2["files"].as_array().unwrap().is_empty());
        assert_eq!(body2["notice"], "sin índice: ejecuta `cthg index` en el repo");

        let _ = fs::remove_dir_all(&base);
    }
}
