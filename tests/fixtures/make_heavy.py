#!/usr/bin/env python3
"""Generate the heavy perf fixtures (deterministic). Run from anywhere:
    python tests/fixtures/make_heavy.py
heavy.dxf : 1200 rectangles as 4 shuffled LINEs each (like a SolidWorks export),
            600 circles, 200 bulged slots, 100 splines  -> stresses joining + picking
heavy.svg : one long path of 3000 cubic curves + 400 circles + rotated groups
medium.svg: same recipe, 300 curves + 40 circles (old SVG import takes minutes on heavy.svg)
"""
import math, os, random

HERE = os.path.dirname(os.path.abspath(__file__))
rnd = random.Random(1234)


def dxf():
    L = []
    g = lambda c, v: L.extend([str(c), str(v)])
    g(0, "SECTION"); g(2, "HEADER"); g(9, "$INSUNITS"); g(70, 4); g(0, "ENDSEC")   # mm
    g(0, "SECTION"); g(2, "ENTITIES")
    ents = []
    for i in range(40):
        for j in range(30):
            x, y, w, h = i * 9.0, j * 9.0, 6 + rnd.random() * 2, 5 + rnd.random() * 2
            pts = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
            for k in range(4):
                a, b = pts[k], pts[(k + 1) % 4]
                if rnd.random() < 0.5:
                    a, b = b, a                      # random direction, like real exports
                ents.append(("LINE", a, b))
    for k in range(600):
        ents.append(("CIRCLE", (rnd.random() * 360, rnd.random() * 270), 0.5 + rnd.random() * 1.5))
    for k in range(200):
        x, y = rnd.random() * 350, rnd.random() * 260
        ents.append(("SLOT", x, y))
    for k in range(100):
        x, y = rnd.random() * 340, rnd.random() * 250
        ents.append(("SPLINE", [(x + t * 3, y + rnd.random() * 4) for t in range(6)]))
    rnd.shuffle(ents)
    for e in ents:
        if e[0] == "LINE":
            g(0, "LINE"); g(8, 0); g(10, "%.4f" % e[1][0]); g(20, "%.4f" % e[1][1]); g(11, "%.4f" % e[2][0]); g(21, "%.4f" % e[2][1])
        elif e[0] == "CIRCLE":
            g(0, "CIRCLE"); g(8, 0); g(10, "%.4f" % e[1][0]); g(20, "%.4f" % e[1][1]); g(40, "%.4f" % e[2])
        elif e[0] == "SLOT":
            x, y = e[1], e[2]
            g(0, "LWPOLYLINE"); g(8, 0); g(90, 4); g(70, 1)
            for px, py, b in [(x, y, 0), (x + 6, y, 1), (x + 6, y + 2, 0), (x, y + 2, 1)]:
                g(10, "%.4f" % px); g(20, "%.4f" % py)
                if b: g(42, b)
        else:
            cps = e[1]
            g(0, "SPLINE"); g(8, 0); g(71, 3); g(72, len(cps) + 4); g(73, len(cps))
            kn = [0, 0, 0, 0] + [k / (len(cps) - 3) for k in range(1, len(cps) - 3)] + [1, 1, 1, 1]
            for k in kn: g(40, "%.6f" % k)
            for px, py in cps: g(10, "%.4f" % px); g(20, "%.4f" % py); g(30, 0)
    g(0, "ENDSEC"); g(0, "EOF")
    open(os.path.join(HERE, "heavy.dxf"), "w", newline="\n").write("\n".join(L) + "\n")


def svg(name="heavy.svg", curves=3000, circles=400):
    d = ["M 10 10"]
    x, y = 10.0, 10.0
    for k in range(curves):
        nx, ny = 10 + (k % 60) * 5 + rnd.random(), 10 + (k // 60) * 5 + rnd.random()
        d.append("C %.2f %.2f %.2f %.2f %.2f %.2f" % (x + 2, y - 3, nx - 2, ny + 3, nx, ny))
        x, y = nx, ny
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="320mm" height="270mm" viewBox="0 0 320 270">',
             '<path d="%s" fill="none" stroke="#000"/>' % " ".join(d)]
    for k in range(circles):
        parts.append('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="none" stroke="#000"/>' % (rnd.random() * 310 + 5, rnd.random() * 260 + 5, 0.5 + rnd.random() * 2))
    for k in range(40):
        parts.append('<g transform="translate(%.1f %.1f) rotate(%d)"><rect x="0" y="0" width="12" height="6" rx="1" fill="none" stroke="#000"/></g>' % (rnd.random() * 280 + 20, rnd.random() * 230 + 20, rnd.randrange(360)))
    parts.append("</svg>")
    open(os.path.join(HERE, name), "w", newline="\n").write("\n".join(parts) + "\n")


if __name__ == "__main__":
    dxf()
    svg()
    svg("medium.svg", 300, 40)
    print("wrote heavy.dxf, heavy.svg, medium.svg")
