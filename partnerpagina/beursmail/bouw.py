"""Dolfs Lyon-mail (17 talen) in de Passion-huisstijl: rood, Montserrat, echt logo.
Gebruik: python3 -I beursmail_bouw.py <map met talen> <uitvoermap>"""
import os, re, sys
bron, uit = sys.argv[1], sys.argv[2]
os.makedirs(uit, exist_ok=True)
PP = "https://partner.passionspas.com"
BP_TALEN = {"en", "nl", "de", "fr", "it", "es"}
KNOP = {"nl": "Word partner van Passion Spas", "en": "Become a Passion Spas partner", "de": "Passion Spas Partner werden",
        "fr": "Devenir partenaire Passion Spas", "it": "Diventa partner Passion Spas", "es": "Hazte partner de Passion Spas",
        "pt": "Torne-se parceiro Passion Spas", "sv": "Bli Passion Spas-partner", "da": "Bliv Passion Spas-partner",
        "no": "Bli Passion Spas-partner", "fi": "Ryhdy Passion Spas -kumppaniksi", "pl": "Zostań partnerem Passion Spas",
        "cs": "Staňte se partnerem Passion Spas", "hu": "Legyen a Passion Spas partnere", "ro": "Deveniți partener Passion Spas",
        "bg": "Станете партньор на Passion Spas", "el": "Γίνετε συνεργάτης της Passion Spas"}
FONT = "Montserrat,Arial,Helvetica,sans-serif"
KLEUR = {"#f05d22": "#d6232f", "#c2410c": "#b71c27", "#f6b48f": "#f2a7ad", "#17252e": "#141414", "#33434c": "#2b2b2b",
         "#2f414c": "#3a3a3a", "#e9e4dc": "#e4e1dc", "#f6f2ec": "#f4f2ef", "#2b5138": "#2f5d3a", "#ab2132": "#ee7a1c",
         "#4077bb": "#3f6fb6", "#3d474d": "#4b4b4b", "#7a868c": "#8a8a8a", "#5f6b71": "#6b6b6b", "#5a6870": "#6b6b6b",
         "#e2e2e2": "#e4e1dc"}
for taal in sorted(os.listdir(bron)):
    f = os.path.join(bron, taal, "newsletter_%s.html" % taal)
    if not os.path.isfile(f): continue
    s = open(f, encoding="utf-8").read()
    # Kleurstreep onder de foto: de vier kleuren van de Passion-bloem.
    s = re.sub(r'(<td height="5" bgcolor=")#f05d22', r'\1#ee7a1c', s, flags=re.I)
    for a, b in KLEUR.items(): s = re.sub(re.escape(a), b, s, flags=re.I)
    s = s.replace("font-family:Georgia,'Times New Roman',Times,serif", "font-family:" + FONT + ";font-weight:700")
    s = s.replace("font-family:Arial,Helvetica,sans-serif", "font-family:" + FONT).replace("font-family:Arial,sans-serif", "font-family:" + FONT)
    s = s.replace("font-weight:700;font-weight:normal", "font-weight:700").replace("font-style:italic", "font-style:normal")
    s = s.replace("font-family:'Times New Roman'", "font-family:Arial")  # Outlook-knop
    s = s.replace("</title>", "</title>\n<link href=\"https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap\" rel=\"stylesheet\">", 1)
    s = s.replace("<style>", "<!--[if mso]><style>*{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]-->\n<style>", 1)
    # Logo: het echte Passion-logo in hoge resolutie.
    s = s.replace('src="images/logo_passionspas_onwhite.png"', 'src="' + PP + '/logo.png"')
    # Grote foto: de afgesneden strook (hoofden eraf) wordt het stel met de spa ernaast (foto.py).
    s = re.sub(r'<img src="images/hero_nl_article\.jpg"[^>]*>',
               '<img src="' + PP + '/become-partner/img/lyon.jpg" width="600" alt="Passion Spas" class="fluid" style="display:block;width:100%;max-width:600px;height:auto;border:0;">', s)
    s = s.replace("{{unsubscribe}}", "{{AFMELDEN}}")
    # Meebewegend in plaats van vast 710 breed: in een smal leesvenster (Outlook)
    # moest je opzij scrollen (Gerrit, 3 nov 2026). Outlook voor Windows krijgt 600.
    s = s.replace('class="container" width="710"', 'class="container" width="100%"')
    s = s.replace("width:710px;max-width:710px;", "width:100%;max-width:600px;")
    s = s.replace('<table role="presentation" width="710" align="center"', '<table role="presentation" width="600" align="center"')
    s = s.replace('width="220" alt="Passion Spas', 'width="180" alt="Passion Spas').replace("width:220px;height:auto", "width:180px;max-width:100%;height:auto")
    s = s.replace(".h1{font-size:30px!important;line-height:36px!important;}", ".h1{font-size:23px!important;line-height:29px!important;}")
    assert "710" not in s, taal
    # Knop naar de partnerpagina, onder de beursaanbieding.
    link = PP + "/become-partner?lang=" + (taal if taal in BP_TALEN else "en")
    knop = ('<div style="padding-top:12px;"><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td bgcolor="#ffffff" style="border-radius:30px;background:#ffffff;">'
            '<a href="' + link + '" target="_blank" style="display:inline-block;padding:10px 24px;font-family:' + FONT + ';font-size:15px;font-weight:700;color:#d6232f;text-decoration:none;border-radius:30px;">'
            + KNOP[taal] + ' &rarr;</a></td></tr></table></div></td></tr></table></td></tr>\n<!-- PRACTICAL -->')
    n = s.count("</td></tr></table></td></tr>\n<!-- PRACTICAL -->")
    assert n == 1, (taal, n)
    s = s.replace("</td></tr></table></td></tr>\n<!-- PRACTICAL -->", knop)
    assert "images/" not in s and "Georgia" not in s, taal
    open(os.path.join(uit, taal + ".html"), "w", encoding="utf-8").write(s)
    print(taal, "ok")
