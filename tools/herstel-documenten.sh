#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
#  DOCUMENTEN TERUGZETTEN IN DE KV
# ═══════════════════════════════════════════════════════════════════════════
#
#  Draaien (eerst altijd zonder echt te schrijven):
#
#      bash tools/herstel-documenten.sh --dry-run
#      bash tools/herstel-documenten.sh --namespace-id <id>
#
#  Dit gaat over de drie soorten documentsleutels: dpfile: (partnerportaal),
#  plfile: (prijslijsten en facturen) en schipfile: (commercial invoices bij
#  een schip). Samen bijna vierhonderd bestanden - pdf, xlsx, docx - en die
#  bestaan verder nergens.
#
#  Anders dan de buckets houden deze sleutels hun echte pad. backup-een-sleutel.sh
#  saneert niets, het knipt alleen het voorvoegsel eraf en zet het bestand op:
#
#      dpfile:<pad>     ->  documenten/dealerportaal/<pad>
#      plfile:<pad>     ->  documenten/prijslijsten/<pad>
#      schipfile:<pad>  ->  documenten/schepen/<pad>
#
#  LET OP bij schipfile:. Die sleutels beginnen zelf al met "schepen/", dus het
#  bestand komt onder documenten/schepen/schepen/... te staan. Dat ziet er
#  dubbel uit, maar het is precies wat het backupscript doet, en het pad achter
#  de dubbele punt hoort ongewijzigd terug in de sleutel. Niet "opschonen": haal
#  je die tweede map weg, dan vindt dit script het bestand niet meer, en trek je
#  hem uit de sleutel, dan zet je het document onder een naam terug die het
#  dashboard nooit opvraagt.
#
#  De gewone buckets gaan via tools/herstel-buckets.sh.
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
      sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "onbekende optie: $1" >&2; exit 2 ;;
  esac
  shift
done

LIJST="$DOEL/cloudflare/kv/alle-sleutels.json"
DOCS="$DOEL/cloudflare/kv/documenten"
[ -f "$LIJST" ] || { echo "sleutellijst niet gevonden: $LIJST" >&2; exit 1; }
[ -d "$DOCS" ]  || { echo "documentenmap niet gevonden: $DOCS" >&2; exit 1; }

if [ "$PROEF" -eq 0 ]; then
  [ -n "$NSID" ] || { echo "geef --namespace-id <id> mee (of zet NS=), of draai met --dry-run" >&2; exit 2; }
  $WRANGLER --version >/dev/null 2>&1 \
    || { echo "wrangler niet gevonden. Draai eerst npm install, of zet FP_WRANGLER=/pad/naar/wrangler." >&2; exit 1; }
fi

echo "backup    : $DOEL"
echo "namespace : ${NSID:-<geen, proefdraai>}"
[ "$PROEF" -eq 1 ] && echo "PROEFDRAAI - er wordt niets naar Cloudflare geschreven"

# ── de koppeling sleutel -> bestand ────────────────────────────────────────
# Velden gescheiden door een nulbyte: de paden bevatten spaties en haakjes.
KOPPEL="$(mktemp)"; MISLIJST="$(mktemp)"; GEMISTLIJST="$(mktemp)"
trap 'rm -f "$KOPPEL" "$MISLIJST" "$GEMISTLIJST"' EXIT
python3 - "$DOEL" > "$KOPPEL" <<'PY'
import json, os, sys
D = sys.argv[1]
docs = os.path.join(D, "cloudflare/kv/documenten")
namen = [x["name"] for x in json.load(open(os.path.join(D, "cloudflare/kv/alle-sleutels.json")))]

# Zelfde afbeelding als in backup-een-sleutel.sh. Bij schipfile: begint het pad
# achter de dubbele punt zelf met "schepen/", vandaar schepen/schepen/... op de
# schijf. Dat is met opzet zo gelaten.
mapje = {"dpfile": "dealerportaal", "plfile": "prijslijsten", "schipfile": "schepen"}
def soort(n): return n.split(":")[0] if ":" in n else ""

uit = []
for k in namen:
    s = soort(k)
    if s not in mapje:
        continue
    rest = k.split(":", 1)[1]
    if not rest or ".." in rest or rest.startswith("/"):
        # backup-een-sleutel.sh weigert deze ook: een pad dat uit de map breekt.
        uit.append(("GEWEIGERD", k, ""))
        continue
    pad = os.path.join(docs, mapje[s], rest)
    if os.path.isfile(pad) and os.path.getsize(pad):
        uit.append(("OK", k, pad))
    else:
        uit.append(("MIST", k, ""))

for status, k, pad in uit:
    sys.stdout.write("%s\0%s\0%s\0" % (status, k, pad))
PY

if [ "$PROEF" -eq 0 ] && [ "$JA" -eq 0 ]; then
  printf 'Alle documenten terugzetten naar namespace %s? Typ ja: ' "$NSID"
  read -r antwoord
  [ "$antwoord" = "ja" ] || { echo "afgebroken"; exit 1; }
fi

gedaan=0; mislukt=0; gemist=0
while IFS= read -r -d '' status && IFS= read -r -d '' sleutel && IFS= read -r -d '' pad; do
  case "$status" in
    MIST|GEWEIGERD)
      gemist=$((gemist + 1)); printf '%s  (%s)\n' "$sleutel" "$status" >> "$GEMISTLIJST"; continue ;;
  esac
  if [ "$PROEF" -eq 1 ]; then
    printf 'zou zetten: %s\n' "$sleutel"
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
  echo "PROEFDRAAI: $gedaan documenten hebben een bronbestand, $gemist niet"
else
  echo "teruggezet: $gedaan documenten"
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
