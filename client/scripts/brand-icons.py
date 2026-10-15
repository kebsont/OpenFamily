#!/usr/bin/env python3
"""Put the family's own app name on the app icons (foyers fork).

The default icons have "OpenFamily" drawn under the pictogram. When the image
is built with another APP_NAME, the client Dockerfile runs this script: it
keeps the pictogram, paints the name in the same colours and overwrites the
icons in client/public before the build.

    python3 brand-icons.py "Maison Exemple" client/public

Needs Pillow and a bold font (Inter, else DejaVu Sans). Any failure leaves
the default icons in place.
"""
import glob
import sys

from PIL import Image, ImageDraw, ImageFont

FONT_PATTERNS = [
    '/usr/share/fonts/**/Inter*SemiBold.[ot]tf',
    '/usr/share/fonts/**/Inter-SemiBold*.[ot]tf',
    '/usr/share/fonts/**/Inter-Bold.[ot]tf',
    '/usr/share/fonts/**/DejaVuSans-Bold.ttf',
]

# Where the name is drawn on the 1500 px master (OpenFamily.png), found by
# looking for its coral pixels: the pictogram ends above BAND_TOP.
BAND_TOP, BAND_BOTTOM, TEXT_TOP, TEXT_BOTTOM = 1040, 1420, 1076, 1337


def find_font():
    for pattern in FONT_PATTERNS:
        for path in sorted(glob.glob(pattern, recursive=True)):
            if 'Italic' not in path and 'Display' not in path:
                return path
    return None


def text_colours(img):
    """Average colour of the drawn name on its left and right ends."""
    px = img.load()
    w = img.size[0]

    def average(x0, x1):
        total, n = [0, 0, 0], 0
        for y in range(TEXT_TOP, TEXT_BOTTOM, 2):
            for x in range(x0, x1, 2):
                r, g, b, a = px[x, y]
                if a > 200 and r > 180 and r - b > 60:
                    total[0] += r
                    total[1] += g
                    total[2] += b
                    n += 1
        return tuple(c // max(n, 1) for c in total) if n else (240, 90, 100)

    return average(0, w // 5), average(w * 4 // 5, w)


def erase_name(img):
    """Repaint the band under the pictogram with the background."""
    px = img.load()
    w = img.size[0]
    base = px[w // 10, BAND_BOTTOM]
    for x in range(w):
        top = px[x, BAND_TOP]
        for y in range(BAND_TOP, BAND_BOTTOM):
            a = px[x, y][3]
            if a == 0:
                continue
            t = (y - BAND_TOP) / (BAND_BOTTOM - BAND_TOP)
            px[x, y] = tuple(round(top[i] + (base[i] - top[i]) * t) for i in range(3)) + (a,)


def draw_name(img, name, font_path, left, right):
    w = img.size[0]
    max_width, max_height = int(w * 0.86), int((TEXT_BOTTOM - TEXT_TOP) * 0.78)
    size = 400
    while size > 20:
        font = ImageFont.truetype(font_path, size) if font_path else ImageFont.load_default(size)
        x0, y0, x1, y1 = font.getbbox(name)
        if x1 - x0 <= max_width and y1 - y0 <= max_height:
            break
        size -= 8
    mask = Image.new('L', img.size, 0)
    x0, y0, x1, y1 = font.getbbox(name)
    x = (w - (x1 - x0)) // 2 - x0
    y = (TEXT_TOP + TEXT_BOTTOM) // 2 - (y0 + y1) // 2
    ImageDraw.Draw(mask).text((x, y), name, font=font, fill=255)

    gradient = Image.new('RGBA', img.size)
    gpx = gradient.load()
    start, end = (w - (x1 - x0)) // 2, (w + (x1 - x0)) // 2
    for gx in range(w):
        t = min(1.0, max(0.0, (gx - start) / max(1, end - start)))
        colour = tuple(round(left[i] + (right[i] - left[i]) * t) for i in range(3)) + (255,)
        for gy in range(TEXT_TOP - 40, TEXT_BOTTOM + 40):
            gpx[gx, gy] = colour
    img.paste(gradient, (0, 0), mask)


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    name, public = sys.argv[1].strip(), sys.argv[2].rstrip('/')
    master = Image.open(f'{public}/OpenFamily.png').convert('RGBA')
    if master.size != (1500, 1500):
        print('brand-icons: unexpected master size, default icons kept')
        return 1
    left, right = text_colours(master)
    erase_name(master)
    draw_name(master, name, find_font(), left, right)

    master.save(f'{public}/OpenFamily.png', optimize=True)
    for file, size in [('icon-512.png', 512), ('icon-192.png', 192), ('apple-touch-icon.png', 180),
                       ('favicon-32x32.png', 32), ('favicon-16x16.png', 16)]:
        master.resize((size, size), Image.LANCZOS).save(f'{public}/{file}', optimize=True)
    print(f'brand-icons: icons now read "{name}"')
    return 0


if __name__ == '__main__':
    sys.exit(main())
