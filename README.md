# Burner

GRBL laser sender for **Linux (NixOS included) and Windows** (macOS should work too). Built for an Ortur diode laser, should work with any GRBL 1.1 machine in laser mode (`$32=1`).

The UI runs in your browser. A small Python bridge (standard library only, nothing to `pip install`) holds the serial port and serves the page.

## Run

**NixOS / Nix**

```
nix run github:j-davella/burner
```

Or add it to your system (this also puts you in `dialout` so the serial port opens):

```nix
# flake inputs:  burner.url = "github:j-davella/burner";
imports = [ burner.nixosModules.default ];
programs.burner = { enable = true; user = "you"; };
```

Without the module, add `extraGroups = [ "dialout" ];` to your user, rebuild, log out and back in.

**Windows**

Install Python 3 from python.org (tick "Add python.exe to PATH"), then double-click `burner.cmd`.

**Any Linux / macOS**

```
./burner.sh            # or: python3 burner_bridge.py --open
```

The browser opens http://localhost:8765. Pick the port, hit Connect.

Options: `--port 9000` (or env `BURNER_PORT`), `--open`, `--sim-speed 20`.

## Screen

STOP is always at the top right. The run bar along the bottom holds Frame / Start / Pause, the
time left, progress and the live speed / power / rapid overrides. The left rail has the select and
pan tools, zoom, add file and quick jumps; the right panel has tabs for the Job (files, objects,
generate), the selected Object (position, cut/score/fill settings, raster), the Machine (home,
jog, zero, frame) and the Console. Sections fold and remember it. Errors logged while the console
is hidden put a dot on its tab. HUD and Classic themes in Settings.

## Effects (3D view)

Press **T** (or the cube on the left rail) for a 3D view of the bed: a holographic grid with the
machine frame, a wireframe gantry and laser head, the beam glowing with live power, sparks, and
the toolpath burning in white-hot and cooling to charred as the job runs. Drag to orbit,
right-drag to pan, scroll to zoom, double-click to reset. The bar under the view replays the job
before you burn it (preview only, nothing is sent). Jobs switch to 3D when they start (turn that
off in Settings). Around the 2D bed there's a slow nebula and starfield; connecting warps the
stars, an alarm sweeps red across the map, a finished job sends out a shockwave, and the run bar
shows reactor-style power and speed rings.

Settings > Effects: **Full** (all of it), **Lite** (3D without glow/sparks, still backdrop) or
**Off** (plain 2D, no WebGL). If frames get slow, Full drops to Lite for that session. Sounds are
off by default. It's raw WebGL2 in `web/fx/fx.js`, isolated from everything else: if it ever
errors it switches itself off and the controls carry on. STOP, alarms and connection state are
never covered or delayed by an effect.

## Simulator

The port list always ends with **Simulator (no laser)**: a fake GRBL 1.1 inside the bridge. Use it to try the UI, plan a job, or check that a long file streams cleanly without a machine attached. It prints a loud `SIM RX OVERFLOW` message if the sender ever overruns GRBL's 127-byte buffer. `--sim-speed 20` runs it 20x faster than real time.

## Safety

- The bridge only listens on 127.0.0.1, only answers to `localhost` / `127.0.0.1` Host headers, and refuses WebSocket connections from pages it didn't serve, so a website can't reach your laser.
- If the browser tab dies or closes, the bridge sends feed hold + soft reset, so the laser shuts off.
- STOP / Esc = feed hold + soft reset. Kills the job and the laser, no reboot.
- Burner refuses to start a job if the controller reports `$32=0` (laser mode off).

There's also a Web Serial mode (Chrome, or Firefox 151+ if your policies allow it) that skips the bridge's serial port. The page still has to be served over http, so run the bridge (or any local web server).

## What it does

- Live head position on the bed map; burned lines turn green as the job runs
- Character-counted streaming (no buffer overruns / lockups)
- Pause/resume, live speed / rapid overrides mid-burn
- Time remaining + finish clock: estimated from move lengths, feeds and your accel ($120/$121), corrected live against the actual burn rate, follows the speed override, pauses don't count
- Live power control in absolute % of the laser (capped at 100%). A tweak lasts for the current operation, then the next op runs at its own setting
- Speeds in mm/s. Settings page: bed size, X/Y acceleration (mm/s², `$120`/`$121`) and max rates, written to the controller
- Material presets: save raster (LPI, speed, power, dither...) and vector (power, speed, passes) settings by name; export/import JSON
- Pauses on G-code errors, alarm bar with Unlock / Home
- Layout: add images, DXF, SVG. Move, scale, rotate, crop (images), duplicate, delete
- Objects list: check/uncheck what burns; "Burn only selected" to run one file at a time on a shared sheet
- Each image keeps its own raster settings; "Pick outer" / "Pick inner" select outline vs inside contours in one click
- Images raster with M4 dynamic power, optional dithering, bidirectional, overscan
- DXF: LINE, ARC, CIRCLE, LWPOLYLINE (bulges), POLYLINE, ELLIPSE, SPLINE. Uses `$INSUNITS`, assumes inches if unset. Explode blocks before export
- Per-contour operations on vectors: Cut, Score, Fill (hatch), Off. Click a contour to pick it, Shift-click to add. Each op has its own power / speed / passes
- Burn order: raster, fill, score, then cuts smallest-first so holes and inner parts go before the outline
- Touching DXF segments are joined into contours on import (SolidWorks exports rectangles as 4 LINEs)
- Frame the job (optionally at low power), save the G-code
- Test Lab: 10 one-inch test blocks (score, fill, cuts 1/16-3/8", grayscale, dither, power ramp) burned into a slot grid from W0. Each burn is logged; mark good/bad, add notes, save the winner as tuned per material. Tuned values build presets automatically ("Poplar 1/8\"", "Poplar dither"). Printable report + CSV

## Keys

Esc stop · Space pause/resume · `[` `]` speed -/+10% · `-` `=` power -/+10% · arrows jog (or nudge the selected object; Shift = 0.1 in) · Del deletes selected · F fits view

V select tool · H pan tool · T 3D view · P show/hide the side panel · 1-4 panel tabs (Job, Object, Machine, Console) · M machine · ` console · Ctrl+O add a file

Units in the UI are inches. Machine is driven in mm (`$13=0`).

## Code layout

```
burner_bridge.py      serial (termios / Win32) + simulator + WebSocket + static files
burner.cmd/.sh        launchers;  flake.nix = Nix package, app, NixOS module
web/index.html        page markup
web/css/burner.css    styles
web/engine/*.js       pure logic, ES modules, no DOM: core, geom, dxf, gcode, svgpath,
                      jobs (generate / import / load), worker (runs jobs off the UI thread)
web/ui/NN-*.js        UI scripts, loaded in order
web/fx/fx.js          effects + 3D view (WebGL2), isolated: never required by the app
tests/                golden G-code, fixtures, harnesses
```

## Speed

Generating, importing DXFs and loading G-code run in a Web Worker, so the UI, STOP and
streaming never freeze; long jobs show a progress bar with Cancel. The map draws from cached
paths and just scales the last frame while you zoom or pan. SVGs are flattened by Burner's own
path parser (linear time; the browser's `getPointAtLength` was quadratic).

Measured on the heavy fixtures (900x900 map, Chrome):

| | before | after |
|---|---|---|
| Zoom/pan frame, 1.3M-line raster job | 83 ms | 0.08 ms |
| UI frozen while generating that job | 1.6 s | 33 ms worst block |
| SVG import, 300 / 3000 curves | 128 s / hours | 30 ms / 130 ms |
| Contour hover/pick, 2100 contours | 0.6 ms | 0.02 ms |
| DXF import, 5700 pieces (UI thread) | 72 ms | 2 ms |

## Tests

What Burner sends to the laser is pinned by `tests/golden/golden.json`, captured from the
original single-file version: DXF, SVG, gray + dithered rasters, a combined layout, every Test
Lab block, the time estimate, the preview, and a 5700-piece DXF (joining, outer/inner picking,
contour hit tests). A change that alters the G-code shows up here.

```
node tests/engine.test.mjs        # engine + worker job path, no browser
node tests/join.test.mjs          # fast contour joiner == original, incl. 30 random dense layouts
python tests/capture_server.py    # serves the repo on :8799 and accepts POST /capture/<name>
```

Then open http://127.0.0.1:8799/web/index.html and run these in the console:

- `tests/golden-harness.js`: POST its result to `/capture/run`, then `python tests/compare_golden.py run` (byte-exact).
- `tests/svg-compare.js`: the SVG importer vs a 10x finer reference of the true shape (must be within 0.02 mm).
- `tests/perf-harness.js`: the timings above. `python tests/fixtures/make_heavy.py` regenerates the heavy fixtures.
