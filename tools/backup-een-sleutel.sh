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
