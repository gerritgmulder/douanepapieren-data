#!/bin/bash
# Ververst de Partnerportaal-voorraad: catalogus (model→varianten) + echte
# hal-voorraad uit Logic4. Draai dit periodiek (bv. dagelijks) of na een
# grote voorraadmutatie. Schip-voorraad los bijwerken via import-ci.mjs
# zodra Chantal een nieuwe commercial invoice aanlevert.
set -e
cd "$(dirname "$0")/.."
echo "[$(date '+%H:%M')] catalogus verversen…"
node tools/build-spa-catalog.mjs | tail -1
echo "[$(date '+%H:%M')] hal-voorraad verversen…"
node tools/build-stock.mjs | tail -1
echo "[$(date '+%H:%M')] klaar."
