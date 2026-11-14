# Generates simple test images (gesture-like scenes) for Drex Max image probing.
import sys, os
from PIL import Image, ImageDraw
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
def scene(name, arm):
    im = Image.new('RGB', (640, 480), (235, 235, 230)); d = ImageDraw.Draw(im)
    d.ellipse((290, 80, 350, 140), fill=(200, 160, 120))  # head
    d.line((320, 140, 320, 300), fill=(40, 40, 40), width=14)  # body
    d.line((320, 300, 280, 420), fill=(40, 40, 40), width=12); d.line((320, 300, 360, 420), fill=(40, 40, 40), width=12)
    L = {'both_up': [((320,170),(250,60)),((320,170),(390,60))], 'left_up': [((320,170),(250,60)),((320,170),(390,260))],
         'right_up': [((320,170),(250,260)),((320,170),(390,60))], 'down': [((320,170),(250,260)),((320,170),(390,260))]}[arm]
    for a, b in L: d.line((a, b), fill=(40, 40, 40), width=12)
    im.save(f'{out}/{name}.jpg', quality=80)
for n in ['both_up', 'left_up', 'right_up', 'down']: scene(n, n)
