# Burner — upgrade plan (2026-11-26)

Status: phases 0, 1, 2, 3 and 3b done on branch `upgrade`. Next: 4 (machine robustness).
Note: 3b uses raw WebGL2 (web/fx/fx.js) instead of vendoring three.js: no download, nothing to trust, ~30 KB.

Decisions so far: keep the browser UI + stdlib Python bridge, polish the HUD
theme (not a redesign), add design tools, projects/history, camera alignment
and machine robustness. Main pain: cramped layout, lag on big files.

## Phase 0 — Safety net + split the file
- Golden G-code tests first: sample DXF/SVG/image + Test Lab blocks → save the
  G-code the current build makes. Every later phase must reproduce it byte for
  byte, or the diff is explained (this is what drives the laser).
- Split the 2000-line burner.html into `web/` (index.html, hud.css, ES modules:
  grbl, stream, layout, dxf, svg, raster, lab, ui). Still no build step and no npm.
  The bridge serves the folder.
- `--sim` fake GRBL in the bridge (buffer, status, alarms) so streaming can be
  tested on either OS with no laser attached.

## Phase 1 — Windows + NixOS
- Serial backends behind one interface: termios (Linux, as now) and Win32 via
  ctypes (CreateFile/DCB/timeouts, reader thread → asyncio). Still no pip.
- Port list on Windows from the registry (COMx + friendly USB names).
- Launchers: `burner.cmd` (Windows), `flake.nix` → `nix run github:j-davella/burner`,
  optional NixOS module (service + dialout note). `--open` launches the browser.
- Data dir per OS (~/.local/share/burner, %APPDATA%\Burner) for projects/history.

## Phase 2 — Speed
- Raster dithering, G-code generation and DXF/SVG parsing move to a Web Worker
  (UI never freezes; progress bar + cancel).
- Cached Path2D per object, layered canvases (bed / objects / burned / head),
  redraw only what changed, decimated preview for huge jobs.
- Faster contour picking (bounding-box index instead of testing every path).

## Phase 3 — HUD polish + decluttered layout
- Big canvas in the middle. Thin left tool rail (select, text, shapes, camera,
  jog). Right inspector with tabs: Object · Ops · Machine · Job; sections collapse.
- Bottom status strip: state, position, progress, ETA, power/speed overrides.
- Larger, readable type; one spacing scale; clear hover/focus/disabled states;
  STOP is always visible and never moves.

## Phase 3b — Deep-space 3D HUD (the big visual upgrade)
Built on WebGL with three.js vendored into the repo (one file, works offline,
no npm). Everything runs on the GPU, so it adds no lag to the burn.
- **3D bed.** The bed is a glowing holographic grid floating in space. Edit
  top-down (flat, precise), then one key/click swings the camera into a tilted
  3D view; orbit/zoom with the mouse. Preview and live burns default to 3D.
- **Laser head + beam.** A modeled head rides the gantry rails. When the laser
  fires, the beam glows with intensity from the live power (S value), with
  sparks/embers where it hits.
- **Burn trail.** Burned paths glow hot (white → orange) and cool to charred
  as the job runs; travel moves show as faint dotted arcs. Scrub a timeline to
  replay the job in 3D before burning.
- **Space backdrop.** Slow parallax starfield + nebula haze, subtle bloom/glow
  on HUD lines, scanlines and light chromatic shimmer.
- **Holographic panels.** Glass panels with depth, slight 3D tilt toward the
  mouse, edge glow, animated corner brackets; sections slide/unfold open.
- **Motion everywhere.** Boot sequence on launch (systems coming online),
  reactor-style power ring and speed gauge, animated counters for position/ETA,
  connect/disconnect "warp" transition, alarm = red pulse sweeping the HUD,
  job done = shockwave ring.
- **Sound (optional, off by default).** Soft UI blips, hum while burning.
- **Controls:** Effects slider Full / Lite / Off (auto-drops to Lite if the
  frame rate falls; Off = today's 2D canvas). Respects reduced-motion.
- **Safety rule:** STOP, alarms and the connection state are never animated
  away, blurred, delayed or hidden behind effects.

## Phase 4 — Machine robustness
- Machine profiles (bed, accel, $-settings, port, baud), switch in one click.
- USB drop → laser treated as stopped, reconnect automatically, never auto-resume.
- Alarm/error codes in plain English with the fix; homing/limit handling.
- Resume-from-line after a stop (with a warning + position check).
- Air assist M7/M8 per operation.

## Phase 5 — Design tools
- Undo/redo for everything on the bed.
- Shapes: rect / rounded rect / circle / polygon / star.
- Text: bundled open fonts + load your own TTF/OTF, plus single-line fonts for
  scoring.
- Align / distribute, snapping (grid, edges, centers), grid & circular arrays,
  simple sheet nesting.

## Phase 6 — Projects & job history
- `.burner` project file (layout, ops, embedded images), autosave + crash recovery,
  recent list.
- Job history per machine: thumbnail, settings, time, result; re-run in one click.

## Phase 7 — Camera alignment
- USB camera via the browser; calibrate by burning 4 marks and clicking them
  (perspective fix); live overlay on the bed with opacity; place art on scrap.

Each phase gets its own commit on a branch. Nothing is pushed until you say so.
