# /// script
# dependencies = [
#   "pillow",
# ]
# ///

"""
Generate map tiles for all zoom levels (0-7, 9) from level 8.
Supports world map (minimap/{z}/) and dungeons (minimap/d/{z}/).

Usage: uv run generate_tiles.py
"""

from collections import defaultdict
import os
import re
import sys

from PIL import Image

TILE_SIZE = 256
BASE_ZOOM = 8
MIN_ZOOM = 0
MAX_ZOOM = 9
WEBP_QUALITY = 80

BASE_DIR = os.path.join("map", "public", "assets", "img", "silkroad", "minimap")
DUNGEON_DIR = os.path.join(BASE_DIR, "d")


def load_tile(path):
    """Load a tile image, return None if file not found."""
    if os.path.exists(path):
        try:
            return Image.open(path).convert("RGB")
        except Exception as e:
            print(f"  [!] Error loading {path}: {e}")
    return None


def save_tile(img, path):
    """Save a tile as WEBP."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "WEBP", quality=WEBP_QUALITY)


# ---------------------------------------------------------------------------
#  Generate lower zoom levels (z-1 ... 0): merge 2×2 → 1
# ---------------------------------------------------------------------------

def generate_lower_zooms(tiles_by_zoom, zoom_dir_fn, tile_path_fn):
    """
    Recursively generates levels from BASE_ZOOM-1 down to MIN_ZOOM.

    tiles_by_zoom : dict[zoom] -> dict[(x,y)] -> Image
    zoom_dir_fn   : zoom -> path to zoom level directory
    tile_path_fn  : (zoom, x, y) -> path to tile file
    """
    for z in range(BASE_ZOOM - 1, MIN_ZOOM - 1, -1):
        parent_tiles = tiles_by_zoom[z + 1]
        if not parent_tiles:
            print(f"  Level {z}: no source tiles, skipping")
            break

        # Determine parent tile coordinates at the current level
        # Y in files is inverted (tile.y = -tile.y), so parent_y = -(-y // 2)
        parent_coords = set()
        for (x, y) in parent_tiles:
            parent_coords.add((x // 2, -(-y // 2)))

        current_tiles = {}
        for (px, py) in parent_coords:
            merged = Image.new("RGB", (TILE_SIZE * 2, TILE_SIZE * 2))
            has_any = False
            # Children of parent py: y=2py (north/top) and y=2py-1 (south/bottom)
            for dx in (0, 1):
                for child_y, img_y in ((2 * py, 0), (2 * py - 1, TILE_SIZE)):
                    child = parent_tiles.get((2 * px + dx, child_y))
                    if child:
                        merged.paste(child, (dx * TILE_SIZE, img_y))
                        has_any = True

            if has_any:
                resized = merged.resize((TILE_SIZE, TILE_SIZE), Image.LANCZOS)
                if z in (3, 6):
                    path = tile_path_fn(z, px, py)
                    save_tile(resized, path)
                current_tiles[(px, py)] = resized

        tiles_by_zoom[z] = current_tiles
        print(f"  Level {z}: {len(current_tiles)} tiles")


# ---------------------------------------------------------------------------
#  Generate higher zoom level (9): split 1 → 2×2
# ---------------------------------------------------------------------------

def generate_higher_zoom(tiles_z8, tile_path_fn):
    """
    Generates MAX_ZOOM level (9) from BASE_ZOOM level (8).
    Each tile is split into 4 quadrants, each scaled to TILE_SIZE.
    """
    count = 0
    for (x, y), img in tiles_z8.items():
        scaled = img.resize((TILE_SIZE * 2, TILE_SIZE * 2), Image.LANCZOS)
        # Top half (img_y=0) → child y=2y (north)
        # Bottom half (img_y=1) → child y=2y-1 (south)
        for dx in (0, 1):
            for img_y, child_y in ((0, 2 * y), (1, 2 * y - 1)):
                crop = scaled.crop((
                    dx * TILE_SIZE, img_y * TILE_SIZE,
                    (dx + 1) * TILE_SIZE, (img_y + 1) * TILE_SIZE
                ))
                path = tile_path_fn(MAX_ZOOM, 2 * x + dx, child_y)
                save_tile(crop, path)
                count += 1

    print(f"  Level {MAX_ZOOM}: {count} tiles")


# ---------------------------------------------------------------------------
#  World map
# ---------------------------------------------------------------------------

def process_world_map():
    print("=" * 60)
    print("World map")
    print("=" * 60)

    zoom8_dir = os.path.join(BASE_DIR, str(BASE_ZOOM))
    if not os.path.isdir(zoom8_dir):
        print(f"  Directory {zoom8_dir} not found, skipping.")
        return

    # Load all level 8 tiles
    pattern = re.compile(r"^(-?\d+)x(-?\d+)\.webp$", re.IGNORECASE)
    tiles_z8 = {}
    files = [f for f in os.listdir(zoom8_dir) if pattern.match(f)]
    total = len(files)
    print(f"  Loading level {BASE_ZOOM}: {total} tiles...")

    for i, fname in enumerate(files, 1):
        m = pattern.match(fname)
        x, y = int(m.group(1)), int(m.group(2))
        img = load_tile(os.path.join(zoom8_dir, fname))
        if img:
            tiles_z8[(x, y)] = img
        if i % 500 == 0 or i == total:
            print(f"    {i}/{total}")

    print(f"  Loaded {len(tiles_z8)} tiles at level {BASE_ZOOM}")

    def tile_path(z, x, y):
        return os.path.join(BASE_DIR, str(z), f"{x}x{y}.webp")

    # Lower zoom levels
    print("  Generating lower zoom levels (7 -> 0)...")
    tiles_by_zoom = defaultdict(dict)
    tiles_by_zoom[BASE_ZOOM] = tiles_z8
    generate_lower_zooms(tiles_by_zoom, None, tile_path)

    # Higher zoom level
    print("  Generating higher zoom level (9)...")
    generate_higher_zoom(tiles_z8, tile_path)

    # Free memory
    del tiles_by_zoom
    del tiles_z8


# ---------------------------------------------------------------------------
#  Dungeons
# ---------------------------------------------------------------------------

def process_dungeon_maps():
    print()
    print("=" * 60)
    print("Dungeons")
    print("=" * 60)

    zoom8_dir = os.path.join(DUNGEON_DIR, str(BASE_ZOOM))
    if not os.path.isdir(zoom8_dir):
        print(f"  Directory {zoom8_dir} not found, skipping.")
        return

    # Parse filenames: {prefix}_{x}x{y}.webp
    pattern = re.compile(r"^(.+)_(-?\d+)x(-?\d+)\.webp$", re.IGNORECASE)

    # Group by prefix
    groups = defaultdict(dict)
    for fname in os.listdir(zoom8_dir):
        m = pattern.match(fname)
        if m:
            prefix = m.group(1)
            x, y = int(m.group(2)), int(m.group(3))
            groups[prefix][(x, y)] = fname

    print(f"  Found {len(groups)} dungeon maps")

    for prefix, coords in sorted(groups.items()):
        print(f"\n  --- {prefix} ({len(coords)} tiles) ---")

        # Load level 8 tiles
        tiles_z8 = {}
        for (x, y), fname in coords.items():
            img = load_tile(os.path.join(zoom8_dir, fname))
            if img:
                tiles_z8[(x, y)] = img

        if not tiles_z8:
            print("    No loaded tiles, skipping.")
            continue

        def tile_path(z, x, y, _prefix=prefix):
            return os.path.join(DUNGEON_DIR, str(z), f"{_prefix}_{x}x{y}.webp")

        # Lower zoom levels
        tiles_by_zoom = defaultdict(dict)
        tiles_by_zoom[BASE_ZOOM] = tiles_z8
        generate_lower_zooms(tiles_by_zoom, None, tile_path)

        # Higher zoom level
        generate_higher_zoom(tiles_z8, tile_path)

        # Free memory
        del tiles_by_zoom
        del tiles_z8


# ---------------------------------------------------------------------------
#  Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    if not os.path.isdir(BASE_DIR):
        print(f"Error: directory '{BASE_DIR}' not found.")
        print("Run the script from the OpenSilkroadMap project root.")
        sys.exit(1)

    process_world_map()
    process_dungeon_maps()

    print()
    print("Done!")
