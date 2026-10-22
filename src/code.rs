//! Code graph JSON projection for the 3D constellation viewer.
//!
//! Provides `code_to_json` to project indexed source files, resolved import edges,
//! and resolved call edges over the project memory.

use cthg_core::index::{self, ProjectIndex};
use cthg_core::model::Memory;
use cthg_core::score::Score;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub const AGGREGATION_THRESHOLD: usize = 2000;

pub fn code_to_json(
    index: &ProjectIndex,
    memory: Option<&Memory>,
    scores: &[Score],
    mtime: u64,
) -> Value {
    if index.files.len() > AGGREGATION_THRESHOLD {
        return aggregate_by_folder(index, memory, scores, mtime);
    }

    let files: Vec<Value> = index
        .files
        .iter()
        .map(|f| {
            let rules: Vec<u32> = if let Some(mem) = memory {
                index::anchored_rules_for_file(mem, scores, &f.path)
            } else {
                Vec::new()
            };
            json!({
                "path": f.path,
                "lang": f.lang,
                "symbols": f.symbols.len(),
                "status": f.status,
                "rules": rules,
            })
        })
        .collect();

    let mut seen_imports = HashSet::new();
    let mut imports = Vec::new();
    for f in &index.files {
        for imp in &f.imports {
            if let Some(target) = &imp.resolved {
                if target != &f.path && seen_imports.insert((f.path.clone(), target.clone())) {
                    imports.push(json!({
                        "from": f.path,
                        "to": target,
                    }));
                }
            }
        }
    }

    let call_tuples = index::call_edges(index);
    let calls: Vec<Value> = call_tuples
        .into_iter()
        .map(|(from, to, count)| {
            json!({
                "from": from,
                "to": to,
                "count": count,
            })
        })
        .collect();

    json!({
        "mtime": mtime,
        "aggregated": false,
        "notice": null,
        "files": files,
        "imports": imports,
        "calls": calls,
    })
}

fn folder_of(path: &str) -> String {
    path.rsplit_once('/').map(|(dir, _)| dir.to_string()).unwrap_or_default()
}

pub fn aggregate_by_folder(
    index: &ProjectIndex,
    memory: Option<&Memory>,
    scores: &[Score],
    mtime: u64,
) -> Value {
    struct FolderData {
        files_count: usize,
        symbols_count: usize,
        has_error: bool,
        rules: HashSet<u32>,
    }

    let mut folders: HashMap<String, FolderData> = HashMap::new();

    for f in &index.files {
        let folder = folder_of(&f.path);
        let rules = if let Some(mem) = memory {
            index::anchored_rules_for_file(mem, scores, &f.path)
        } else {
            Vec::new()
        };

        let entry = folders.entry(folder).or_insert_with(|| FolderData {
            files_count: 0,
            symbols_count: 0,
            has_error: false,
            rules: HashSet::new(),
        });

        entry.files_count += 1;
        entry.symbols_count += f.symbols.len();
        if f.status == "error" {
            entry.has_error = true;
        }
        for r in rules {
            entry.rules.insert(r);
        }
    }

    let mut sorted_folders: Vec<String> = folders.keys().cloned().collect();
    sorted_folders.sort();

    let files: Vec<Value> = sorted_folders
        .into_iter()
        .map(|dir| {
            let data = &folders[&dir];
            let mut rules: Vec<u32> = data.rules.iter().copied().collect();
            rules.sort();
            json!({
                "path": dir,
                "lang": "dir",
                "symbols": data.symbols_count,
                "files_count": data.files_count,
                "status": if data.has_error { "error" } else { "-" },
                "rules": rules,
            })
        })
        .collect();

    // Map file imports to folder imports
    let mut seen_folder_imports = HashSet::new();
    let mut imports = Vec::new();
    for f in &index.files {
        let f_dir = folder_of(&f.path);
        for imp in &f.imports {
            if let Some(target) = &imp.resolved {
                let t_dir = folder_of(target);
                if f_dir != t_dir && seen_folder_imports.insert((f_dir.clone(), t_dir.clone())) {
                    imports.push(json!({
                        "from": f_dir,
                        "to": t_dir,
                    }));
                }
            }
        }
    }

    // Map file calls to folder calls, summing counts
    let call_tuples = index::call_edges(index);
    let mut folder_calls: HashMap<(String, String), usize> = HashMap::new();
    for (from, to, count) in call_tuples {
        let from_dir = folder_of(&from);
        let to_dir = folder_of(&to);
        if from_dir != to_dir {
            *folder_calls.entry((from_dir, to_dir)).or_default() += count;
        }
    }

    let mut sorted_calls: Vec<((String, String), usize)> = folder_calls.into_iter().collect();
    sorted_calls.sort_by(|a, b| a.0.cmp(&b.0));

    let calls: Vec<Value> = sorted_calls
        .into_iter()
        .map(|((from, to), count)| {
            json!({
                "from": from,
                "to": to,
                "count": count,
            })
        })
        .collect();

    json!({
        "mtime": mtime,
        "aggregated": true,
        "notice": "más de 2 000 archivos: vista agregada por carpeta",
        "files": files,
        "imports": imports,
        "calls": calls,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use cthg_core::lang::{Call, Import, Symbol};
    use cthg_core::learn::{learn, Claim};
    use cthg_core::index::FileEntry;
    use cthg_core::score::{self, View};

    #[test]
    fn test_code_to_json_extracts_files_rules_imports_calls() {
        let mut idx = ProjectIndex::default();
        idx.files.push(FileEntry {
            path: "src/util.rs".to_string(),
            lang: "rust".to_string(),
            size: 100,
            mtime: 1,
            hash: 1,
            status: "-".to_string(),
            symbols: vec![Symbol {
                name: "helper".to_string(),
                kind: "fn".to_string(),
                line: 1,
                end_line: 5,
                public: true,
                parent: None,
                test: false,
                signature: "()".to_string(),
                decorators: vec![],
            }],
            imports: vec![],
            calls: vec![],
        });

        idx.files.push(FileEntry {
            path: "src/main.rs".to_string(),
            lang: "rust".to_string(),
            size: 200,
            mtime: 2,
            hash: 2,
            status: "-".to_string(),
            symbols: vec![Symbol {
                name: "main".to_string(),
                kind: "fn".to_string(),
                line: 1,
                end_line: 10,
                public: true,
                parent: None,
                test: false,
                signature: "()".to_string(),
                decorators: vec![],
            }],
            imports: vec![Import {
                raw: "crate::util".to_string(),
                resolved: Some("src/util.rs".to_string()),
            }],
            calls: vec![Call::new("main", "helper", 3)],
        });

        let mut m = Memory::default();
        // 1. Core rule without path -> should not be attributed to any file
        let mut core_claim = Claim::rule("Regla global de estilo", "");
        core_claim.core = true;
        learn(&mut m, &core_claim, 1.0);

        // 2. Active rule anchored to src/main.rs
        let main_claim = Claim::rule("No usar unwrap en main", "src/main.rs");
        learn(&mut m, &main_claim, 2.0);

        // 3. Rule for src folder -> applies to both src/main.rs and src/util.rs
        let src_claim = Claim::rule("Todo src usa determinismo", "src");
        learn(&mut m, &src_claim, 3.0);

        // 4. Superseded rule anchored to src/main.rs
        let old_claim = Claim::rule("Presupuesto viejo de main", "src/main.rs");
        learn(&mut m, &old_claim, 4.0);
        let mut new_claim = Claim::rule("Presupuesto nuevo de main", "src/main.rs");
        new_claim.supersedes = Some(3);
        learn(&mut m, &new_claim, 5.0);

        let scores = score::score_all(&m, &View::all());

        let json_val = code_to_json(&idx, Some(&m), &scores, 12345);

        assert_eq!(json_val["mtime"], 12345);
        assert_eq!(json_val["aggregated"], false);
        assert!(json_val["notice"].is_null());

        let files = json_val["files"].as_array().unwrap();
        assert_eq!(files.len(), 2);

        let util_file = files.iter().find(|f| f["path"] == "src/util.rs").unwrap();
        assert_eq!(util_file["symbols"], 1);
        let util_rules = util_file["rules"].as_array().unwrap();
        // Only src rule (id 2)
        assert_eq!(util_rules.len(), 1);
        assert_eq!(util_rules[0], 2);

        let main_file = files.iter().find(|f| f["path"] == "src/main.rs").unwrap();
        assert_eq!(main_file["symbols"], 1);
        let main_rules = main_file["rules"].as_array().unwrap();
        // Should contain main rule (1), src rule (2), and new rule (4), but NOT old rule (3) nor core rule (0)
        let main_rule_ids: Vec<u32> = main_rules.iter().map(|r| r.as_u64().unwrap() as u32).collect();
        assert!(main_rule_ids.contains(&1));
        assert!(main_rule_ids.contains(&2));
        assert!(main_rule_ids.contains(&4));
        assert!(!main_rule_ids.contains(&0), "core rule without path must not count for file");
        assert!(!main_rule_ids.contains(&3), "superseded rule must not count for file");

        let imports = json_val["imports"].as_array().unwrap();
        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0]["from"], "src/main.rs");
        assert_eq!(imports[0]["to"], "src/util.rs");

        let calls = json_val["calls"].as_array().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["from"], "src/main.rs");
        assert_eq!(calls[0]["to"], "src/util.rs");
        assert_eq!(calls[0]["count"], 1);
    }

    #[test]
    fn test_aggregate_by_folder_groups_and_sums_correctly() {
        let mut idx = ProjectIndex::default();
        for i in 0..10 {
            idx.files.push(FileEntry {
                path: format!("src/module_a/file_{i}.rs"),
                lang: "rust".to_string(),
                size: 100,
                mtime: 1,
                hash: 1,
                status: if i == 0 { "error".to_string() } else { "-".to_string() },
                symbols: vec![Symbol {
                    name: format!("fn_{i}"),
                    kind: "fn".to_string(),
                    line: 1,
                    end_line: 5,
                    public: true,
                    parent: None,
                    test: false,
                    signature: "()".to_string(),
                    decorators: vec![],
                }],
                imports: vec![Import {
                    raw: "other".to_string(),
                    resolved: Some(format!("src/module_b/file_{i}.rs")),
                }],
                calls: vec![Call::new(format!("fn_{i}"), format!("target_{i}"), 2)],
            });

            idx.files.push(FileEntry {
                path: format!("src/module_b/file_{i}.rs"),
                lang: "rust".to_string(),
                size: 100,
                mtime: 1,
                hash: 1,
                status: "-".to_string(),
                symbols: vec![Symbol {
                    name: format!("target_{i}"),
                    kind: "fn".to_string(),
                    line: 1,
                    end_line: 5,
                    public: true,
                    parent: None,
                    test: false,
                    signature: "()".to_string(),
                    decorators: vec![],
                }],
                imports: vec![],
                calls: vec![],
            });
        }

        let json_val = aggregate_by_folder(&idx, None, &[], 9999);
        assert_eq!(json_val["aggregated"], true);
        assert_eq!(json_val["notice"], "más de 2 000 archivos: vista agregada por carpeta");

        let files = json_val["files"].as_array().unwrap();
        assert_eq!(files.len(), 2);
        let mod_a = files.iter().find(|f| f["path"] == "src/module_a").unwrap();
        assert_eq!(mod_a["files_count"], 10);
        assert_eq!(mod_a["symbols"], 10);
        assert_eq!(mod_a["status"], "error"); // Had 1 error file

        let mod_b = files.iter().find(|f| f["path"] == "src/module_b").unwrap();
        assert_eq!(mod_b["files_count"], 10);
        assert_eq!(mod_b["symbols"], 10);
        assert_eq!(mod_b["status"], "-");

        let imports = json_val["imports"].as_array().unwrap();
        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0]["from"], "src/module_a");
        assert_eq!(imports[0]["to"], "src/module_b");

        let calls = json_val["calls"].as_array().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["from"], "src/module_a");
        assert_eq!(calls[0]["to"], "src/module_b");
        assert_eq!(calls[0]["count"], 10);
    }
}
