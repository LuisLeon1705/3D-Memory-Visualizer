# Memoria 3D (`memviz`)

Aplicación nativa de escritorio (y modo web de desarrollo) para explorar de forma interactiva grafos de memoria **CTHG (`.cthg`)** generados por [`3D-Memory`](../3D-Memory/README.md), representados como una constelación tridimensional inspirada en la estética estelar de Lappland.

Es **estrictamente de solo lectura**: nunca modifica ningún archivo `.cthg`, por lo que puede permanecer abierta mientras los hooks de Claude Code o Google Antigravity actualizan la memoria en vivo (refrescando automáticamente la vista cada **15 segundos**).

---

## Modelo visual de tres ejes

La constelación proyecta directamente las tres dimensiones matemáticas del motor `cthg-core`:

1. **Eje X · El árbol del repositorio es el cielo (plano horizontal)**
   - El astro central **`✦`** representa **todo el proyecto** (reglas transversales sin ruta y el núcleo `CORE`).
   - Cada carpeta o archivo con recuerdos asociados es un astro **`✧`** en el plano celeste, enlazado mediante líneas de constelación a su carpeta madre.
   - Las ramas del árbol de directorios se distribuyen radialmente en abanico proporcional al volumen de recuerdos que cuelgan de ellas.
2. **Eje Y · El tiempo es la altura (eje vertical)**
   - Los recuerdos más recientes flotan a mayor altura sobre su astro correspondiente, mostrando de un vistazo la evolución cronológica de cada módulo.
3. **Eje Z · La confianza ($\chi \in [-1, 1]$) gobierna la luz y la física**
   - **$\chi \to +1$ (verificado / dorado brillante)**: nodo luminoso y firmemente atraído a la vertical de su astro.
   - **$\chi \approx 0$ (sin evidencia / gris neutro)**: brillo y atracción intermedios.
   - **$\chi \to -1$ (dudoso o descartado / carmesí tenue)**: nodo translúcido y con mínima atracción gravitatoria que deriva hacia el exterior.

---

## Simbología, nodos y aristas

### Colores por tipo de recuerdo (`kind`)
| Tipo | Color | Uso principal |
| :--- | :--- | :--- |
| **`regla`** | Dorado (`#f0b44c`) | Normas obligatorias o prohibiciones sobre una ruta o el proyecto |
| **`decision`** | Violeta (`#9b8cff`) | Decisiones de diseño o arquitectura tomadas en el repositorio |
| **`hecho`** | Azul cielo (`#5fb3d9`) | Hechos comprobables sobre la estructura o comportamiento del código |
| **`incidente`** | Coral (`#ff6b6b`) | Bugs, panics o fallos pasados que originaron reglas o decisiones |
| **`convencion`** | Verde (`#7fd18b`) | Estilo de código, idioma o nomenclatura |
| **`plan`** | Magenta (`#e879f9`) | Trabajo futuro (`POTENTIAL`, invisible en la vista normal hasta cumplirse) |
| **`comando`** | Turquesa (`#3fd6c8`) | Comandos de compilación, test, linter o verificación |
| **`sesion`** | Gris acero (`#969caa`) | Resúmenes de sesión |

### Marcas de estado (`flags`) y aristas
- **Núcleo (`CORE`)**: estrella **`✦`** — se inyecta siempre en el canal 0 al iniciar sesión.
- **Anclado (`ANCHORED`)**: núcleo blanco brillante — verificado contra el repositorio por `cthg verify`.
- **Consolidado (`CONSOLIDATED`)**: anillo dorado exterior — respaldado por evidencia repetida ($\Delta(\alpha + \beta) \ge 3, A \ge 0{,}6$).
- **Obsoleto (`STALE`)**: etiqueta tachada — la ruta, símbolo o bloque original ya no existe en el repositorio.
- **Aristas**: `causa` (dorado continuo), `relacion` (azul), `menciona` (gris), `precede` (turquesa), `contradice` (rojo discontinuo) y `sustituye` (púrpura discontinuo), además de **hiperaristas** que agrupan incidentes o PRs.

---

## Instalación y uso

Requiere Rust estable y **WebView2** (incluido de serie en Windows 11):

```bash
# Instalar `memviz` en ~/.cargo/bin (disponible en el PATH)
cargo install --path . --locked

# Ejecutar tests y linter
cargo test
cargo clippy --all-targets
```

### Comandos del binario `memviz`

```bash
# Abrir la ventana nativa (restaura las pestañas de la última sesión)
memviz

# Abrir directamente uno o varios repositorios específicos
memviz C:\ruta\al\repo

# Modo de desarrollo: servir la misma aplicación en http://127.0.0.1:7979
memviz --web [--port 7979]
```

*(Nota: si se modifica `cthg-core` o el código de `memviz`, vuelve a ejecutar `cargo install --path . --locked`).*

---

## Controles e interfaz

### Navegación 3D
| Acción | Control |
| :--- | :--- |
| **Rotar cámara (orbitar)** | Clic izquierdo + arrastrar |
| **Desplazar cámara (*pan*)** | Clic derecho + arrastrar (o `Mayús` + arrastrar) |
| **Acercar / alejar (*zoom*)** | Rueda del ratón |
| **Centrar en un astro o recuerdo** | Doble clic sobre el nodo o astro |
| **Inspeccionar recuerdo** | Clic izquierdo sobre un nodo (abre el panel lateral con $\chi$, $E$, $A$, $\alpha/\beta$, ruta, rama, commit, origen y vecinos) |
| **Recolocar cámara inicial** | Tecla `R` |
| **Abrir buscador de repositorios** | `Ctrl + O` (o botón **＋ Abrir repo**) |
| **Cerrar paneles o modales** | Tecla `Esc` |

### Gestión de repositorios y pestañas
- **Escaneo automático en segundo plano**: al arrancar, `memviz` recorre tu directorio de usuario (`USERPROFILE` / `HOME` hasta profundidad 6, omitiendo `node_modules`, `target`, `.git`, etc.) y lista todos los repositorios git y carpetas con memoria `.cthg`.
- **Selector nativo (`Elegir carpeta…`)**: permite abrir cualquier carpeta o subcarpeta; `memviz` asciende automáticamente hasta encontrar `.cthg/memoria.cthg`.
- **Memoria global**: si existe `~/.cthg/global.cthg` (o la ruta definida en `CTHG_GLOBAL`), se muestra automáticamente en su propia pestaña `global`.
- **Persistencia**: las pestañas abiertas y los últimos 15 repositorios recientes se guardan en `~/.cthg/memviz.json`.

---

## Arquitectura del proyecto

```text
3D-Memory-Visualizer/
├── Cargo.toml           # Dependencias: cthg-core (path), tao, wry, rfd, tiny_http, serde_json
├── src/
│   ├── main.rs          # Ventana nativa (tao + wry), protocolo `memviz://` asíncrono y servidor `--web`
│   ├── state.rs         # Estado compartido, escáner de repos en background y router unificado (/api/*)
│   └── graph.rs         # Proyección de `.cthg` a JSON con `View::all()` (vista omnisciente)
└── web/
    ├── index.html       # Estructura de barra de pestañas, filtros, lienzo 3D, buscador y panel de detalle
    ├── style.css        # Estilos oscuros de alto contraste para la constelación y paneles
    ├── app.js           # Gestión de pestañas, refresco cada 15 s, buscador de repos, filtros y panel lateral
    └── view3d.js        # Motor de renderizado Canvas 3D, física de constelación (X, Y, Z) y cámara orbital
```

- **Sin puertos en modo escritorio**: la aplicación nativa se comunica íntegramente a través del protocolo personalizado `memviz://localhost/...` fuera del hilo de UI.
- **Perfil aislado de WebView2**: se almacena en `%LOCALAPPDATA%\memviz\WebView2` (con *fallback* por PID si hay varias ventanas abiertas), evitando bloqueos de archivos en carpetas sincronizadas como OneDrive.
