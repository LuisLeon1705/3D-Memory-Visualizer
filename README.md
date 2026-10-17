# Memoria 3D (`memviz`)

App de escritorio para explorar memorias CTHG (`.cthg`) de cualquier repo, al estilo de la constelación de Lappland:

- **X · el árbol del repo es el cielo.** El centro ✦ es «todo el proyecto» (reglas sin ruta, núcleo); cada carpeta o archivo con recuerdos es un astro ✧, unido a su carpeta madre.
- **Y · el tiempo es la altura.** Lo más reciente flota más arriba sobre su astro.
- **Z · χ es la luz y la física.** +1 brillante y atado a su ruta; −1 tenue, translúcido y a la deriva.

Además, la app permite:
- marcar el núcleo (✦), lo anclado (punto blanco), lo consolidado (anillo dorado) y lo obsoleto (tachado);
- ver las aristas causa, contradice, sustituye, relación, menciona y precede;
- filtrar por tipo, núcleo, planes y obsoletos, y buscar texto;
- hacer clic en un recuerdo para ver su panel: χ con E y A, α/β, ruta, rama, commit, origen y vecinos.

## Abrir repos

- **＋ Abrir repo** (o `Ctrl+O`) abre un buscador.
  - Al arrancar, la app recorre tu carpeta de usuario en segundo plano y lista los repos git y las carpetas con memoria.
  - Escribe para filtrar; ↑/↓ y Enter para abrir.
  - Solo se abren los que tienen memoria (◆). Para los demás, ejecuta `cthg init` en esa carpeta.
- **Elegir carpeta…** abre el diálogo nativo para cualquier carpeta, aunque no sea un repo git. Sirve cualquier subcarpeta: se busca `.cthg/memoria.cthg` hacia arriba.
- Cada memoria es una pestaña con ×. La app recuerda los repos recientes y las pestañas abiertas en `~/.cthg/memviz.json`.
- La memoria global (`CTHG_GLOBAL` o `~/.cthg/global.cthg`) aparece sola si existe.

No hay rutas fijas: todo sale de lo que eliges, de tu carpeta de usuario y de las variables de entorno.

Es **de solo lectura**: puede estar abierta mientras los hooks escriben la memoria, y la vuelve a leer cada 15 s.

## Instalar

Instala `memviz` en `~/.cargo/bin`, que ya está en el PATH:

```bash
cargo install --path . --locked
```

Después se abre con `memviz` (o `memviz C:\ruta\al\repo` para empezar con ese repo abierto). Después de cambiar el código, repite `cargo install`.

Para depurar la interfaz, la misma app en el navegador:

```bash
cargo run -- --web --port 7979
```

## Detalles

- Ventana nativa con WebView2 (incluido en Windows 11). Páginas y datos pasan por el protocolo propio `memviz://`: no abre puertos.
- El perfil del WebView vive en `%LOCALAPPDATA%\memviz`.
- Teclas: `r` recoloca la cámara, `Esc` cierra paneles. Ratón: arrastrar gira, botón derecho o Mayús+arrastrar desplaza, rueda acerca, doble clic centra.
- Depende de `cthg-core` por ruta relativa (`../../3D-Memory/crates/cthg-core`). Si cambia el formato `.cthg`, hay que reinstalar.
