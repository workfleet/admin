"""Regenerate the PWA/Apple icons from the WorkFleet Route W mark.

Redraws public/brand-mark.svg's geometry with PIL rather than rasterising
the SVG - there is no SVG rasteriser on this machine, and the mark is
simple enough (rounded tile, one stroked route, five nodes) to reproduce
exactly. Drawn at 4x and downsampled for antialiasing.

These are all 180px and up, so they use the full mark with its four white
nodes. The compact form (nodes dropped) is only for 16-20px, which is what
public/brand-mark.svg itself carries for the favicon slot.

    python scripts/generate-icons.py
"""
from PIL import Image, ImageDraw

GRAPHITE = (0x20, 0x23, 0x27, 255)
WHITE = (0xFF, 0xFF, 0xFF, 255)
CORAL = (0xFF, 0x6B, 0x5B, 255)

SS = 4          # supersampling factor
VIEW = 64.0     # the SVG viewBox the geometry is authored in

# M8 16 L20 48 L32 20 L44 48 L56 16 - the route. The last stop is coral:
# it's where the cleaner is now.
ROUTE = [(8, 16), (20, 48), (32, 20), (44, 48), (56, 16)]


def render(px, radius=12, scale=0.78):
    """radius is in 64-unit space; scale shrinks the mark about the centre."""
    size = px * SS
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if radius:
        d.rounded_rectangle([0, 0, size - 1, size - 1],
                            radius=radius / VIEW * size, fill=GRAPHITE)
    else:
        d.rectangle([0, 0, size, size], fill=GRAPHITE)

    def pt(x, y):
        c = VIEW / 2
        return ((c + (x - c) * scale) / VIEW * size,
                (c + (y - c) * scale) / VIEW * size)

    d.line([pt(x, y) for x, y in ROUTE], fill=WHITE,
           width=max(1, round(4 * scale / VIEW * size)), joint='curve')

    def node(x, y, r, fill):
        cx, cy = pt(x, y)
        rr = r * scale / VIEW * size
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=fill)

    for x, y in ROUTE[:-1]:
        node(x, y, 5.5, WHITE)
    node(56, 16, 7, CORAL)

    return img.resize((px, px), Image.LANCZOS)


TARGETS = [
    # (path, size, tile radius in 64-space, mark scale)
    ('public/icon-192.png', 192, 12, 0.78),
    ('public/icon-512.png', 512, 12, 0.78),
    # Maskable: Android crops to a circle, so the mark sits well inside the
    # 80% safe zone on a full-bleed ground.
    ('public/icon-512-maskable.png', 512, 0, 0.58),
    # iOS applies its own rounding to a square, full-bleed image.
    ('public/apple-icon.png', 180, 0, 0.72),
]

for path, size, radius, scale in TARGETS:
    render(size, radius, scale).save(path)
    print('wrote %s (%dx%d)' % (path, size, size))
