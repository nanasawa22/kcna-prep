#!/usr/bin/env python3
"""Extract the canonical English *study content* catalog for translation.

The UI catalog (tools/i18n-catalog.json, from extract-i18n.py) covers app
chrome. This covers the other half: the notes, flashcards, questions, glossary
definitions and reference blurbs that live in data/*.js.

Every unit is addressed by a stable key so a translation pack can be verified
for coverage and applied without depending on array order:

    domain:<domainId>:note:<noteId>:<field>          field = topic|title|html
    domain:<domainId>:card:<cardId>:<field>          field = topic|front|back
    domain:<domainId>:question:<qId>:<field>         field = topic|question|explanation
    domain:<domainId>:question:<qId>:option:<index>
    glossary:<term>:definition
    reference:<domainId>:<url>:note

Deliberately NOT extracted (they stay English on purpose):
  - domain names — the KCNA exam blueprint's own wording
  - glossary terms — the term being defined
  - reference titles — the official document's real title
  - every Kubernetes / CNCF API object name inside the text

Writes tools/content-catalog.json:
    { "units": [ {"key": ..., "en": ...}, ... ], "counts": {...} }
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The data files are plain JS that call KCNA.register(...). Rather than
# re-implement a JS parser, shell out to node with a stub registry and get
# JSON back. node is already a dev dependency (`make lint` runs node --check).
HARVEST = r"""
global.window = global;
const domains = [], refs = {}, glossary = [];
global.KCNA = {
  register: (d) => domains.push(d),
  registerReferences: (id, r) => { (refs[id] = refs[id] || []).push(...(r || [])); },
  registerGlossary: (t) => glossary.push(...(t || [])),
};
for (const f of ['fundamentals', 'orchestration', 'architecture', 'delivery', 'references', 'glossary']) {
  require(process.argv[1] + '/data/' + f + '.js');
}
process.stdout.write(JSON.stringify({ domains, refs, glossary }));
"""


def harvest():
    out = subprocess.run(
        ["node", "-e", HARVEST, ROOT.replace("\\", "/")],
        capture_output=True, text=True, encoding="utf-8",
    )
    if out.returncode != 0:
        sys.exit("node failed to read data/:\n" + out.stderr)
    return json.loads(out.stdout)


def main():
    data = harvest()
    units = []

    def add(key, text):
        if text and str(text).strip():
            units.append({"key": key, "en": text})

    for d in data["domains"]:
        did = d["id"]
        for n in d.get("notes", []):
            base = f"domain:{did}:note:{n['id']}:"
            for field in ("topic", "title", "html"):
                add(base + field, n.get(field))
        for c in d.get("flashcards", []):
            base = f"domain:{did}:card:{c['id']}:"
            for field in ("topic", "front", "back"):
                add(base + field, c.get(field))
        for q in d.get("questions", []):
            base = f"domain:{did}:question:{q['id']}:"
            for field in ("topic", "question", "explanation"):
                add(base + field, q.get(field))
            for i, opt in enumerate(q.get("options", [])):
                add(f"{base}option:{i}", opt)

    for t in data["glossary"]:
        add(f"glossary:{t['term']}:definition", t.get("definition"))

    for did, refs in data["refs"].items():
        for r in refs:
            add(f"reference:{did}:{r['url']}:note", r.get("note"))

    counts = {
        "domains": len(data["domains"]),
        "notes": sum(len(d.get("notes", [])) for d in data["domains"]),
        "flashcards": sum(len(d.get("flashcards", [])) for d in data["domains"]),
        "questions": sum(len(d.get("questions", [])) for d in data["domains"]),
        "glossary": len(data["glossary"]),
        "references": sum(len(v) for v in data["refs"].values()),
        "units": len(units),
        "chars": sum(len(u["en"]) for u in units),
    }

    out_path = os.path.join(ROOT, "tools", "content-catalog.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"units": units, "counts": counts}, f, ensure_ascii=False, indent=2)
    print(f"{counts['units']} units / {counts['chars']} chars -> tools/content-catalog.json")
    for k in ("notes", "flashcards", "questions", "glossary", "references"):
        print(f"  {k:<12} {counts[k]}")


if __name__ == "__main__":
    main()
