import sys
from PIL import Image, ImageChops
stel, spa, uit = sys.argv[1:4]
W, H, L = 1200, 520, 640          # links het stel, rechts de spa op wit
bg = Image.new("RGB", (W, H), (255, 255, 255))
f = Image.open(stel).convert("RGB"); fw, fh = f.size
# Uitsnede rond het stel (bovenste helft van de foto, iets links van het midden).
cw = int(fw * 0.62); ch = int(cw * H / (L + 120)); x0 = int(fw * 0.04); y0 = int(fh * 0.07)
f = f.crop((x0, y0, x0 + cw, y0 + ch)).resize((L + 120, H), Image.LANCZOS)
# Zachte overgang naar wit aan de rechterkant van de foto.
m = Image.new("L", f.size, 255)
for i in range(120):
    for y in range(H): m.putpixel((L + i, y), int(255 * (1 - i / 119) ** 1.6))
bg.paste(f, (0, 0), m)
s = Image.open(spa).convert("RGB")
sh = int(H * 0.80); sw = int(s.size[0] * sh / s.size[1])
if sw > W - L - 10: sw = W - L - 10; sh = int(s.size[1] * sw / s.size[0])
s = s.resize((sw, sh), Image.LANCZOS)
# Vermenigvuldigen: het witte vlak rond de spa valt weg, ook over de overgang.
x, y = W - sw - 14, (H - sh) // 2 + 10
vak = bg.crop((x, y, x + sw, y + sh))
bg.paste(ImageChops.multiply(vak, s), (x, y))
bg.save(uit, "JPEG", quality=84, optimize=True, progressive=True)
