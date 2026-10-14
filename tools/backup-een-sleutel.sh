#!/bin/bash
# Eén sleutel uit de KV halen. Wordt parallel aangeroepen door
# backup-dashboard.sh; alles loopt daarom via omgevingsvariabelen.
soort="$1"; sleutel="$2"
if [ "$soort" = "bucket" ]; then
  doel="$RUW/$(printf '%s' "$sleutel" | tr -c 'A-Za-z0-9._-' '_')"
else
  case "$sleutel" in
    dpfile:*)    doel="$DOCS/dealerportaal/${sleutel#dpfile:}" ;;
    plfile:*)    doel="$DOCS/prijslijsten/${sleutel#plfile:}" ;;
    schipfile:*) doel="$DOCS/schepen/${sleutel#schipfile:}" ;;
    *) echo "OVERGESLAGEN $sleutel" >> "$LOG"; exit 0 ;;
  esac
  case "$doel" in *..*) echo "GEWEIGERD $sleutel" >> "$LOG"; exit 0 ;; esac
  mkdir -p "$(dirname "$doel")"
fi
# Eén herkansing. Met vijf aanvragen tegelijk geeft Cloudflare af en toe een
# 401 terwijl het token net ververst wordt; de tweede poging lukt dan wel. Een
# lege waarde is geen fout - die bestaat gewoon - dus daar niet op herkansen.
# Buckets via de worker: die leest eerst D1 (waar sinds 14 okt 2026 alles
# wordt bewaard) en dan KV. Rechtstreeks uit KV zou een oude stand opleveren.
if [ "$soort" = "bucket" ] && [ -n "${TEAMSLEUTEL:-}" ]; then
  enc="$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$sleutel")"
  code=$(curl -s -o "$doel" -w "%{http_code}" "https://fonteyn-data-store.g-mulder.workers.dev/beheer/kv?sleutel=$enc" -H "X-Fonteyn-Auth: $TEAMSLEUTEL" 2>>"$LOG.fouten")
  if [ "$code" = "200" ] && [ -s "$doel" ]; then exit 0; fi
  if [ "$code" = "404" ]; then echo "LEEG $sleutel" >> "$LOG"; rm -f "$doel"; exit 0; fi
  rm -f "$doel"
fi
# Documenten komen uit het archief (via de worker); staat er niets, dan nog
# één keer in KV kijken.
if [ "$soort" = "doc" ] && [ -n "${TEAMSLEUTEL:-}" ]; then
  enc="$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$sleutel")"
  if curl -sf "https://fonteyn-data-store.g-mulder.workers.dev/beheer/archief?sleutel=$enc" -H "X-Fonteyn-Auth: $TEAMSLEUTEL" -o "$doel" 2>>"$LOG.fouten" && [ -s "$doel" ]; then exit 0; fi
  rm -f "$doel"
fi
poging=1
while :; do
  if $WRANGLER kv key get "$sleutel" --namespace-id "$NS" --remote > "$doel" 2>>"$LOG.fouten"; then
    [ -s "$doel" ] || { echo "LEEG $sleutel" >> "$LOG"; rm -f "$doel"; }
    exit 0
  fi
  rm -f "$doel"
  [ "$poging" -lt 2 ] || { echo "MISLUKT $sleutel" >> "$LOG"; exit 0; }
  poging=$((poging + 1)); sleep 3
done
