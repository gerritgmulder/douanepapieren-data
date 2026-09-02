#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
#  BUCKETS TERUGZETTEN IN DE KV
# ═══════════════════════════════════════════════════════════════════════════
#
#  Draaien (eerst altijd zonder echt te schrijven):
#
#      bash tools/herstel-buckets.sh --dry-run
#      bash tools/herstel-buckets.sh --namespace-id <id>
#
#  Waarom dit script bestaat
#  -------------------------
#  De voor de hand liggende lus - "loop over buckets/*.json en gebruik de
#  bestandsnaam als sleutel" - zet de gegevens onder de VERKEERDE naam terug.
#  Twee redenen:
#
#  1. backup-een-sleutel.sh saneert de sleutel tot een bestandsnaam: alles
#     buiten A-Za-z0-9._- wordt een liggend streepje. 21 van de 129 buckets
#     hebben zulke tekens, bijvoorbeeld "spafoto:bliss" (bestand
#     spafoto_bliss.bin), "rl:teamkey:185.82.143.114" en "dp-invite:daabef84-...".
#     Terugzetten onder "spafoto_bliss" levert een sleutel op die het
#     dashboard nooit opvraagt: de foto's zijn dan stil weg.
#  2. Niet elke bucket is JSON. In buckets/ staan .json, .txt en .bin naast
#     elkaar; alle spa-foto's zijn .bin. Een lus over *.json slaat die over.
#
#  Daarom draait dit script het om: de sleutellijst uit Cloudflare
#  (cloudflare/kv/alle-sleutels.json) is de bron, de bestandsnaam wordt
#  daaruit berekend met dezelfde saneerregel, en de sleutel gaat terug onder
#  zijn ECHTE naam.
#
#  Let op bij JSON-buckets: de backup heeft ze opnieuw opgemaakt (ingesprongen
#  met één spatie). De inhoud is dezelfde, de bytes zijn het niet. Voor het
#  dashboard maakt dat niets uit; voor een byte-vergelijking met het origineel
#  wel.
#
#  Documenten (dpfile:, plfile:, schipfile:) gaan niet via dit script maar via
#  tools/herstel-documenten.sh.
# ═══════════════════════════════════════════════════════════════════════════
set -u

DOEL="${FP_BACKUP_DOEL:-$HOME/Documents/Documenten - MacBook Air van G. - 1/Claude/Projects/Fonteyn Dashboard/Backup Dashboard}"
NSID="${NS:-}"
# Zelfde afspraak als backup-dashboard.sh: FP_WRANGLER wijst een eigen wrangler
# aan (pad of commando) als npx hem niet vindt.
WRANGLER="${FP_WRANGLER:-npx --no-install wrangler}"
PROEF=0
JA=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run|-n)    PROEF=1 ;;
    --namespace-id)  NSID="${2:-}"; shift ;;
    --backup)        DOEL="${2:-}"; shift ;;
    --ja|-y)         JA=1 ;;
    -h|--help)
      sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "onbekende optie: $1" >&2; exit 2 ;;
  esac
  shift
done

LIJST="$DOEL/cloudflare/kv/alle-sleutels.json"
BUCKETS="$DOEL/cloudflare/kv/buckets"
[ -f "$LIJST" ]  || { echo "sleutellijst niet gevonden: $LIJST" >&2; exit 1; }
[ -d "$BUCKETS" ] || { echo "bucketmap niet gevonden: $BUCKETS" >&2; exit 1; }

if [ "$PROEF" -eq 0 ]; then
  [ -n "$NSID" ] || { echo "geef --namespace-id <id> mee (of zet NS=), of draai met --dry-run" >&2; exit 2; }
  $WRANGLER --version >/dev/null 2>&1 \
    || { echo "wrangler niet gevonden. Draai eerst npm install, of zet FP_WRANGLER=/pad/naar/wrangler." >&2; exit 1; }
fi

echo "backup    : $DOEL"
echo "namespace : ${NSID:-<geen, proefdraai>}"
[ "$PROEF" -eq 1 ] && echo "PROEFDRAAI - er wordt niets naar Cloudflare geschreven"

# ── de koppeling sleutel -> bestand ────────────────────────────────────────
# Python doet het opzoeken en levert per bucket drie velden af, gescheiden
# door een nulbyte: status, sleutel, bestandspad. Nulbytes omdat sleutels
# spaties bevatten ("spafoto:serene 2") en bestandsnamen van alles kunnen.
KOPPEL="$(mktemp)"
trap 'rm -f "$KOPPEL"' EXIT
python3 - "$DOEL" > "$KOPPEL" <<'PY'
import json, os, sys
D = sys.argv[1]
buckets = os.path.join(D, "cloudflare/kv/buckets")
namen = [x["name"] for x in json.load(open(os.path.join(D, "cloudflare/kv/alle-sleutels.json")))]

# Dezelfde regel als backup-een-sleutel.sh: tr -c 'A-Za-z0-9._-' '_'
def saneer(k):
    return "".join(c if (c.isalnum() and c.isascii()) or c in "._-" else "_" for c in k)

# backup-dashboard.sh hernoemt het opgehaalde bestand met dezelfde regel, maar
# in Python, en daar is isalnum() ook waar voor letters met accenten. Voor de
# huidige 129 sleutels maakt dat niets uit (geen enkele heeft een teken boven
# ASCII), maar komt er ooit een sleutel met een e-accent, dan heet het bestand
# anders dan tr het zou noemen. Daarom zoeken we op beide spellingen.
def saneer_py(k):
    return "".join(c if c.isalnum() or c in "._-" else "_" for c in k)

documenten = {"dpfile", "plfile", "schipfile"}
vluchtig   = {"dp-sess", "mailsleutel", "dp-login"}   # bewust niet in de backup
def soort(n): return n.split(":")[0] if ":" in n else ""

aanwezig = set(os.listdir(buckets))
gebruikt = set()
uit = []
for k in namen:
    if soort(k) in documenten or soort(k) in vluchtig:
        continue
    pad = None
    # De extensie is bij het inpakken bepaald (json / txt / bin), niet door de
    # sleutel. Daarom alle vier de mogelijkheden langs.
    for naam in dict.fromkeys((saneer(k), saneer_py(k))):
        for ext in (".json", ".txt", ".bin", ""):
            if naam + ext in aanwezig:
                pad = os.path.join(buckets, naam + ext)
                gebruikt.add(naam + ext)
                break
        if pad:
            break
    if pad is None or not os.path.getsize(pad):
        uit.append(("MIST", k, ""))
    else:
        uit.append(("OK", k, pad))

for status, k, pad in uit:
    sys.stdout.write("%s\0%s\0%s\0" % (status, k, pad))

# Bestanden zonder sleutel in de lijst: die stonden ooit in Cloudflare en zijn
# daar weggehaald. De backup bewaart ze met opzet, maar dit script zet ze NIET
# terug - het volgt de sleutellijst. Een verse backupronde verhuist ze naar
# buckets-verdwenen/; wil je er een terug, doe dat dan met de hand.
wees = sorted(aanwezig - gebruikt)
if wees:
    sys.stderr.write("niet teruggezet, staan niet in de sleutellijst (%d):\n" % len(wees))
    for w in wees:
        sys.stderr.write("   %s\n" % w)
PY

# ── terugzetten ────────────────────────────────────────────────────────────
if [ "$PROEF" -eq 0 ] && [ "$JA" -eq 0 ]; then
  printf 'Alles terugzetten naar namespace %s? Typ ja: ' "$NSID"
  read -r antwoord
  [ "$antwoord" = "ja" ] || { echo "afgebroken"; exit 1; }
fi

gedaan=0; mislukt=0; gemist=0
MISLIJST="$(mktemp)"; GEMISTLIJST="$(mktemp)"
trap 'rm -f "$KOPPEL" "$MISLIJST" "$GEMISTLIJST"' EXIT

while IFS= read -r -d '' status && IFS= read -r -d '' sleutel && IFS= read -r -d '' pad; do
  if [ "$status" = "MIST" ]; then
    gemist=$((gemist + 1)); printf '%s\n' "$sleutel" >> "$GEMISTLIJST"; continue
  fi
  if [ "$PROEF" -eq 1 ]; then
    printf 'zou zetten: %-60s <- %s\n' "$sleutel" "${pad##*/}"
    gedaan=$((gedaan + 1))
    continue
  fi
  if $WRANGLER kv key put "$sleutel" --path "$pad" \
       --namespace-id "$NSID" --remote >/dev/null 2>&1; then
    gedaan=$((gedaan + 1))
    printf '  gezet: %s\n' "$sleutel"
  else
    mislukt=$((mislukt + 1)); printf '%s\n' "$sleutel" >> "$MISLIJST"
    printf '  MISLUKT: %s\n' "$sleutel" >&2
  fi
done < "$KOPPEL"

echo
if [ "$PROEF" -eq 1 ]; then
  echo "PROEFDRAAI: $gedaan buckets hebben een bronbestand, $gemist niet"
else
  echo "teruggezet: $gedaan buckets"
  echo "mislukt   : $mislukt"
fi
if [ "$gemist" -gt 0 ]; then
  echo "geen bestand in de backup ($gemist):"
  sed 's/^/   /' "$GEMISTLIJST"
fi
if [ "$mislukt" -gt 0 ]; then
  echo "wrangler gaf een fout voor ($mislukt):"
  sed 's/^/   /' "$MISLIJST"
fi
[ "$mislukt" -eq 0 ] || exit 1
