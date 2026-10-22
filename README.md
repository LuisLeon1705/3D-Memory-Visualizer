# Memoria 3D (`memviz`)

[![GitHub](https://img.shields.io/badge/GitHub-3D--Memory--Visualizer-24292f?style=flat-square&logo=github)](https://github.com/LuisLeon1705/3D-Memory-Visualizer)
[![Core Engine](https://img.shields.io/badge/Core_Engine-3D_Memory-0969da?style=flat-square)](https://github.com/LuisLeon1705/3D_Memory)

Aplicación nativa de escritorio (y modo web de desarrollo) para explorar de forma interactiva grafos de memoria **CTHG (`.cthg`)** generados por [`3D-Memory` (`cthg`)](https://github.com/LuisLeon1705/3D_Memory), representados como una constelación tridimensional inspirada en la estética estelar de Lappland.

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

### Navegación 3D y Capas
| Acción | Control |
| :--- | :--- |
| **Rotar cámara (orbitar)** | Clic izquierdo + arrastrar |
| **Desplazar cámara (*pan*)** | Clic derecho + arrastrar (o `Mayús` + arrastrar) |
| **Acercar / alejar (*zoom*)** | Rueda del ratón |
| **Centrar en un astro o recuerdo** | Doble clic sobre el nodo o astro |
| **Inspeccionar recuerdo** | Clic izquierdo sobre un recuerdo (abre panel lateral con $\chi$, $E$, $A$, $\alpha/\beta$, ruta, etc. e ilumina el **alcance de la regla**) |
| **Inspeccionar archivo de código** | Clic izquierdo sobre un astro de archivo (abre panel con `file_map`: reglas ancladas, en vecinos, importaciones y símbolos con firma) |
| **Recolocar cámara inicial** | Tecla `R` |
| **Abrir buscador de repositorios** | `Ctrl + O` (o botón **＋ Abrir repo**) |
| **Cerrar paneles o modales** | Tecla `Esc` |

### Capas activables (Fase 8e)
- **Memoria**: Recuerdos de la constelación situados a la altura de su tiempo de aprendizaje ($Y$) y gobernados por su confianza ($\chi$).
- **Código**: Todos los archivos indexados representados como astros en el plano horizontal ($X$), dentro del mismo árbol jerárquico. Los archivos con reglas activas brillan con mayor intensidad; los que no tienen reglas lucen tenues; los archivos con error de escaneo llevan un indicador visual de alerta. Si un repositorio supera los 2.000 archivos, la vista se agrega automáticamente por carpetas.
- **Importaciones**: Líneas finas entre archivos que representan dependencias resueltas directas.
- **Llamadas**: Aristas entre archivos con grosor proporcional a la cantidad de llamadas entre sus símbolos (aisladas por familias de lenguajes y sin ambigüedades).
- **Aviso de «sin índice»**: `memviz` es **estrictamente de solo lectura** respecto a `.cthg/indice.tsv` (nunca lo genera ni modifica). Si un proyecto no dispone de índice o está corrupto, la capa de código muestra el aviso «sin índice: ejecuta `cthg index` en el repo» sin interrumpir la exploración de la memoria causal.

### Alcance de una regla
Al seleccionar una regla o recuerdo anclado a una ruta, `memviz` ilumina de inmediato su **alcance completo**: el archivo o carpeta donde está anclada, todos los archivos que dependen de él o de los que depende (vecinos a 1 salto) y los enlaces de importación que los unen, atenuando el resto de la constelación. Esto permite ver con precisión a qué componentes afecta una regla antes de preparar un prompt.

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
│   ├── graph.rs         # Proyección de `.cthg` a JSON con `View::all()` (vista omnisciente)
│   └── code.rs          # Proyección de `.cthg/indice.tsv` a JSON (/api/code y /api/file) con capas y agregación
└── web/
    ├── index.html       # Estructura de barra de pestañas, filtros, lienzo 3D, buscador y panel de detalle
    ├── style.css        # Estilos oscuros de alto contraste para la constelación y paneles
    ├── app.js           # Gestión de pestañas, refresco cada 15 s, buscador de repos, filtros y panel lateral
    └── view3d.js        # Motor de renderizado Canvas 3D, física de constelación (X, Y, Z) y cámara orbital
```

- **Sin puertos en modo escritorio**: la aplicación nativa se comunica íntegramente a través del protocolo personalizado `memviz://localhost/...` fuera del hilo de UI.
- **Perfil aislado de WebView2**: se almacena en `%LOCALAPPDATA%\memviz\WebView2` (con *fallback* por PID si hay varias ventanas abiertas), evitando bloqueos de archivos en carpetas sincronizadas como OneDrive.
