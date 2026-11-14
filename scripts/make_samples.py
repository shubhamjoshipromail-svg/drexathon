# Renders the two Cabinet sample PDFs (image PDFs, so NDI has to OCR them):
#   samples/constitution.pdf  - personal constitution: 6 ministries, 2 vetoes, 2/3 rule for big money, leader override
#   samples/offer-letter.pdf  - startup offer: salary, equity, 1-year cliff, runway
import random, textwrap, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

CONSTITUTION = [
  ("THE CONSTITUTION OF MY LIFE", "Adopted by me, the Prime Minister, on 1 January 2026", [
    "Preamble. Big decisions in my life are made by a cabinet of ministries, not by my mood on the day. Each ministry protects one part of what I value. The rules below bind every decision I make about work, money, where I live and how I spend my time.",
    "Article 1: The Ministries",
    "1.1 Ministry of Finance. Protects my savings and financial security. Vote weight: 2. No veto.",
    "1.2 Ministry of Health. Protects my sleep, body and mental health. Vote weight: 1. Holds a VETO over any decision that would make me work more than 55 hours a week or sleep less than 7 hours a night.",
    "1.3 Ministry of Family. Protects time with my partner Sam and my parents. Vote weight: 1. Holds a VETO over any decision that requires moving to another city.",
    "1.4 Ministry of Ambition. Protects my career growth and the impact of my work. Vote weight: 2. No veto.",
    "1.5 Ministry of Adventure. Protects curiosity, novelty and joy. Vote weight: 1. No veto.",
    "1.6 Ministry of the Future Self. Protects who I will be in ten years: skills, health and wealth that compound. Vote weight: 1. No veto.",
  ]),
  ("THE CONSTITUTION OF MY LIFE", "Articles 2 to 4", [
    "Article 2: Standing Rules",
    "Rule 2.1 (Finance). My emergency fund never falls below 6 months of living expenses, which is $27,000.",
    "Rule 2.2 (Health). I sleep at least 7 hours a night and I do not work more than 55 hours in a week.",
    "Rule 2.3 (Family). Sundays belong to Sam and my family. No work on Sundays.",
    "Rule 2.4 (Ambition). In my thirties I choose the job where I learn fastest, not the job that pays most.",
    "Rule 2.5 (Adventure). Once a year I take one bet that scares me.",
    "Rule 2.6 (Future Self). I never join a company with less than 12 months of runway.",
    "Rule 2.7 (All ministries). No big decision is final until I have slept on it for 48 hours.",
    "Article 3: Passage",
    "3.1 A decision passes by a simple majority of weighted votes.",
    "3.2 Any decision that risks more than $20,000 or changes my job needs a two-thirds majority of weighted votes.",
    "Article 4: The Prime Minister",
    "4.1 The Prime Minister may override a veto only if a two-thirds majority of weighted votes supports the decision and the vetoing ministry's condition is written down and accepted.",
  ]),
]

OFFER = [
  ("LUMEN LABS, INC.", "1200 Congress Ave, Austin, TX 78701  |  10 November 2026", [
    "Dear Candidate,",
    "We are delighted to offer you the position of Founding Engineer at Lumen Labs, Inc. This letter sets out the terms of our offer.",
    "1. Base salary. Your base salary will be $120,000 per year, paid twice a month.",
    "2. Equity. You will be granted options to purchase 0.75% of the fully diluted shares of the company, vesting over 4 years with a 1-year cliff. If you leave before your first anniversary, no options vest.",
    "3. Start date. Your start date will be 4 January 2027.",
    "4. Location. This is a hybrid role based in our Austin, Texas office, in the office at least 3 days per week. We offer a $10,000 relocation stipend.",
    "5. Hours. We are an early-stage team. Weeks of 50 to 60 hours are common during launches.",
  ]),
  ("LUMEN LABS, INC.", "Offer letter, page 2", [
    "6. Company status. Lumen Labs raised a $2.1M seed round in March 2026. At our current burn of $150,000 per month we have about 14 months of runway.",
    "7. Benefits. Health, dental and vision insurance from day one. Unlimited paid time off.",
    "8. Expiry. This offer expires on 21 November 2026.",
    "We believe you will do the best work of your career here. Please sign and return this letter to accept.",
    "Sincerely, Priya Raman, CEO, Lumen Labs, Inc.",
  ]),
]

def font(size, bold=False):
  for p in (["/System/Library/Fonts/Supplemental/Georgia Bold.ttf"] if bold else []) + ["/System/Library/Fonts/Supplemental/Georgia.ttf", "/System/Library/Fonts/Supplemental/Times New Roman.ttf"]:
    try: return ImageFont.truetype(p, size)
    except Exception: pass
  return ImageFont.load_default()

def render(pages, out):
  imgs = []
  for title, sub, paras in pages:
    im = Image.new("RGB", (1240, 1754), (250, 248, 242)); d = ImageDraw.Draw(im)
    for _ in range(3000):
      d.point((random.randrange(1240), random.randrange(1754)), fill=(232, 228, 216))
    d.text((110, 110), title, font=font(46, True), fill=(25, 25, 35))
    d.text((110, 180), sub, font=font(24), fill=(70, 70, 80))
    y = 250
    for p in paras:
      bold = p.startswith(("Article", "Preamble"))
      for line in textwrap.wrap(p, 70):
        d.text((110, y), line, font=font(27, bold), fill=(20, 20, 28)); y += 38
      y += 20
    d.text((590, 1670), f"- {len(imgs) + 1} -", font=font(22), fill=(90, 90, 90))
    imgs.append(im.rotate(random.uniform(-0.5, 0.5), fillcolor=(250, 248, 242)).filter(ImageFilter.GaussianBlur(0.4)))
  imgs[0].save(out, save_all=True, append_images=imgs[1:], resolution=150)
  print("wrote", out)

os.makedirs("samples", exist_ok=True)
render(CONSTITUTION, "samples/constitution.pdf")
render(OFFER, "samples/offer-letter.pdf")
