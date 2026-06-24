# /// script
# dependencies = [
#   "pmtiles",
# ]
# ///

import os
import re
from pmtiles.writer import write
from pmtiles.tile import zxy_to_tileid, TileType, Compression

BASE_DIR = os.path.join("map", "public", "assets", "img", "silkroad", "minimap")
OUTPUT_DIR = os.path.join("map", "public", "assets")

DUNGEON_PREFIXES = {
    "32769_1": "dh_a01_floor01",
    "32769_2": "dh_a01_floor02",
    "32769_3": "dh_a01_floor03",
    "32769_4": "dh_a01_floor04",
    "32775": "qt_a01_floor01",
    "32774": "qt_a01_floor02",
    "32773": "qt_a01_floor03",
    "32772": "qt_a01_floor04",
    "32771": "qt_a01_floor05",
    "32770": "qt_a01_floor06",
    "32784": "rn_sd_egypt1_01",
    "32786": "flame_dungeon01",
    "32785": "fort_dungeon01",
}


def create_pmtiles(output_name, get_tiles_fn, description):
    output_path = os.path.join(OUTPUT_DIR, output_name)
    print(f"Creating {output_name} ({description})...")

    tiles = get_tiles_fn()
    if not tiles:
        print(f"  No tiles found for {output_name}, skipping.")
        return

    # Sort tiles by tile ID as required by PMTiles specification
    sorted_tiles = sorted(tiles, key=lambda t: t[0])

    with write(output_path) as w:
        for tile_id, file_path, _ in sorted_tiles:
            with open(file_path, "rb") as f:
                w.write_tile(tile_id, f.read())

        w.finalize(
            {
                "tile_type": TileType.WEBP,
                "tile_compression": Compression.NONE,
                "min_zoom": min(tile[2] for tile in tiles),
                "max_zoom": max(tile[2] for tile in tiles),
            },
            {"name": output_name, "description": description},
        )
    print(f"  Successfully wrote {len(tiles)} tiles to {output_path}")


def get_world_tiles():
    tiles = []
    # Search in BASE_DIR for zoom levels
    pattern = re.compile(r"^((-?\d+)x(-?\d+))\.webp$", re.IGNORECASE)
    for z_str in os.listdir(BASE_DIR):
        if not z_str.isdigit():
            continue
        z = int(z_str)
        z_dir = os.path.join(BASE_DIR, z_str)
        if not os.path.isdir(z_dir):
            continue
        for fname in os.listdir(z_dir):
            m = pattern.match(fname)
            if m:
                x = int(m.group(2))
                y = int(m.group(3))
                if x >= 0 and y >= 0:
                    tile_id = zxy_to_tileid(z, x, y)
                    tiles.append((tile_id, os.path.join(z_dir, fname), z))
    return tiles


def get_navmesh_world_tiles():
    tiles = []
    navmesh_dir = os.path.join(BASE_DIR, "navmesh")
    if not os.path.isdir(navmesh_dir):
        return tiles
    pattern = re.compile(r"^((-?\d+)x(-?\d+))\.webp$", re.IGNORECASE)
    for z_str in os.listdir(navmesh_dir):
        if not z_str.isdigit():
            continue
        z = int(z_str)
        z_dir = os.path.join(navmesh_dir, z_str)
        if not os.path.isdir(z_dir):
            continue
        for fname in os.listdir(z_dir):
            m = pattern.match(fname)
            if m:
                x = int(m.group(2))
                y = int(m.group(3))
                if x >= 0 and y >= 0:
                    tile_id = zxy_to_tileid(z, x, y)
                    tiles.append((tile_id, os.path.join(z_dir, fname), z))
    return tiles


def get_dungeon_tiles(prefix):
    tiles = []
    dungeon_dir = os.path.join(BASE_DIR, "d")
    if not os.path.isdir(dungeon_dir):
        return tiles
    pattern = re.compile(rf"^{prefix}_(-?\d+)x(-?\d+)\.webp$", re.IGNORECASE)
    for z_str in os.listdir(dungeon_dir):
        if not z_str.isdigit():
            continue
        z = int(z_str)
        z_dir = os.path.join(dungeon_dir, z_str)
        if not os.path.isdir(z_dir):
            continue
        for fname in os.listdir(z_dir):
            m = pattern.match(fname)
            if m:
                x = int(m.group(1))
                y = int(m.group(2))
                if x >= 0 and y >= 0:
                    tile_id = zxy_to_tileid(z, x, y)
                    tiles.append((tile_id, os.path.join(z_dir, fname), z))
    return tiles


if __name__ == "__main__":
    if not os.path.isdir(BASE_DIR):
        print(f"Error: directory '{BASE_DIR}' not found.")
        exit(1)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 1. Create world.pmtiles
    create_pmtiles("world.pmtiles", get_world_tiles, "World Map Background Tiles")

    # 2. Create navmesh_world.pmtiles
    create_pmtiles("navmesh_world.pmtiles", get_navmesh_world_tiles, "World Navmesh Tiles")

    # 3. Create dungeon layers
    for layer_key, prefix in DUNGEON_PREFIXES.items():
        create_pmtiles(
            f"{layer_key}.pmtiles", lambda p=prefix: get_dungeon_tiles(p), f"Dungeon Map {layer_key} Background Tiles"
        )

    print("\nPMTiles generation completed!")
