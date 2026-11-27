// Loads the engine modules and hands them to the UI scripts (classic, deferred,
// run after this in document order). The UI reads window.Core and window.Eng.
import Core from './core.js';
import * as Geom from './geom.js';
import * as Dxf from './dxf.js';
import * as Gcode from './gcode.js';
import * as Jobs from './jobs.js';
import * as Svg from './svgpath.js';
import * as Shapes from './shapes.js';
import * as Cam from './camera.js';

window.Core = Core;
window.Eng = Object.freeze({ ...Geom, ...Dxf, ...Gcode, ...Jobs, ...Svg, ...Shapes, ...Cam });
