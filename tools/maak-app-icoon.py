# -*- coding: utf-8 -*-
"""
HET APP-ICOON VAN DE FONTEYN-TELEFOONAPP

Het oude icoon was het kleine logootje uit de huisstijl, opgeschaald naar 1024:
op een telefoonscherm zie je dan vage, uitgelopen randen. Hier wordt de fontein
opnieuw uitgerekend in plaats van uitgerekt. Elke waterstraal is een gebogen
ruggengraat met een breedte die van niets naar een ronde kop loopt, en dat wordt
pas op het allerlaatst pixels - vier keer zo groot getekend en dan verkleind.

Er komen twee bestanden uit, met een reden:

  app-icoon.png (1024)  gaat naar Android via mobiel.webmanifest, ook als
                        "maskable". Android legt daar zelf een vorm overheen en
                        knipt alles weg wat buiten een cirkel van 80% valt. De
                        fontein blijft daarom binnen die cirkel; onderaan wordt
                        gecontroleerd of dat echt zo is.

  app-icoon-180.png     is de apple-touch-icon voor het beginscherm van de
                        iPhone. iOS knipt niets weg behalve de hoeken, dus daar
                        mag de fontein groter staan.
"""
import math, os
from PIL import Image, ImageDraw

UIT = os.path.dirname(os.path.abspath(__file__))
SUP = 4                                  # zoveel keer groter tekenen

GROEN_BOVEN = (23, 82, 60)
GROEN_ONDER = (14, 55, 40)
GROEN_RAND  = (17, 66, 48)               # de dunne scheiding tussen twee stralen
STOPS = [(0.00, (255, 255, 255)),
         (0.40, (255, 243, 214)),
         (0.74, (250, 198,  84)),
         (1.00, (233, 156,  28))]

# ── de vorm van één waterstraal ──────────────────────────────────────────
def bez(p0, p1, p2, p3, t):
    u = 1 - t
    return (u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0],
            u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1])

def bez_raak(p0, p1, p2, p3, t):
    u = 1 - t
    x = 3*u*u*(p1[0]-p0[0]) + 6*u*t*(p2[0]-p1[0]) + 3*t*t*(p3[0]-p2[0])
    y = 3*u*u*(p1[1]-p0[1]) + 6*u*t*(p2[1]-p1[1]) + 3*t*t*(p3[1]-p2[1])
    n = math.hypot(x, y) or 1.0
    return (x/n, y/n)

def richting(graden):
    a = math.radians(graden)
    return (math.sin(a), -math.cos(a))   # y wijst naar beneden, dus omhoog is min

def straal(tip, stand, lengte, bol, macht=1.55, stappen=280):
    a0, a1 = stand * 0.38, stand * 1.55  # vertrekhoek bij het punt, aankomsthoek bij de kop
    d_pos, d0, d1 = richting(stand), richting(a0), richting(a1)
    E  = (tip[0] + lengte*d_pos[0], tip[1] + lengte*d_pos[1])
    P1 = (tip[0] + 0.45*lengte*d0[0], tip[1] + 0.45*lengte*d0[1])
    P2 = (E[0] - 0.35*lengte*d1[0],  E[1] - 0.35*lengte*d1[1])

    links, rechts, ts = [], [], []
    for i in range(stappen + 1):
        t = i / stappen
        p = bez(tip, P1, P2, E, t)
        r = bez_raak(tip, P1, P2, E, t)
        nrm = (-r[1], r[0])
        w = bol * (t ** macht)
        links.append((p[0] + nrm[0]*w, p[1] + nrm[1]*w))
        rechts.append((p[0] - nrm[0]*w, p[1] - nrm[1]*w))
        ts.append(t)

    rr = bez_raak(tip, P1, P2, E, 1.0)
    nn = (-rr[1], rr[0])
    kop = [(E[0] + bol*(nn[0]*math.cos(math.pi*i/36) + rr[0]*math.sin(math.pi*i/36)),
            E[1] + bol*(nn[1]*math.cos(math.pi*i/36) + rr[1]*math.sin(math.pi*i/36)))
           for i in range(1, 36)]
    return {"links": links, "rechts": rechts, "kop": kop, "t": ts}

TIP = (500.0, 780.0)
STRALEN = [
    (-53.0, 470.0, 58.0),   # buitenste links
    ( 53.0, 470.0, 58.0),   # buitenste rechts
    (-27.0, 478.0, 64.0),   # binnenste links
    ( 27.0, 478.0, 64.0),   # binnenste rechts
    (  0.0, 560.0, 74.0),   # de middelste, als laatste zodat hij bovenop ligt
]

def kleur_op(f):
    f = max(0.0, min(1.0, f))
    for i in range(len(STOPS) - 1):
        a, ka = STOPS[i]; b, kb = STOPS[i+1]
        if f <= b:
            g = 0 if b == a else (f - a) / (b - a)
            return tuple(round(ka[j] + (kb[j]-ka[j])*g) for j in range(3))
    return STOPS[-1][1]

def teken(zijde, vulling, hoger=0.012):
    """Eén icoon van `zijde` pixels, waarbij de fontein `vulling` van de breedte pakt."""
    N = zijde * SUP
    vormen = [straal(TIP, st, ln, bl) for (st, ln, bl) in STRALEN]

    punten = [p for v in vormen for p in (v["links"] + v["kop"] + v["rechts"])]
    bx0 = min(p[0] for p in punten); bx1 = max(p[0] for p in punten)
    by0 = min(p[1] for p in punten); by1 = max(p[1] for p in punten)
    bw, bh = bx1 - bx0, by1 - by0
    schaal = min((zijde*vulling)/bw, (zijde*vulling)/bh)
    dx = (zijde - bw*schaal)/2 - bx0*schaal
    dy = (zijde - bh*schaal)/2 - by0*schaal - zijde*hoger   # optisch iets omhoog

    def naar(p): return ((p[0]*schaal + dx)*SUP, (p[1]*schaal + dy)*SUP)
    for v in vormen:
        for k in ("links", "rechts", "kop"):
            v[k] = [naar(p) for p in v[k]]

    punten = [p for v in vormen for p in (v["links"] + v["kop"] + v["rechts"])]
    GX0 = min(p[0] for p in punten); GX1 = max(p[0] for p in punten)
    GY0 = min(p[1] for p in punten); GY1 = max(p[1] for p in punten)

    doek = Image.new("RGB", (N, N)); tek = ImageDraw.Draw(doek)
    for y in range(N):
        f = y/(N-1)
        tek.line([(0, y), (N, y)],
                 fill=tuple(round(GROEN_BOVEN[i] + (GROEN_ONDER[i]-GROEN_BOVEN[i])*f) for i in range(3)))

    # het verloop
    verloop = Image.new("RGB", (N, N)); vtek = ImageDraw.Draw(verloop)
    A = (GX0 + 0.42*(GX1-GX0), GY0 - 0.10*(GY1-GY0))
    B = (GX0 + 0.60*(GX1-GX0), GY1 + 0.05*(GY1-GY0))
    lengte = math.hypot(B[0]-A[0], B[1]-A[1])
    ex, ey = (B[0]-A[0])/lengte, (B[1]-A[1])/lengte
    diag = N*1.6
    vtek.rectangle([0, 0, N, N], fill=kleur_op(0.0))
    for k in range(0, int(lengte)+1, 2):
        px, py = A[0]+ex*k, A[1]+ey*k
        vtek.line([(px - ey*diag, py + ex*diag), (px + ey*diag, py - ex*diag)],
                  fill=kleur_op(k/lengte), width=4)
    vtek.polygon([(B[0]-ey*diag, B[1]+ex*diag), (B[0]+ey*diag, B[1]-ex*diag),
                  (B[0]+ey*diag+ex*diag, B[1]-ex*diag+ey*diag),
                  (B[0]-ey*diag+ex*diag, B[1]+ex*diag+ey*diag)], fill=kleur_op(1.0))

    RAND = max(2.0, 5.0*schaal*SUP)
    for v in vormen:
        omtrek = v["links"] + v["kop"] + v["rechts"][::-1]
        masker = Image.new("L", (N, N), 0)
        ImageDraw.Draw(masker).polygon(omtrek, fill=255)
        doek.paste(verloop, (0, 0), masker)
        # De rand meebewegen met de dikte van de straal: bij de staart is de
        # straal maar een paar pixels breed, en een rand van volle dikte zou
        # daar de hele straal groen maken. In één gesloten omtrek, anders
        # blijven er lichte speldenprikjes staan waar de zijkant op de kop
        # aansluit.
        dik = ([0.15 + 0.85*t for t in v["t"]] +
               [1.0]*len(v["kop"]) +
               [0.15 + 0.85*t for t in v["t"]][::-1])
        for i in range(len(omtrek)):
            j = (i+1) % len(omtrek)
            w = max(1, round(RAND*max(dik[i], dik[j])))
            tek.line([omtrek[i], omtrek[j]], fill=GROEN_RAND, width=w)

    return doek.resize((zijde, zijde), Image.LANCZOS)

# Android: binnen de veilige cirkel blijven, want daar wordt buiten weggeknipt.
groot = teken(1024, 0.665)
groot.save(os.path.join(UIT, "app-icoon.png"), optimize=True)
# iPhone: daar knipt alleen de hoeken weg, dus mag de fontein ruimer staan.
teken(720, 0.80).resize((180, 180), Image.LANCZOS).save(os.path.join(UIT, "app-icoon-180.png"), optimize=True)

# controle op de veilige cirkel van Android
mid, veilig, buiten = 512.0, 1024*0.40, 0
px = groot.load()
for y in range(1024):
    for x in range(1024):
        r, g, b = px[x, y]
        if r > 120 and g > 110 and r > b + 25:          # goud of wit, geen groen
            if math.hypot(x-mid, y-mid) > veilig: buiten += 1
print("pixels buiten de veilige cirkel van Android:", buiten)
