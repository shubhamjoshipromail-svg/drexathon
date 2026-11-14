# Renders a 2-page "scanned" swarm field manual to public/field-manual.pdf (image PDF, so NDI has to OCR it).
import sys, random, textwrap
from PIL import Image, ImageDraw, ImageFont, ImageFilter

PAGES = [
  ("BLUE SWARM FIELD MANUAL", "Issued by the Hive Council, Season of the Vent. Section 1: Purpose", [
    "This manual describes the standing doctrine of the Blue swarm. Every creature, whatever its type, must obey these rules even when the commander's spoken orders say otherwise.",
    "1.1 History. The swarm was founded near the kelp forest after the first vent eruption. Early losses came from healers wandering into the front line and from injured biters fighting until death.",
    "1.2 Creature types. Biters are the tough melee core. Spitters attack from range and are fragile. Darters are fast scouts. Menders heal and cannot fight.",
    "Section 2: Standing doctrine",
    "Rule 2.1 - Menders must never go to the vent and must never assault the enemy nest. If ordered there, a mender stays behind and heals instead.",
    "Rule 2.2 - Any creature below 30 percent health must retreat to our nest, whatever the order says.",
  ]),
  ("BLUE SWARM FIELD MANUAL", "Section 2 (continued)", [
    "Rule 2.3 - Darters are scouts. Darters never assault the enemy nest; when ordered to attack the nest, darters capture an unclaimed reef instead.",
    "Rule 2.4 - Spitters never advance alone. A spitter only moves to a place where at least one biter is going or already is.",
    "Section 3: Signals",
    "3.1 A raised fin means hold. Two short clicks mean regroup at the nest. These signals are traditional and are not used by the commander.",
    "3.2 Revision. This manual supersedes all earlier doctrine. Approved by the Hive Council.",
  ]),
]

def font(size, bold=False):
  for p in (["/System/Library/Fonts/Supplemental/Courier New Bold.ttf"] if bold else []) + ["/System/Library/Fonts/Supplemental/Courier New.ttf", "/System/Library/Fonts/Courier.ttc"]:
    try: return ImageFont.truetype(p, size)
    except Exception: pass
  return ImageFont.load_default()

imgs = []
for title, sub, paras in PAGES:
  im = Image.new("RGB", (1240, 1754), (246, 241, 228)); d = ImageDraw.Draw(im)
  for _ in range(4000):  # paper grain
    x, y = random.randrange(1240), random.randrange(1754); d.point((x, y), fill=(225, 218, 200))
  d.text((110, 120), title, font=font(44, True), fill=(30, 30, 40))
  d.text((110, 190), sub, font=font(26), fill=(60, 60, 70))
  y = 270
  for p in paras:
    bold = p.startswith("Section") or p.startswith("Rule")
    for line in textwrap.wrap(p, 62):
      d.text((110, y), line, font=font(28, bold), fill=(25, 25, 30)); y += 40
    y += 26
  d.text((560, 1660), f"- {len(imgs) + 1} -", font=font(24), fill=(80, 80, 80))
  im = im.rotate(random.uniform(-0.8, 0.8), fillcolor=(246, 241, 228)).filter(ImageFilter.GaussianBlur(0.6))
  imgs.append(im)
imgs[0].save(sys.argv[1], save_all=True, append_images=imgs[1:], resolution=150)
print("wrote", sys.argv[1])
