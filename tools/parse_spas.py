#!/usr/bin/env python3
"""
Build spec-database.json from all PDFs in the Fonteyn Spa documentatie folder.

Reads Dimensions and Dry Weight from each PDF, derives brand from path,
detects whether the spa is a swim spa (= zwemspa, net weight = dry - 100kg)
or a regular spa (net weight = dry - 20kg), and writes a JSON dict keyed by
spa-name (= filename minus .pdf, cleaned).

Usage: python3 build-spec-database.py
Output: writes ./spec-database.json (next to the script)
"""
import json, os, re, subprocess, sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

SPADOC = Path("/Users/gmulder/Library/Mobile Documents/com~apple~CloudDocs/Desktop/Intenza/Klanten : Prospects/Fonteyn/Dashboard/Logistiek/Douanepapieren/Spa documentatie")
OUTPUT = Path("/Users/gmulder/Documents/GitHub/douanepapieren-data/.claude/worktrees/romantic-ardinghelli-78b097/spec-database.json")

# Brand-mapping: pad-segmenten → brand-naam zoals we 'm in spec willen.
# Pakt het meest-specifieke segment (langste match).
BRAND_FROM_PATH = [
    # 2024 (huidige catalogus)
    ("2024/EU/Passion Swim Spas",  "Passion Swim Spas",  True),
    ("2024/EU/Passion Spas",       "Passion Spas",       False),
    ("2024/EU/Passion Ice Baths",  "Passion Ice Baths",  False),
    ("2024/EU/Eden Spas",          "Eden Spas",          False),
    ("2024/UK/Passion Swimspas",   "Passion Swim Spas",  True),
    ("2024/UK/Passion Spas",       "Passion Spas",       False),
    ("2024/UK/Passion Ice Baths",  "Passion Ice Baths",  False),
    # 2023-of ouder (legacy)
    ("1. Tropical Spas",           "Tropic Spas",        False),
    ("1. Storm spas",              "Storm Spas",         False),
    ("1. Devine Spas",             "Devine Spas",        False),
    ("1. Grizzly Spas",            "Grizzly Spas",       False),
    ("Passion Swim Spas",          "Passion Swim Spas",  True),
    ("Passion Spas",               "Passion Spas",       False),
    ("Tropical Spas",              "Tropic Spas",        False),
    ("Storm spas",                 "Storm Spas",         False),
    ("Devine Spas",                "Devine Spas",        False),
    ("Grizzly Spas",               "Grizzly Spas",       False),
    # Zwemspa-detectie op naam
    ("Swim Spa",                   "Passion Swim Spas",  True),
    ("Swimspa",                    "Passion Swim Spas",  True),
]

# Veldnamen in EN/NL/DE/ES — zelfde regex om alle taal-versies van de
# spec-sheets te kunnen lezen. Voorbeelden:
#   EN: "Dimensions L x W x H...... 200 x 200 x 82 cm"  /  "Dry Weight in kg... 260"
#   NL: "Afmetingen ...... 200 x 200 x 82 cm"  /  "Droog gewicht in kg... 260"
#   DE: "Abmessungen L x B x H... 230 x 230 x 91 cm"  /  "Trockengewicht in kg... 380"
#   ES: "Dimensiones ........... 600 x 228 x 126 cm"  /  "Peso en vacío.......... 1400"
DIM_LABEL  = r'(?:Dimensions|Afmetingen|Abmessungen|Dimensiones)'
DRY_LABEL  = r'(?:Dry\s*Weight|Droog\s*gewicht|Trockengewicht|Peso\s*en\s*vac[ií]o)'
FULL_LABEL = r'(?:Full\s*Weight|Gevuld\s*gewicht|Gef[üu]lltes\s*Gewicht|Peso\s*en\s*lleno)'

DIM_RE  = re.compile(DIM_LABEL  + r'(?:\s*L?\s*x?\s*[WB]?\s*x?\s*H?)?[\s\.·]*([\d]{2,4})\s*[xX×]\s*([\d]{2,4})\s*[xX×]\s*([\d]{2,4})\s*cm', re.IGNORECASE)
DRY_RE  = re.compile(DRY_LABEL  + r'(?:\s*in\s*kg)?[\s\.·]*([\d]{2,5})', re.IGNORECASE)
FULL_RE = re.compile(FULL_LABEL + r'(?:\s*in\s*kg)?[\s\.·]*([\d]{2,5})', re.IGNORECASE)

def extract_text(pdf_path):
    """pdftotext, met timeout 8s — sneller falen dan slepende PDFs."""
    try:
        result = subprocess.run(
            ["/opt/homebrew/bin/pdftotext", "-layout", str(pdf_path), "-"],
            capture_output=True, text=True, timeout=8
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout
    except Exception:
        pass
    return ""

def detect_brand_and_swim(path_str):
    for marker, brand, is_swim in BRAND_FROM_PATH:
        if marker in path_str:
            return brand, is_swim
    return None, False

def clean_name(filename):
    """Normaliseer filename naar spa-naam zodat DE/ES/UK-varianten van
    dezelfde spa als dezelfde key herkend worden.
    Voorbeelden:
      'EU The Aurora.pdf'       → 'The Aurora'
      'Bermuda.pdf'              → 'Bermuda'
      'Admire DE.pdf'            → 'Admire'
      'Aquatic-2-ES-Europe.pdf'  → 'Aquatic 2'
      'Felicity specificaties.pdf' → 'Felicity'
    """
    n = re.sub(r'\.pdf$', '', filename, flags=re.IGNORECASE)
    # Strip leading "EU " of "UK " prefixen (Eden / UK Passion-bestanden)
    n = re.sub(r'^(EU|UK)\s+', '', n)
    # Strip taal/regio-suffixen
    n = re.sub(r'[\s\-]+(DE|ES|FR|NL|UK|EU)([\s\-]+Europe)?$', '', n, flags=re.IGNORECASE)
    n = re.sub(r'\s+specificaties$', '', n, flags=re.IGNORECASE)
    # Normaliseer scheidingstekens: 'Aquatic-2' → 'Aquatic 2'
    n = n.replace('-', ' ')
    n = re.sub(r'\s+', ' ', n)
    return n.strip()

def main():
    if not SPADOC.exists():
        print(f"ERROR: Spa documentatie folder niet gevonden op {SPADOC}", file=sys.stderr)
        sys.exit(1)

    pdfs = sorted(SPADOC.rglob("*.pdf"))
    print(f"Totaal PDFs gevonden: {len(pdfs)}", flush=True)

    def process_one(pdf):
        rel = pdf.relative_to(SPADOC)
        name = clean_name(pdf.name)
        text = extract_text(pdf)
        if not text:
            return ("skip", str(rel), "geen tekst (scan-PDF?)")
        m_dim = DIM_RE.search(text)
        m_dry = DRY_RE.search(text)
        m_full = FULL_RE.search(text)
        if not (m_dim and m_dry):
            return ("skip", str(rel), f"velden missen (dim={bool(m_dim)} dry={bool(m_dry)})")
        L, W, H = m_dim.groups()
        dims = f"{L}x{W}x{H} CM"
        dry = int(m_dry.group(1))
        full = int(m_full.group(1)) if m_full else None
        brand, is_swim = detect_brand_and_swim(str(rel))
        if "swim" in name.lower():
            is_swim = True
        net = dry - (100 if is_swim else 20)
        entry = {
            "brand": brand or "Onbekend",
            "dims": dims,
            "dryWeight": dry,
            "netWeight": net,
            "isSwimSpa": is_swim,
            "source": str(rel),
        }
        if full is not None:
            entry["fullWeight"] = full
        return ("ok", name, entry)

    db = {}
    skipped = []
    duplicates = []
    done = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = {ex.submit(process_one, p): p for p in pdfs}
        for fut in as_completed(futures):
            done += 1
            kind, key, val = fut.result()
            if kind == "skip":
                skipped.append((key, val))
            else:
                name = key
                entry = val
                if name in db:
                    old = db[name]
                    old_is_2024 = "2024/" in old.get("source", "")
                    new_is_2024 = "2024/" in entry.get("source", "")
                    if new_is_2024 and not old_is_2024:
                        duplicates.append((name, "→ overschreven door 2024"))
                        db[name] = entry
                    else:
                        duplicates.append((name, f"genegeerd dup: {entry['source']}"))
                else:
                    db[name] = entry
            if done % 50 == 0 or done == len(pdfs):
                print(f"  {done}/{len(pdfs)} verwerkt | db={len(db)} skipped={len(skipped)}", flush=True)

    pdf_count = done

    # Sorteer alfabetisch voor leesbaarheid van de JSON
    sorted_db = dict(sorted(db.items()))

    OUTPUT.write_text(json.dumps(sorted_db, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"PDFs verwerkt: {pdf_count}")
    print(f"Spec-entries geschreven: {len(sorted_db)}")
    print(f"Skipped (geen velden / kon niet lezen): {len(skipped)}")
    print(f"Duplicates: {len(duplicates)}")
    print()
    print("=== eerste 5 entries ===")
    for k, v in list(sorted_db.items())[:5]:
        print(f"  {k!r}: dims={v['dims']}, dry={v['dryWeight']}, net={v['netWeight']}, swim={v['isSwimSpa']}, brand={v['brand']}")
    print()
    if skipped:
        print("=== eerste 10 skipped (debug) ===")
        for path, reason in skipped[:10]:
            print(f"  {path}: {reason}")
    print()
    print(f"Output: {OUTPUT}")

if __name__ == "__main__":
    main()
