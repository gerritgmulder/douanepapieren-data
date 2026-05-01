#!/usr/bin/env python3
"""
Parse alle Passion Spas / Eden / Ice Bath PDF spec sheets en bouw een JSON
lookup van model-naam → {dims, dryWeight, fullWeight, brand, source}.

Verwacht: pdfplumber (`pip install pdfplumber`).

Pas SPADIR aan naar waar jouw "Spa documentatie" map staat. Op de Mac van Gerrit
staat die in iCloud Drive (zie default).

Run:
    python3 tools/parse_spas.py

Schrijft `spec-database.json` (root) en `server/spec-database.json` (zelfde data,
voor de helper-server). Daarna handmatig committen + naar main pushen — bij de
volgende app-start downloadt de Electron-app het via het manifest.
"""
import os, re, json, glob, sys
import pdfplumber

# ─── Bron-locatie ────────────────────────────────────────────────────────
SPADIR = os.environ.get(
    "FONTEYN_SPADIR",
    "/Users/gmulder/Library/Mobile Documents/com~apple~CloudDocs/"
    "Desktop/Intenza/Klanten : Prospects/Fonteyn/Logistiek/"
    "Douanepapieren/Spa documentatie",
)

# We lopen recursief door de hele map (2023-of ouder, 2024, 2026).
# UK/USA/imperial-PDFs worden in parse_pdf zelf herkend (Dry Weight in lbs)
# en geweigerd — anders zouden 681 lbs als 681 kg worden opgeslagen.
ROOT_SUBFOLDERS = [
    "2023-of ouder",
    "2024",
    "2026 (not done yet)",
]

# Flexibele regexes voor metric (kg/cm) data
RE_DIMS_METRIC = re.compile(
    r"Dimensions\s*L\s*x\s*W\s*x\s*H[\s.]*?([0-9]{2,4})\s*x\s*([0-9]{2,4})\s*x\s*([0-9]{1,4})",
    re.I,
)
# Sommige oude PDFs schrijven gewoon "L x W x H" of "Afmetingen" zonder Dimensions-prefix
RE_DIMS_FALLBACK = re.compile(
    r"(?:Afmetingen|Dimensions)[^0-9]{0,40}?([0-9]{2,4})\s*x\s*([0-9]{2,4})\s*x\s*([0-9]{1,4})",
    re.I,
)
RE_DRY_KG  = re.compile(r"Dry\s*Weight[^0-9]*?([0-9]{2,5})", re.I)
RE_FULL_KG = re.compile(r"Full\s*Weight[^0-9]*?([0-9]{2,5})", re.I)

# Detecteer pounds → skip die PDF (zou metric vervuilen). We checken specifiek
# op "Weight in lbs" ergens in de tekst; bij EU-PDFs staat "Weight in kg".
RE_IMPERIAL = re.compile(r"Weight\s*in\s*lbs|in\s*inches\b", re.I)

# Filenames met taal-suffix: "Serene 5 DE.pdf" → "Serene 5"
RE_LANG_SUFFIX = re.compile(r"\s+(DE|UK|US|USA|FR|EN|NL|ES)$", re.I)

# Bestanden / paden die geen spa-spec-sheet zijn — overslaan
SKIP_FILENAMES = {
    "Prijslijst Xtreme Green Heat Pump",
}
SKIP_PATH_PARTS = {
    # Niet-spa PDFs in bovenmappen
    "Merchandising", "Kleuren", "Covana",  # cover guides, geen spec sheets met dims/weight format
    "AquaSun Dealer",
    "USA - Amerikaanse maten",  # imperial, willen we niet
    "UK English - Europese maten",  # wel EU-maten maar lbs voor weight; risico te groot
}


def model_name_from_filename(fn: str) -> str:
    base = os.path.splitext(os.path.basename(fn))[0]
    return RE_LANG_SUFFIX.sub("", base).strip()


def brand_from_path(p: str) -> str:
    rel = p.replace(SPADIR + "/", "")
    parts = rel.split("/")
    if len(parts) >= 3:
        return parts[2]
    return parts[0] if parts else "?"


def parse_pdf(p: str):
    try:
        with pdfplumber.open(p) as pdf:
            text = ""
            # We hebben meestal genoeg aan de eerste 2-4 pagina's;
            # stop zodra we alle 3 de waarden hebben.
            for page in pdf.pages[:4]:
                text += (page.extract_text() or "") + "\n"
                if ((RE_DIMS_METRIC.search(text) or RE_DIMS_FALLBACK.search(text))
                        and RE_DRY_KG.search(text)
                        and RE_FULL_KG.search(text)):
                    break

        # Veiligheidsfilter: skip PDFs in pounds — anders vervuilen
        # die de database met getallen alsof het kg zijn.
        if RE_IMPERIAL.search(text):
            return {"skipped": "imperial units"}

        m_dims = RE_DIMS_METRIC.search(text) or RE_DIMS_FALLBACK.search(text)
        m_dry  = RE_DRY_KG.search(text)
        m_full = RE_FULL_KG.search(text)
        if not (m_dims or m_dry or m_full):
            return None
        return {
            "dims":      f"{m_dims.group(1)}x{m_dims.group(2)}x{m_dims.group(3)} CM" if m_dims else None,
            "dryWeight": int(m_dry.group(1))  if m_dry  else None,
            "fullWeight":int(m_full.group(1)) if m_full else None,
        }
    except Exception as e:
        return {"error": str(e)}


def find_pdfs(root):
    """Recursief alle PDFs onder root, met SKIP_PATH_PARTS-filter."""
    for dirpath, dirnames, files in os.walk(root):
        # Skip mappen waarvan we weten dat ze niet helpen (Merchandising, Covana...).
        # In-place mutate dirnames om walk te sturen.
        dirnames[:] = [d for d in dirnames if d not in SKIP_PATH_PARTS]
        for f in files:
            if f.lower().endswith(".pdf"):
                yield os.path.join(dirpath, f)

def main():
    if not os.path.isdir(SPADIR):
        print(f"FOUT: Spa documentatie-map niet gevonden: {SPADIR}", file=sys.stderr)
        print(f"Stel FONTEYN_SPADIR in als de map ergens anders staat.", file=sys.stderr)
        sys.exit(1)

    out, errors, skipped, total = {}, [], 0, 0
    for sub in ROOT_SUBFOLDERS:
        full = os.path.join(SPADIR, sub)
        if not os.path.isdir(full):
            print(f"  skip (niet aanwezig): {sub}", file=sys.stderr)
            continue
        for p in sorted(find_pdfs(full)):
            total += 1
            name = model_name_from_filename(p)
            if name in SKIP_FILENAMES:
                continue
            parsed = parse_pdf(p)
            if parsed and "skipped" in parsed:
                skipped += 1
                continue
            if not parsed or "error" in parsed:
                errors.append(f"{os.path.relpath(p, SPADIR)}: " +
                              (parsed.get("error","leeg") if parsed else "geen velden gevonden"))
                continue
            existing = out.get(name)
            if existing:
                # Eerste gevonden wint, maar vul ontbrekende velden alsnog aan
                for k in ("dims", "dryWeight", "fullWeight"):
                    if not existing.get(k) and parsed.get(k):
                        existing[k] = parsed[k]
                continue
            out[name] = {
                "brand": brand_from_path(p),
                "dims": parsed["dims"],
                "dryWeight": parsed["dryWeight"],
                "fullWeight": parsed["fullWeight"],
                "source": os.path.relpath(p, SPADIR),
            }

    out = dict(sorted(out.items()))
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    for path in [os.path.join(repo_root, "spec-database.json"),
                 os.path.join(repo_root, "server", "spec-database.json")]:
        with open(path, "w") as f:
            json.dump(out, f, indent=0, ensure_ascii=False)
            f.write("\n")
        print(f"  ✓ {os.path.relpath(path, repo_root)}")

    print(f"\nTotaal: {total} PDFs   →   {len(out)} spas in DB   ({skipped} skipped imperial, {len(errors)} errors)")
    if errors:
        print("\nErrors / niet-geparsed:")
        for e in errors[:20]:
            print(f"  - {e}")
        if len(errors) > 20:
            print(f"  ... en nog {len(errors)-20} meer")

if __name__ == "__main__":
    main()
