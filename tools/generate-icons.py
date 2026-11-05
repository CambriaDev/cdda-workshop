from PIL import Image, ImageDraw
from pathlib import Path
root = Path(__file__).resolve().parents[1] / 'public'
for size in (192, 512):
    image = Image.new('RGB', (size, size), '#111b1b')
    d = ImageDraw.Draw(image)
    s = size / 192
    def coords(points): return [round(p*s) for p in points]
    color = '#b9db8a'
    d.rectangle(coords((43, 66, 149, 125)), outline=color, width=round(10*s))
    for x in (61, 131): d.line(coords((x, 42, x, 149)), fill=color, width=round(10*s))
    d.line(coords((43, 96, 149, 96)), fill=color, width=round(10*s))
    image.save(root / f'icon-{size}.png')
