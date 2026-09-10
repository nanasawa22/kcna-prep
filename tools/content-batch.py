#!/usr/bin/env python3
"""Print a slice of the content catalog as JSON, for translating batch by batch.

    python tools/content-batch.py <part> [kind] [start] [limit]

<part> = fundamentals|orchestration|architecture|delivery|glossary|references
[kind] = note|card|question  (domain parts only; omit or 'all' for everything)

Already-translated keys (present under tools/content-src/<lang>/) are skipped,
so re-running after a batch always yields the next untranslated slice.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LANG = os.environ.get("PACK_LANG", "ja")


def part_of(k):
    if k.startswith("glossary:"):
        return "glossary", "glossary"
    if k.startswith("reference:"):
        return "references", "references"
    bits = k.split(":")
    return bits[1], bits[2]


def done_keys():
    d = os.path.join(ROOT, "tools", "content-src", LANG)
    keys = set()
    if os.path.isdir(d):
        for n in sorted(os.listdir(d)):
            if n.endswith(".json"):
                with open(os.path.join(d, n), encoding="utf-8") as f:
                    keys |= set(json.load(f).keys())
    return keys


def main():
    part = sys.argv[1]
    kind = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != "all" else None
    start = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    limit = int(sys.argv[4]) if len(sys.argv) > 4 else 40

    with open(os.path.join(ROOT, "tools", "content-catalog.json"), encoding="utf-8") as f:
        units = json.load(f)["units"]

    have = done_keys()
    sel = [u for u in units
           if part_of(u["key"])[0] == part
           and (kind is None or part_of(u["key"])[1] == kind)
           and u["key"] not in have]

    batch = sel[start:start + limit]
    print(json.dumps({u["key"]: u["en"] for u in batch}, ensure_ascii=False, indent=1))
    print(f"\n// batch {len(batch)} units, {sum(len(u['en']) for u in batch)} chars"
          f" | {len(sel) - start - len(batch)} left untranslated in {part}/{kind or 'all'}",
          file=sys.stderr)


if __name__ == "__main__":
    main()
