from PIL import Image
import random, os

OUT = "public/images/blocks"
S = 16          # texture is 16x16, like the real thing
SCALE = 4       # upscaled with NEAREST so it stays crisp pixel art

def shade(c, d):
    return tuple(max(0, min(255, v + d)) for v in c)

def noisy(base, spread, rnd, rough=1):
    """Flat block face with per-pixel shading, the way MC stone/dirt look."""
    img = Image.new("RGBA", (S, S))
    px = img.load()
    for y in range(S):
        for x in range(S):
            d = rnd.randint(-spread, spread)
            if rough > 1 and rnd.random() < 0.12:
                d += rnd.choice((-spread, spread)) * rough
            px[x, y] = shade(base, d) + (255,)
    return img

def bevel(img, light=34, dark=44):
    """Top/left highlight, bottom/right shadow - reads as a 3D block."""
    px = img.load()
    for i in range(S):
        px[i, 0] = shade(px[i, 0][:3], light) + (255,)
        px[0, i] = shade(px[0, i][:3], light) + (255,)
        px[i, S - 1] = shade(px[i, S - 1][:3], -dark) + (255,)
        px[S - 1, i] = shade(px[S - 1, i][:3], -dark) + (255,)
    return img

def speckle(img, colour, rnd, blobs=5, size=(2, 3)):
    """Ore blobs scattered over a stone face."""
    px = img.load()
    for _ in range(blobs):
        w = rnd.randint(*size); h = rnd.randint(*size)
        ox = rnd.randint(1, S - w - 1); oy = rnd.randint(1, S - h - 1)
        for y in range(oy, oy + h):
            for x in range(ox, ox + w):
                if rnd.random() < 0.82:
                    px[x, y] = shade(colour, rnd.randint(-18, 22)) + (255,)
    return img

def planks(base, rnd):
    img = Image.new("RGBA", (S, S))
    px = img.load()
    for y in range(S):
        row = shade(base, -14 if (y // 4) % 2 else 6)
        for x in range(S):
            v = shade(row, rnd.randint(-10, 10))
            if y % 4 == 0:            # the seam between planks
                v = shade(row, -42)
            if rnd.random() < 0.10:   # grain
                v = shade(v, -16)
            px[x, y] = v + (255,)
    for x in range(S):                # vertical join
        px[7, x] = shade(px[7, x][:3], -34) + (255,)
    return img

def grass(rnd):
    img = noisy((134, 96, 67), 12, rnd)     # dirt body
    px = img.load()
    for y in range(8):                      # green cap with a ragged edge
        for x in range(S):
            if y < 5 or rnd.random() < 0.6 - (y - 5) * 0.3:
                px[x, y] = shade((106, 170, 74), rnd.randint(-16, 16)) + (255,)
    return img

def tnt(rnd):
    img = Image.new("RGBA", (S, S))
    px = img.load()
    for y in range(S):
        for x in range(S):
            if 5 <= y <= 10:
                c = shade((228, 228, 228), rnd.randint(-10, 10))     # white band
            else:
                c = shade((190, 46, 40), rnd.randint(-14, 14))       # red body
            px[x, y] = c + (255,)
    for x in range(2, 14):                  # the "TNT" bar
        px[x, 7] = (48, 48, 48, 255)
        px[x, 8] = (48, 48, 48, 255)
    for x in (2, 3, 7, 8, 12, 13):          # crude lettering
        px[x, 6] = (48, 48, 48, 255)
        px[x, 9] = (48, 48, 48, 255)
    return img

STONE = (128, 128, 128)

def build():
    os.makedirs(OUT, exist_ok=True)
    made = []
    recipes = {
        # --- Block Breaker: 8 blocks, one clearly distinct hue each ---
        "grass":     lambda r: grass(r),
        "dirt":      lambda r: noisy((134, 96, 67), 16, r, rough=1),
        "stone":     lambda r: noisy(STONE, 14, r, rough=1),
        "planks":    lambda r: planks((178, 137, 86), r),
        "diamond":   lambda r: noisy((97, 219, 214), 16, r),
        "gold":      lambda r: noisy((246, 208, 61), 14, r),
        "redstone":  lambda r: noisy((176, 46, 38), 16, r),
        "obsidian":  lambda r: noisy((22, 15, 38), 12, r, rough=1),
        # --- Diamond Rush: ores on a stone face ---
        "ore-coal":    lambda r: speckle(noisy(STONE, 12, r), (28, 28, 28), r, 6),
        "ore-iron":    lambda r: speckle(noisy(STONE, 12, r), (198, 152, 111), r, 6),
        "ore-gold":    lambda r: speckle(noisy(STONE, 12, r), (246, 208, 61), r, 5),
        "ore-diamond": lambda r: speckle(noisy(STONE, 12, r), (97, 219, 214), r, 5, (2, 4)),
        "ore-emerald": lambda r: speckle(noisy(STONE, 12, r), (57, 199, 108), r, 5, (2, 4)),
        "tnt":         lambda r: tnt(r),
    }
    for name, fn in recipes.items():
        rnd = random.Random(hash(name) & 0xFFFF)   # deterministic per block
        img = bevel(fn(rnd))
        img = img.resize((S * SCALE, S * SCALE), Image.NEAREST)
        path = f"{OUT}/{name}.png"
        img.save(path, optimize=True)
        made.append((name, os.path.getsize(path)))
    return made

for name, size in build():
    print(f"{name:14s} {size:5d} B")
