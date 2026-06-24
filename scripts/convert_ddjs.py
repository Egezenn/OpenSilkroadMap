# /// script
# dependencies = [
#   "pillow",
# ]
# ///

import glob
import io
import os

from PIL import Image


def convert_ddj_to_webp(input_path, output_path):
    try:
        with open(input_path, "rb") as f:
            # Skip 20-byte JMX header
            f.seek(20)
            dds_data = f.read()

        # Use io.BytesIO to feed to Pillow
        img = Image.open(io.BytesIO(dds_data))
        # Convert to RGB (DDS can be various formats, minimaps are usually DXT1/RGB)
        img = img.convert("RGB")

        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        img.save(output_path, "WEBP", quality=80)
        return True
    except Exception as e:
        print(f"  [!] Error converting {input_path}: {e}")
        return False


def main():
    world_src = r"game_source/Media/minimap"
    world_dst = r"map/public/assets/img/silkroad/minimap/8"

    dungeon_src = r"game_source/Media/minimap_d"
    dungeon_dst = r"map/public/assets/img/silkroad/minimap/d/8"

    # Process World Map
    if os.path.isdir(world_src):
        print(f"Processing World Map from {world_src}...")
        files = glob.glob(os.path.join(world_src, "*.ddj"))
        count = 0
        for i, f in enumerate(files, 1):
            basename = os.path.basename(f).replace(".ddj", ".webp")
            if convert_ddj_to_webp(f, os.path.join(world_dst, basename)):
                count += 1
            if i % 500 == 0:
                print(f"  Processed {i}/{len(files)}...")
        print(f"Done! Converted {count} world tiles.")
    else:
        print(f"Skipping World Map: {world_src} not found.")

    # Process Dungeons
    if os.path.isdir(dungeon_src):
        print(f"\nProcessing Dungeons from {dungeon_src}...")
        count = 0
        for root, dirs, files in os.walk(dungeon_src):
            for f in files:
                if f.endswith(".ddj"):
                    input_path = os.path.join(root, f)
                    basename = f.replace(".ddj", ".webp")
                    if convert_ddj_to_webp(input_path, os.path.join(dungeon_dst, basename)):
                        count += 1
        print(f"Done! Converted {count} dungeon tiles.")
    else:
        print(f"Skipping Dungeons: {dungeon_src} not found.")


if __name__ == "__main__":
    main()
