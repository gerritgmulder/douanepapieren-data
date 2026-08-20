#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
#  BACKUP VAN HET FONTEYN DASHBOARD
# ═══════════════════════════════════════════════════════════════════════════
#
#  Draaien:  bash tools/backup-dashboard.sh
#
#  Wat er gebackupt wordt en waarom
#  --------------------------------
#  Het dashboard draait niet op een pc maar op GitHub (de code) en Cloudflare
#  (de gegevens). Een kapotte laptop raakt het dus niet: die installeer je
#  opnieuw en klaar. Deze backup is voor het andere geval - de gegevens bij
#  Cloudflare weg, of het account kwijt. De buckets in de KV zijn het enige
#  deel dat nergens anders bestaat.
#
#  Eén map die telkens wordt bijgewerkt, geen stapel gedateerde kopieën
#  (Gerrit, 20-08-2026). De datum van de laatste ronde staat in LEESMIJ.md.
#
#  De documenten (dpfile/plfile/schipfile) worden alleen opgehaald als ze er
#  nog niet zijn. Het zijn er bijna vierhonderd en ze veranderen niet: ze
#  hangen aan een sleutel die per bestand uniek is. Dat scheelt elke week
#  een half uur. De buckets worden wél elke keer opnieuw opgehaald, want die
#  veranderen de hele dag.
#
#  Een sleutel die uit Cloudflare verdwijnt blijft in de backup staan. Dat is
#  met opzet: een backup hoort niet mee te wissen wat iemand per ongeluk
#  weggooide.
# ═══════════════════════════════════════════════════════════════════════════
set -u

export NS="3e8fa24719f04406a167d19d7600d6fa"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOEL="${FP_BACKUP_DOEL:-$HOME/Documents/Documenten - MacBook Air van G. - 1/Claude/Projects/Fonteyn Dashboard/Backup Dashboard}"
SLEUTELMAP="${FP_SLEUTELMAP:-$HOME/Documents/Documenten - MacBook Air van G. - 1}"
GEHEUGEN="$HOME/.claude/projects/-Users-gmulder-Documents-Documenten---MacBook-Air-van-G----1-Claude-Projects-Douanepapieren/memory"

export DOCS="$DOEL/cloudflare/kv/documenten"
export RUW="$DOEL/_ruw"
export LOG="$DOEL/_ronde.log"
HULP="$REPO/tools"

mkdir -p "$DOEL/repo" "$DOEL/cloudflare/kv/buckets" "$DOCS" "$DOEL/cloudflare/config" \
         "$DOEL/sleutels" "$DOEL/projectgeheugen" "$RUW"
: > "$LOG"
zeg(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
zeg "backup naar: $DOEL"

# ── 1. de code ─────────────────────────────────────────────────────────────
zeg "1/7  de code"
cd "$REPO" || exit 1
tar --exclude=node_modules --exclude=.wrangler --exclude=.git --exclude=.DS_Store \
    -czf "$DOEL/repo/bestanden-nu.tar.gz.nieuw" . 2>>"$LOG.fouten" \
  && mv "$DOEL/repo/bestanden-nu.tar.gz.nieuw" "$DOEL/repo/bestanden-nu.tar.gz"
# De volledige historie kan er nu wél in: sinds de repo uit iCloud is duurt
# dit seconden in plaats van uren.
git bundle create "$DOEL/repo/historie.bundle.nieuw" --all >/dev/null 2>>"$LOG.fouten" \
  && mv "$DOEL/repo/historie.bundle.nieuw" "$DOEL/repo/historie.bundle"
{
  echo "commit  : $(git rev-parse HEAD)"
  echo "tak     : $(git rev-parse --abbrev-ref HEAD)"
  echo "datum   : $(git log -1 --format=%cI)"
  echo "titel   : $(git log -1 --format=%s)"
  echo "herkomst: https://github.com/gerritgmulder/douanepapieren-data"
  echo; echo "nog niet gepusht (leeg = alles staat op GitHub):"; git status --short
  echo; echo "── laatste 30 commits ──"; git log --oneline -30
} > "$DOEL/repo/stand.txt" 2>>"$LOG.fouten"
cp "$REPO/manifest.json" "$REPO/data-worker/wrangler.toml" "$REPO/CLAUDE.md" \
   "$REPO/toegang.js" "$REPO/tegels.js" "$DOEL/cloudflare/config/" 2>/dev/null

# ── 2. de sleutellijst ─────────────────────────────────────────────────────
zeg "2/7  sleutellijst uit Cloudflare"
npx --no-install wrangler kv key list --namespace-id "$NS" --remote \
  > "$DOEL/cloudflare/kv/alle-sleutels.json.nieuw" 2>>"$LOG.fouten"
if [ -s "$DOEL/cloudflare/kv/alle-sleutels.json.nieuw" ]; then
  mv "$DOEL/cloudflare/kv/alle-sleutels.json.nieuw" "$DOEL/cloudflare/kv/alle-sleutels.json"
else
  zeg "     LET OP: de sleutellijst kwam niet binnen; met de vorige verder"
  rm -f "$DOEL/cloudflare/kv/alle-sleutels.json.nieuw"
fi
python3 - "$DOEL" <<'PY'
import json,sys,os
doel=sys.argv[1]
d=json.load(open(os.path.join(doel,"cloudflare/kv/alle-sleutels.json")))
namen=[x["name"] for x in d]
soort=lambda n: n.split(":")[0]
binair=[n for n in namen if soort(n) in ("dpfile","plfile","schipfile")]
vluchtig=[n for n in namen if soort(n) in ("dp-sess","mailsleutel","dp-login")]
tekst=[n for n in namen if n not in set(binair)|set(vluchtig)]
open(os.path.join(doel,"_binair.txt"),"w").write("\n".join(binair))
open(os.path.join(doel,"_tekst.txt"),"w").write("\n".join(tekst))
open(os.path.join(doel,"cloudflare/kv/niet-meegenomen.txt"),"w").write(
  "Deze sleutels zijn met opzet NIET in de backup opgenomen.\n\n"
  "Het zijn lopende sessies: een dealer die is ingelogd op het partnerportaal\n"
  "(dp-sess) en een medewerker die op zijn telefoon 'ingelogd blijven' heeft\n"
  "aangevinkt (mailsleutel). Achter zo'n sleutel zit een geldig Logic4-token op\n"
  "naam van die persoon. Ze verlopen vanzelf, ze zijn bij een herstel nutteloos\n"
  "- iedereen logt gewoon opnieuw in - en ze in een bestand op een schijf zetten\n"
  "maakt de boel alleen maar onveiliger. Alleen de namen staan hieronder.\n\n"
  + "\n".join(vluchtig) + "\n")
print("  %d buckets, %d documenten, %d sessies overgeslagen" % (len(tekst), len(binair), len(vluchtig)))
PY

# ── 3. de gegevens-buckets: elke week opnieuw ──────────────────────────────
zeg "3/7  gegevens-buckets (elke week vers)"
rm -rf "$RUW"; mkdir -p "$RUW"
grep -v '^$' "$DOEL/_tekst.txt" | xargs -P 5 -n 1 "$HULP/backup-een-sleutel.sh" bucket
python3 - "$DOEL" <<'PY'
import os,sys,json
D=sys.argv[1]; ruw=os.path.join(D,"_ruw"); uit=os.path.join(D,"cloudflare/kv/buckets")
sleutels=[r.strip() for r in open(os.path.join(D,"_tekst.txt")) if r.strip()]
geteld={"json":0,"tekst":0,"binair":0}; ontbreekt=[]
for k in sleutels:
    naam="".join(c if (c.isalnum() or c in "._-") else "_" for c in k)
    p=os.path.join(ruw,naam)
    if not os.path.exists(p) or os.path.getsize(p)==0: ontbreekt.append(k); continue
    b=open(p,"rb").read()
    try: t=b.decode("utf-8")
    except UnicodeDecodeError:
        open(os.path.join(uit,naam+".bin"),"wb").write(b); geteld["binair"]+=1; continue
    try:
        json.dump(json.loads(t), open(os.path.join(uit,naam+".json"),"w"), ensure_ascii=False, indent=1)
        geteld["json"]+=1
    except Exception:
        open(os.path.join(uit,naam+".txt"),"w").write(t); geteld["tekst"]+=1
print("  %(json)d json, %(tekst)d tekst, %(binair)d binair" % geteld)
if ontbreekt: print("  NIET OPGEHAALD:", ", ".join(ontbreekt[:10]))
PY
rm -rf "$RUW"

# ── 4. de documenten: alleen wat nog ontbreekt ─────────────────────────────
zeg "4/7  documenten (alleen de nieuwe)"
nodig="$DOEL/_nodig.txt"; : > "$nodig"
while IFS= read -r k; do
  [ -n "$k" ] || continue
  case "$k" in
    dpfile:*)    p="$DOCS/dealerportaal/${k#dpfile:}" ;;
    plfile:*)    p="$DOCS/prijslijsten/${k#plfile:}" ;;
    schipfile:*) p="$DOCS/schepen/${k#schipfile:}" ;;
    *) continue ;;
  esac
  [ -s "$p" ] || echo "$k" >> "$nodig"
done < "$DOEL/_binair.txt"
# grep -c drukt "0" af en geeft tóch exitcode 1; zonder de || true stopt
# het script hier, en met een || echo 0 stond er "0\n0" in de variabele.
aantal=$(grep -c . "$nodig" 2>/dev/null || true); aantal=${aantal:-0}
al=$(grep -c . "$DOEL/_binair.txt" 2>/dev/null || true); al=${al:-0}
zeg "     $aantal nieuw, $(( al - aantal )) stonden er al"
[ "$aantal" -gt 0 ] && grep -v '^$' "$nodig" | xargs -P 5 -n 1 "$HULP/backup-een-sleutel.sh" doc

# ── 5. sleutels, geheugen en de namenlijst ─────────────────────────────────
zeg "5/7  sleutels, projectgeheugen en de namen van de geheimen"
npx --no-install wrangler secret list --cwd "$REPO/data-worker" \
  > "$DOEL/cloudflare/config/geheimen-namen.txt" 2>>"$LOG.fouten"
cp "$SLEUTELMAP"/fonteyn-*.txt "$SLEUTELMAP"/fonteyn-*.rtf "$SLEUTELMAP"/*API*.rtf "$DOEL/sleutels/" 2>/dev/null
cp "$REPO/server/.env" "$DOEL/sleutels/server-env.txt" 2>/dev/null
cat > "$DOEL/sleutels/LEES-DIT-EERST.txt" <<'SLEUTEL'
HIER STAAN WACHTWOORDEN IN.

Dit mapje bevat de sleutelbestanden van het dashboard: de teamsleutel, de
beheersleutel van het partnerportaal, de Mollie-sleutel, de QuickBooks- en
Flexport-gegevens en het instellingenbestand van de hulpserver.

Ze zitten er met opzet bij, want zonder deze gegevens is een herstel na een
ramp niet te doen. Maar dat betekent ook: zet deze map niet op een schijf die
je uitleent, kwijtraakt of onversleuteld laat slingeren.

Niet alle achttien geheimen van de worker staan hier. Welke er zijn, staat in
../cloudflare/config/geheimen-namen.txt. De Logic4-gegevens en een paar andere
bestaan alleen nog binnen Cloudflare zelf; die haal je bij een herstel opnieuw
op bij de leverancier.
SLEUTEL
rm -rf "$DOEL/projectgeheugen"; mkdir -p "$DOEL/projectgeheugen"
cp "$GEHEUGEN"/*.md "$DOEL/projectgeheugen/" 2>/dev/null
zeg "     $(ls "$DOEL/sleutels" | wc -l | tr -d ' ') sleutelbestanden, $(ls "$DOEL/projectgeheugen" | wc -l | tr -d ' ') geheugenbestanden"

# ── 6. controleren of alles er is ──────────────────────────────────────────
zeg "6/7  controleren"
python3 - "$DOEL" <<'PY' | tee -a "$LOG"
import json,os,sys
D=sys.argv[1]
namen=[x["name"] for x in json.load(open(os.path.join(D,"cloudflare/kv/alle-sleutels.json")))]
mapje={"dpfile":"dealerportaal","plfile":"prijslijsten","schipfile":"schepen"}
mist_d=[n for n in namen if n.split(":")[0] in mapje
        and not os.path.exists(os.path.join(D,"cloudflare/kv/documenten",mapje[n.split(":")[0]],n.split(":",1)[1]))]
tekst=[n for n in namen if n.split(":")[0] not in list(mapje)+["dp-sess","mailsleutel","dp-login"]]
bm=os.path.join(D,"cloudflare/kv/buckets")
er=set(os.path.splitext(f)[0] for f in os.listdir(bm))
mist_b=[k for k in tekst if "".join(c if (c.isalnum() or c in "._-") else "_" for c in k) not in er]
print("     documenten: %d verwacht, %d ontbreekt" % (sum(1 for n in namen if n.split(':')[0] in mapje), len(mist_d)))
print("     buckets   : %d verwacht, %d ontbreekt" % (len(tekst), len(mist_b)))
if mist_d: print("     MIST:", ", ".join(mist_d[:8]))
if mist_b: print("     MIST:", ", ".join(mist_b[:8]))
PY

# ── 7. controlelijst en leesmij ────────────────────────────────────────────
zeg "7/7  leesmij en controlelijst"
rm -f "$DOEL/_tekst.txt" "$DOEL/_binair.txt" "$DOEL/_nodig.txt"
[ -s "$LOG.fouten" ] || rm -f "$LOG.fouten"
python3 "$HULP/backup-leesmij.py" "$DOEL" >> "$LOG"
mv "$LOG" "$DOEL/laatste-ronde.log" 2>/dev/null
# Pas hier de controlelijst, als alles op zijn plek staat. Andersom zou LEESMIJ,
# HERSTEL en het logboek in de lijst belanden en daarna nog veranderen - dan
# ketst de controle de week erop af op iets dat helemaal niet stuk is.
cd "$DOEL" && find . -type f ! -name "controle.sha256" -print0 \
  | xargs -0 shasum -a 256 > "$DOEL/controle.sha256"
echo "KLAAR — $(du -sh "$DOEL" | cut -f1) in $DOEL"
