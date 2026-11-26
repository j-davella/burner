#!/usr/bin/env python3
"""Compare a captured harness run (tests/out/<name>.json) to tests/golden/golden.json.
Usage: python tests/compare_golden.py split"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
gold = json.load(open(os.path.join(HERE, "golden", "golden.json")))
name = sys.argv[1] if len(sys.argv) > 1 else "split"
got = json.load(open(os.path.join(HERE, "out", name + ".json")))
bad = 0
for k in sorted(set(gold) | set(got)):
    a, b = gold.get(k), got.get(k)
    if a == b:
        print("  ok   %-18s %7d lines" % (k, len(a)))
        continue
    bad += 1
    if a is None or b is None:
        print("  FAIL %-18s missing on one side" % k)
        continue
    i = next((i for i, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
    print("  FAIL %-18s golden %d lines, got %d; first diff at line %d:" % (k, len(a), len(b), i + 1))
    print("         golden: %s" % (a[i] if i < len(a) else "<end>"))
    print("         got:    %s" % (b[i] if i < len(b) else "<end>"))
print("\n%s: %d of %d cases differ" % ("FAIL" if bad else "PASS", bad, len(set(gold) | set(got))))
sys.exit(1 if bad else 0)
