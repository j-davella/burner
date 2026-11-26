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

Units in the UI are inches. Machine is driven in mm (`$13=0`).

## Code layout

```
burner_bridge.py      serial (termios / Win32) + simulator + WebSocket + static files
burner.cmd/.sh        launchers;  flake.nix = Nix package, app, NixOS module
web/index.html        page markup
web/css/burner.css    styles
web/engine/*.js       pure G-code logic, ES modules, no DOM: core, geom, dxf, gcode
web/ui/NN-*.js        UI scripts, loaded in order
tests/                golden G-code, fixtures, harness
```

## Tests

What Burner sends to the laser is pinned by `tests/golden/golden.json`, captured from the
original single-file version (DXF, SVG, gray + dithered rasters, a combined layout, every
Test Lab block, the time estimate and the preview). A change that alters the G-code shows up here.

```
node tests/engine.test.mjs                 # engine only, no browser
python tests/capture_server.py             # then open http://127.0.0.1:8799/web/index.html and run
                                           # tests/golden-harness.js in the console, POST the result
                                           # to /capture/split, then:
python tests/compare_golden.py split       # byte-exact diff of everything the app generates
```
