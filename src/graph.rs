//! A `.cthg` memory as the JSON the constellation draws.
//!
//! χ is computed here, for the god view (every branch, every instant): the viewer shows the
//! whole memory, and marks what a normal view would hide (plans, obsolete, other branches).

use cthg_core::model::{flags, Memory};
use cthg_core::score::{self, certainty_tag, View};
use serde_json::{json, Value};

pub fn to_json(m: &Memory, name: &str, scope: &str, source: &str) -> Value {
    let scores = score::score_all(m, &View::all());
    let nodes: Vec<Value> = m
        .nodes
        .iter()
        .map(|n| {
            let s = scores[n.id as usize];
            json!({
                "id": n.id,
                "k": n.kind.name(),
                "o": n.origin.name(),
                "l": n.label,
                "t": n.text,
                "p": n.path,
                "s": n.symbol,
                "b": n.branch,
                "c": n.commit,
                "y": n.y,
                "z": s.chi,
                "e": s.engineer,
                "a": s.chance,
                "al": n.alpha,
                "be": n.beta,
                "vis": s.visible,
                "tag": certainty_tag(s.chi),
                "core": n.has(flags::CORE),
                "anch": n.anchored(),
                "cons": n.has(flags::CONSOLIDATED),
                "pot": n.has(flags::POTENTIAL),
                "stale": n.has(flags::STALE),
                "act": n.activation,
                "rc": n.recalls,
                "src": n.key,
            })
        })
        .collect();
    let edges: Vec<Value> = m
        .edges
        .iter()
        .map(|e| json!({ "f": e.from, "t": e.to, "k": e.kind.name(), "det": e.determinism(), "h": e.hebb }))
        .collect();
    let hyper: Vec<Value> = m.hyperedges.iter().map(|h| json!({ "l": h.label, "y": h.y, "m": h.members })).collect();
    json!({
        "name": name,
        "scope": scope,
        "source": source,
        "trunk": m.meta("trunk").unwrap_or(""),
        "session": m.session,
        "nodes": nodes,
        "edges": edges,
        "hyper": hyper,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use cthg_core::learn::{learn, Claim};

    #[test]
    fn exports_nodes_edges_and_flags() {
        let mut m = Memory::default();
        let mut core = Claim::rule("Nunca hagas push directo a main", "");
        core.core = true;
        learn(&mut m, &core, 1.0);
        let ev = learn(&mut m, &Claim::rule("No uses unwrap en el colisionador", "src/core/collider.rs").because("Un panic tumbó el servidor"), 2.0);
        let mut plan = Claim::rule("Migrar el renderizado a wgpu", "src/render");
        plan.kind = cthg_core::model::NodeKind::Plan;
        learn(&mut m, &plan, 3.0);

        let v = to_json(&m, "demo", "proyecto", "x/.cthg/memoria.cthg");
        let nodes = v["nodes"].as_array().unwrap();
        assert_eq!(nodes.len(), m.nodes.len());
        assert_eq!(nodes[0]["core"], true);
        let rule = &nodes[ev.iter().find(|e| e.label.contains("unwrap")).unwrap().node as usize];
        assert_eq!(rule["p"], "src/core/collider.rs");
        assert_eq!(rule["k"], "regla");
        let plan = nodes.iter().find(|n| n["k"] == "plan").unwrap();
        assert_eq!((plan["pot"].clone(), plan["vis"].clone()), (json!(true), json!(false)));
        let edges = v["edges"].as_array().unwrap();
        assert!(edges.iter().any(|e| e["k"] == "causa"));
        // Labels with quotes and accents survive the round trip.
        let text = serde_json::to_string(&v).unwrap();
        let back: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(back["nodes"][1]["t"], nodes[1]["t"]);
    }
}
