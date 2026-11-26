# Burner

GRBL laser sender for Linux. Built for an Ortur diode laser, should work with any GRBL 1.1 machine in laser mode (`$32=1`).

## Run

```
python3 burner_bridge.py
```

Open http://localhost:8765 in any browser, pick the port, hit Connect.

The bridge is stdlib-only Python (no pip installs). It holds the serial port, serves the page, only listens on localhost, and refuses WebSocket connections from other origins. If the browser tab dies, it sends feed hold + soft reset so the laser shuts off.

Not in `dialout`? On NixOS add `extraGroups = [ "dialout" ];` to your user, rebuild, log out and back in.

There's also a Web Serial mode (Chrome, or Firefox 151+ if your policies allow it) that skips the bridge.

## What it does

- Live head position on the bed map; burned lines turn green as the job runs
- Character-counted streaming (no buffer overruns / lockups)
- STOP / Esc = feed hold + soft reset. Kills the job and the laser, no reboot
- Pause/resume, live speed / power / rapid overrides mid-burn
- Speeds in mm/s. Settings page: bed size, X/Y acceleration (mm/s², `$120`/`$121`) and max rates, written to the controller
- Material presets: save raster (LPI, speed, power, dither...) and vector (power, speed, passes) settings by name; export/import JSON
- Pauses on G-code errors, alarm bar with Unlock / Home
- Layout: add images, DXF, SVG. Move, scale, rotate, crop (images), duplicate, delete
- Images raster with M4 dynamic power, optional dithering, bidirectional, overscan
- DXF: LINE, ARC, CIRCLE, LWPOLYLINE (bulges), POLYLINE, ELLIPSE, SPLINE. Uses `$INSUNITS`, assumes inches if unset. Explode blocks before export
- Vectors burn after the raster, with per-object power / speed / passes
- Frame the job (optionally at low power), save the G-code

## Keys

Esc stop · Space pause/resume · `[` `]` speed -/+10% · `-` `=` power -/+10% · arrows jog (or nudge the selected object; Shift = 0.1 in) · Del deletes selected · F fits view

Units in the UI are inches. Machine is driven in mm (`$13=0`).
