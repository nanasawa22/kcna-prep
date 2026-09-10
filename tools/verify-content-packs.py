#!/usr/bin/env python3
"""Verify the generated study-content packs in data/i18n/<code>/.

Checks, per language:
  - every part file parses as ContentI18n.register("code", "part", { ...JSON... })
  - every key it declares exists in tools/content-catalog.json (no stale keys)
  - each key lands in the part file it belongs to
  - the translation preserves the source's HTML tags (same tags, same counts) —
    a dropped </strong> or <code> would corrupt the rendered note. Order is NOT
    checked: target word order legitimately moves inline tags within a <li>.
  - Kubernetes / CNCF API object names present in the English are still present
    (compared case-insensitively: casing is a translation style choice)
  - the translation is not byte-identical to the English (rough "did it run")
  - no Latin-script word appears in the translation that is absent from the
    English source ("leaked" source words the translator forgot to convert)
  - coverage against the catalog

Exits non-zero on a structural break, a stale key, an HTML mismatch, or a
dropped API object name. Missing translations are reported but are NOT fatal:
ContentI18n falls back to English per key, so a partial pack is valid.

    python tools/verify-content-packs.py [lang ...]
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARTS = ["fundamentals", "orchestration", "architecture", "delivery", "glossary", "references"]

# Names that must survive translation verbatim wherever the English uses them:
# these are what the English-only exam actually shows.
KEEP_TERMS = [
    "Kubernetes", "KCNA", "CNCF", "Pod", "Deployment", "ReplicaSet", "StatefulSet",
    "DaemonSet", "Service", "Ingress", "ConfigMap", "Secret", "Namespace", "Node",
    "kubelet", "kube-proxy", "kube-scheduler", "kube-apiserver", "etcd", "CRI", "CNI",
    "CSI", "RBAC", "Helm", "Kustomize", "Argo CD", "Flux", "GitOps", "Prometheus",
    "Grafana", "OpenTelemetry", "OCI", "containerd", "NetworkPolicy", "HPA", "VPA",
    "PersistentVolume", "PersistentVolumeClaim", "StorageClass", "Job", "CronJob",
    "kubectl", "Knative", "Istio", "Linkerd", "PromQL",
]

# English phrases in which a KEEP_TERMS word is a common noun, not the API
# object — e.g. "Continuous Deployment" is the CD practice, not a Deployment.
AMBIGUOUS = [
    "Continuous Delivery/Deployment", "Continuous Deployment", "continuous deployment",
    "Deployment/Deployment",
    # "Service mesh" at the start of a sentence is the concept, not the Service
    # API object — translations may lowercase it as the concept name.
    # Phrases are stripped case-insensitively, so one spelling covers all.
    "Service mesh", "Service Level", "service-to-service", "Service discovery",
    "Service type", "Service abstraction", "Node.js", "Node pool", "Node group",
]


def part_for(key):
    if key.startswith("glossary:"):
        return "glossary"
    if key.startswith("reference:"):
        return "references"
    if key.startswith("domain:"):
        return key.split(":", 2)[1]
    return None


def tags(s):
    """Multiset of HTML tags, whitespace-normalized, order-insensitive."""
    return sorted(re.sub(r"\s+", " ", t) for t in re.findall(r"<[^>]+>", s))


# Latin words that legitimately appear in a translation without being in the
# English source of that same unit (romanized product names, units, etc.).
ALLOWED_EXTRA = {
    "kubernetes", "cncf", "kcna", "oci", "cri", "cni", "csi", "rbac", "api",
    "http", "https", "dns", "ip", "tls", "yaml", "json", "cpu", "gpu", "os",
    "sdk", "cli", "url", "id", "ids", "sla", "sli", "slo", "ci", "cd", "vm",
    "vms", "l3", "l4", "l7", "v1", "v3", "mtls", "notes", "pod", "pods",
    # Kubernetes nouns and verbs kept in English inside Japanese prose.
    "networkpolicy", "persistentvolumeclaim", "persistentvolume", "storageclass",
    "namespace", "namespaces", "capability", "capabilities", "spec", "specs",
    "pull", "push", "admit", "graduated", "incubating", "sandbox", "spanid",
    "traceid", "controller", "controllers", "label", "labels", "selector",
}


def _words(s):
    """Bare Latin words, lowercased and de-pluralized, tokenized identically on
    both sides so 'kube-proxy' compares as {kube, proxy} either way."""
    out = set()
    for w in re.findall(r"[A-Za-z]{2,}", s):
        w = w.lower()
        out.add(w)
        if w.endswith("s"):
            out.add(w[:-1])       # plural -> singular
        else:
            out.add(w + "s")
        if w.endswith("es"):
            out.add(w[:-2])
    return out


def leaked_english(src, tgt):
    """Latin-script words in the translation that the English source lacks.

    Advisory: these are almost always a phrase the translator left in English
    by accident, but a legitimate romanization can trip it too.
    """
    known = _words(src) | ALLOWED_EXTRA
    return sorted({w for w in re.findall(r"[A-Za-z]{2,}", tgt)
                   if w.lower() not in known})


def load_part(lang, part):
    path = os.path.join(ROOT, "data", "i18n", lang, part + ".js")
    if not os.path.exists(path):
        return None, "missing file"
    text = open(path, encoding="utf-8").read()
    m = re.search(r'ContentI18n\.register\(\s*"' + lang + r'"\s*,\s*"' + part +
                  r'"\s*,\s*(\{.*\})\s*\)\s*;', text, re.DOTALL)
    if not m:
        return None, "could not find ContentI18n.register({...}) block"
    try:
        return json.loads(m.group(1)), None
    except json.JSONDecodeError as e:
        return None, f"JSON parse error: {e}"


def main():
    with open(os.path.join(ROOT, "tools", "content-catalog.json"), encoding="utf-8") as f:
        catalog = json.load(f)
    en = {u["key"]: u["en"] for u in catalog["units"]}

    langs = sys.argv[1:] or sorted(
        d for d in os.listdir(os.path.join(ROOT, "data", "i18n"))
        if os.path.isdir(os.path.join(ROOT, "data", "i18n", d))
    ) if os.path.isdir(os.path.join(ROOT, "data", "i18n")) else []
    if not langs:
        print("no content packs under data/i18n/ — nothing to verify")
        return 0

    fatal = False
    print(f"Catalog: {len(en)} units\n")
    for lang in langs:
        pack, broken, stale, misfiled, html_break, dropped, identical = {}, [], [], [], [], [], []
        leaked = []
        for part in PARTS:
            d, err = load_part(lang, part)
            if err:
                broken.append(f"{part}: {err}")
                continue
            for k, v in d.items():
                if k not in en:
                    stale.append(k)
                    continue
                if part_for(k) != part:
                    misfiled.append(f"{k} in {part}.js")
                pack[k] = v

        for k, v in pack.items():
            src = en[k]
            if tags(src) != tags(v):
                html_break.append(k)
            # Strip phrases where a KEEP_TERM word is ordinary English prose
            # rather than the API object of the same name.
            probe = src
            for phrase in AMBIGUOUS:
                probe = re.sub(re.escape(phrase), "", probe, flags=re.IGNORECASE)
            low = v.lower()
            miss = [t for t in KEEP_TERMS
                    if re.search(r"(?<![A-Za-z])" + re.escape(t) + r"(?![A-Za-z])", probe)
                    and t.lower() not in low]
            if miss:
                dropped.append((k, miss))
            if v == src and src.isascii():
                identical.append(k)
            # Strip markup before looking for leaked source words.
            extra = leaked_english(src, re.sub(r"<[^>]+>|&\w+;", " ", v))
            if extra:
                leaked.append((k, extra))

        missing = len(en) - len(pack)
        cov = 100.0 * len(pack) / len(en) if en else 0.0
        bad = bool(broken or stale or misfiled or html_break or dropped)
        fatal = fatal or bad
        print(f"[{lang}] {'FAIL' if bad else 'OK'} — {len(pack)} keys, {cov:.1f}% coverage | "
              f"untranslated {missing} | html-breaks {len(html_break)} | "
              f"dropped-terms {len(dropped)} | stale {len(stale)} | "
              f"leaked-EN {len(leaked)} | identical-to-EN {len(identical)}")
        for b in broken:
            print(f"        broken: {b}")
        for k in stale[:5]:
            print(f"        stale key (not in catalog): {k}")
        for k in misfiled[:5]:
            print(f"        misfiled: {k}")
        for k in html_break[:5]:
            print(f"        html mismatch: {k}")
            print(f"          en: {tags(en[k])}")
            print(f"          {lang}: {tags(pack[k])}")
        for k, miss in dropped[:5]:
            print(f"        dropped API names {miss}: {k}")
        # Advisory only: a leaked word is usually an untranslated fragment, but
        # can be a legitimate romanization, so it does not fail the run.
        for k, extra in leaked[:40]:
            print(f"        leaked English {extra}: {k}")

    print()
    print("CONTENT PACKS OK" if not fatal else "CONTENT PACKS HAVE ISSUES")
    return 1 if fatal else 0


if __name__ == "__main__":
    sys.exit(main())
