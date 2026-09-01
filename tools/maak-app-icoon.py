# -*- coding: utf-8 -*-
"""
HET APP-ICOON VAN FONTEYN

Gerrit, 1 sep 2026: "puur en alleen een donkergroen app-achtergrondje en het
gelige fonteintje van Fonteyn. Geen letters ofzo. Clean and simple."

Hiervoor stond hier een natekening van de fontein: elke waterstraal opnieuw
uitgerekend als gebogen ruggengraat. Dat leverde dikke, uitgelopen druppels op
die niet meer op het merkteken leken. Nu wordt de fontein uit fonteyn-logo.png
zelf genomen - dat IS het merkteken, dus hij kan per definitie niet afwijken.
Alleen het bovenste deel van het logo (de fontein), zonder de woordmerk-tekst.

Er komen vier bestanden uit:

  app-icoon.png (1024)  Android, via mobiel.webmanifest, ook als "maskable".
                        Android legt daar zelf een vorm overheen en knipt weg
                        wat buiten een cirkel van 80% valt. Daarom een VOLLE
                        vierkante achtergrond (geen eigen ronde hoeken) en een
                        fontein die ruim binnen die cirkel blijft; onderaan
                        wordt gecontroleerd of dat echt zo is.

  app-icoon-180.png     apple-touch-icon voor het beginscherm van de iPhone.
                        iOS knipt alleen de hoeken weg, dus geen eigen ronding.

  build/icon.png        het bureaublad-icoon (Electron). macOS maskeert niet,
                        dus die ronde hoeken moeten er hier zelf in.

  build/icon.ico        Windows.

Draaien: python3 tools/maak-app-icoon.py
"""
import os
from PIL import Image, ImageDraw

HIER  = os.path.dirname(os.path.abspath(__file__))
WORTEL = os.path.dirname(HIER)
LOGO  = os.path.join(WORTEL, "fonteyn-logo.png")
BUILD = os.path.join(WORTEL, "build")

GROEN = (20, 71, 52)     # --fonteyn-green, hetzelfde groen als de kop van elke tegel
SUP   = 4                # vier keer zo groot tekenen en dan pas verkleinen
VUL   = 0.60             # hoeveel van de breedte de fontein inneemt

def fontein():
    """De fontein uit het logo, zonder de woordmerk-tekst eronder."""
    im = Image.open(LOGO).convert("RGBA")
    top = im.crop((0, 0, im.width, 120))       # boven de 'F' van Fonteyn
    return top.crop(top.split()[3].getbbox())

def maak(grootte, rond=0.0, vul=VUL):
    g = grootte * SUP
    doek = Image.new("RGBA", (g, g), (0, 0, 0, 0))
    d = ImageDraw.Draw(doek)
    if rond:
        d.rounded_rectangle([0, 0, g - 1, g - 1], radius=int(g * rond), fill=GROEN + (255,))
    else:
        d.rectangle([0, 0, g - 1, g - 1], fill=GROEN + (255,))
    f = fontein()
    breed = int(g * vul)
    hoog  = int(breed * f.height / f.width)
    f = f.resize((breed, hoog), Image.LANCZOS)
    # Iets boven het rekenkundige midden: de fontein loopt onderaan uit in
    # dunne staarten, dus optisch zakt hij anders naar beneden weg.
    doek.alpha_composite(f, ((g - breed) // 2, int((g - hoog) / 2 - g * 0.015)))
    return doek.resize((grootte, grootte), Image.LANCZOS)

def past_in_veilige_cirkel(im):
    """Android knipt alles weg buiten een cirkel van 80%. Blijft de fontein heel?"""
    g = im.size[0]
    straal = g * 0.40
    mx = my = g / 2.0
    px = im.load()
    for y in range(g):
        for x in range(g):
            r, gr, b, a = px[x, y]
            if a < 8:
                continue
            if (r, gr, b) == GROEN:          # achtergrond telt niet mee
                continue
            if abs(r - GROEN[0]) + abs(gr - GROEN[1]) + abs(b - GROEN[2]) < 24:
                continue
            if ((x - mx) ** 2 + (y - my) ** 2) ** 0.5 > straal:
                return False, (x, y)
    return True, None

if __name__ == "__main__":
    # Android: volle vierkante achtergrond, Android maskeert zelf.
    android = maak(1024, rond=0.0)
    android.convert("RGB").save(os.path.join(WORTEL, "app-icoon.png"))
    ok, waar = past_in_veilige_cirkel(android)
    print("app-icoon.png       1024  maskable-veilig:", "ja" if ok else ("NEE, loopt uit bij " + str(waar)))

    # iPhone-beginscherm: iOS rondt zelf af.
    maak(180, rond=0.0).convert("RGB").save(os.path.join(WORTEL, "app-icoon-180.png"))
    print("app-icoon-180.png    180")

    # Bureaublad: hier moeten de ronde hoeken er wel zelf in.
    bureau = maak(1024, rond=0.22)
    os.makedirs(BUILD, exist_ok=True)
    bureau.save(os.path.join(BUILD, "icon.png"))
    print("build/icon.png      1024  met ronde hoeken")

    maten = [16, 24, 32, 48, 64, 128, 256]
    bureau.save(os.path.join(BUILD, "icon.ico"), sizes=[(m, m) for m in maten])
    print("build/icon.ico            " + ", ".join(str(m) for m in maten))
