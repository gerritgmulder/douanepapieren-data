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
if npx --no-install wrangler kv key get "$sleutel" --namespace-id "$NS" --remote > "$doel" 2>>"$LOG.fouten"; then
  [ -s "$doel" ] || { echo "LEEG $sleutel" >> "$LOG"; rm -f "$doel"; }
else
  echo "MISLUKT $sleutel" >> "$LOG"; rm -f "$doel"
fi
