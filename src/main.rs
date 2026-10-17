//! `memviz` — desktop app to explore CTHG memories (`.cthg`).
//!
//! A native window with a webview: the memory as a constellation where the folder tree is the
//! sky (X), newer memories float higher (Y = time) and χ is light and pull (Z = confidence).
//! Pages and data travel through the app's own `memviz://` protocol: no port, no browser.
//! Read-only: it never writes a memory, so it can stay open while the hooks work.
//!
//! `memviz --web` serves the same app on 127.0.0.1 for debugging it in a browser.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod graph;
mod state;

use state::{Reply, Shared, State};
use std::path::PathBuf;

const HELP: &str = "memviz — memoria 3D de tus proyectos

  memviz [carpeta ...]            abre la app con esas memorias (y las de la última vez)
  memviz --web [--port N]         la misma app en el navegador (para depurar)

Dentro de la app: busca cualquier repo o elige una carpeta; la memoria global
(CTHG_GLOBAL o ~/.cthg/global.cthg) aparece sola si existe.";

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Err(e) = run(&args) {
        fail(&e);
    }
}

/// Without a console (release build) an error must still be seen.
fn fail(msg: &str) {
    eprintln!("memviz: {msg}");
    #[cfg(not(debug_assertions))]
    rfd::MessageDialog::new()
        .set_title("Memoria 3D")
        .set_description(msg)
        .set_level(rfd::MessageLevel::Error)
        .show();
    std::process::exit(1);
}

fn pick_folder() -> Option<PathBuf> {
    rfd::FileDialog::new().set_title("Elige un repositorio").pick_folder()
}

fn run(raw: &[String]) -> Result<(), String> {
    let mut web = false;
    let mut port: u16 = 7979;
    let mut paths = Vec::new();
    let mut it = raw.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "-h" | "--help" => {
                println!("{HELP}");
                return Ok(());
            }
            "--web" => web = true,
            "--port" => port = it.next().and_then(|v| v.parse().ok()).ok_or("--port necesita un número")?,
            _ => paths.push(PathBuf::from(a)),
        }
    }
    let shared = State::new();
    {
        let mut st = shared.lock().unwrap_or_else(|e| e.into_inner());
        for p in &paths {
            st.open(p)?;
        }
    }
    state::scan(shared.clone());
    if web {
        serve_web(shared, port)
    } else {
        run_app(shared)
    }
}

fn split_uri(uri: &str) -> (String, String) {
    // `memviz://localhost/api/x?q` (or `http://memviz.localhost/...` on Windows) → path, query.
    let after_scheme = uri.split_once("://").map(|(_, r)| r).unwrap_or(uri);
    let path_q = after_scheme.find('/').map(|i| &after_scheme[i..]).unwrap_or("/");
    let (path, query) = path_q.split_once('?').unwrap_or((path_q, ""));
    (path.to_string(), query.to_string())
}

fn run_app(shared: Shared) -> Result<(), String> {
    use tao::dpi::LogicalSize;
    use tao::event::{Event, WindowEvent};
    use tao::event_loop::{ControlFlow, EventLoop};
    use tao::window::WindowBuilder;
    use wry::WebContext;

    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title("Memoria 3D · CTHG")
        .with_inner_size(LogicalSize::new(1440.0, 900.0))
        .with_min_inner_size(LogicalSize::new(900.0, 600.0))
        .build(&event_loop)
        .map_err(|e| format!("no se pudo abrir la ventana: {e}"))?;

    // The browser profile lives in the user's local app data, never next to the executable
    // (that may be OneDrive, which locks it, or `.cargo/bin`). If another window holds it,
    // this one gets its own instead of failing.
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join("memviz");
    let mut context = WebContext::new(Some(base.join("WebView2")));
    let webview = match build_webview(&window, &mut context, &shared) {
        Ok(w) => w,
        Err(_) => {
            let mut own = WebContext::new(Some(base.join(format!("WebView2-{}", std::process::id()))));
            build_webview(&window, &mut own, &shared).map_err(|e| format!("no se pudo crear la vista web (¿falta WebView2?): {e}"))?
        }
    };

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        let _keep_alive = &webview;
        if let Event::WindowEvent { event: WindowEvent::CloseRequested, .. } = event {
            *control_flow = ControlFlow::Exit;
        }
    })
}

fn build_webview(window: &tao::window::Window, context: &mut wry::WebContext, shared: &Shared) -> wry::Result<wry::WebView> {
    use wry::http::Response;
    let protocol_state = shared.clone();
    wry::WebViewBuilder::new_with_web_context(context)
        .with_asynchronous_custom_protocol("memviz".into(), move |_id, request, responder| {
            let st = protocol_state.clone();
            let (path, query) = split_uri(&request.uri().to_string());
            #[cfg(debug_assertions)]
            eprintln!("memviz: {path}?{query}");
            // Off the UI thread: reading a memory or showing the folder dialog must not freeze it.
            std::thread::spawn(move || {
                let Reply { status, ctype, body } = state::route(&st, &path, &query, &pick_folder);
                let resp = Response::builder()
                    .status(status)
                    .header("Content-Type", ctype)
                    .header("Cache-Control", "no-store")
                    .body(body)
                    .unwrap_or_else(|_| Response::new(Vec::new()));
                responder.respond(resp);
            });
        })
        .with_url("memviz://localhost/")
        .with_devtools(cfg!(debug_assertions))
        .build(window)
}

fn serve_web(shared: Shared, port: u16) -> Result<(), String> {
    use tiny_http::{Header, Response, Server};
    let server = Server::http(("127.0.0.1", port)).map_err(|e| format!("no se pudo abrir el puerto {port}: {e}"))?;
    println!("memviz en http://127.0.0.1:{port}/  (Ctrl+C para salir)");
    for req in server.incoming_requests() {
        let (path, query) = split_uri(&format!("http://x{}", req.url()));
        let st = shared.clone();
        std::thread::spawn(move || {
            let Reply { status, ctype, body } = state::route(&st, &path, &query, &pick_folder);
            let header = |k: &str, v: &str| Header::from_bytes(k.as_bytes(), v.as_bytes()).expect("static header");
            let resp = Response::from_data(body)
                .with_status_code(status)
                .with_header(header("Content-Type", ctype))
                .with_header(header("Cache-Control", "no-store"));
            let _ = req.respond(resp);
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_urls_split_on_every_platform() {
        assert_eq!(split_uri("memviz://localhost/api/graph?m=p0"), ("/api/graph".into(), "m=p0".into()));
        assert_eq!(split_uri("http://memviz.localhost/"), ("/".into(), "".into()));
        assert_eq!(split_uri("http://memviz.localhost"), ("/".into(), "".into()));
        assert!(std::path::Path::new("/").has_root());
    }
}
