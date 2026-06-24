import os
import glob
import json
import sys

# Configure stdout to use UTF-8
sys.stdout.reconfigure(encoding="utf-8")


def to_signed_16(val):
    try:
        v = int(float(val))
        if v >= 32768:
            return v - 65536
        return v
    except ValueError:
        return 0


def find_file_case_insensitive(directory, filename):
    lower_name = filename.lower()
    for f in os.listdir(directory):
        if f.lower() == lower_name:
            return os.path.join(directory, f)
    return os.path.join(directory, filename)


def main():
    base_dir = r"game_source/Media/server_dep/silkroad/textdata"
    if not os.path.exists(base_dir):
        print(f"Error: Directory {base_dir} not found.")
        sys.exit(1)

    print("Step 1: Merging characterdata_*.txt files...")
    char_files = sorted(
        glob.glob(os.path.join(base_dir, "characterdata_*.txt")), key=lambda x: os.path.basename(x).lower()
    )

    merged_char_path = os.path.join(base_dir, "characterdata_all.txt")
    print(f"Found {len(char_files)} characterdata files to merge.")

    with open(merged_char_path, "w", encoding="utf-16", errors="replace") as outfile:
        for filepath in char_files:
            # Skip merging characterdata_all.txt itself if it exists
            if "characterdata_all.txt" in filepath.lower():
                continue
            try:
                with open(filepath, "r", encoding="utf-16", errors="replace") as infile:
                    for line in infile:
                        # Clean BOM or junk if any, but since we read as utf-16, Python handles BOM
                        outfile.write(line)
            except Exception as e:
                print(f"  Warning: failed to merge {filepath}: {e}")

    print("Step 2: Loading object translations...")
    translations = {}
    obj_files = glob.glob(os.path.join(base_dir, "textdata_object_*.txt"))
    for filepath in obj_files:
        try:
            with open(filepath, "r", encoding="utf-16", errors="replace") as f:
                for line in f:
                    parts = line.strip().split("\t")
                    if len(parts) >= 4 and parts[0] == "1":
                        key = parts[2]
                        val = parts[3]
                        # Column 9 contains the English translation if present
                        if len(parts) > 9 and parts[9] not in ("0", "xxx", ""):
                            val = parts[9]
                        translations[key] = val
        except Exception as e:
            print(f"  Warning: failed to read translations from {filepath}: {e}")

    print("Step 3: Loading zone translations...")
    zone_translations = {}
    zone_files = glob.glob(os.path.join(base_dir, "textzonename_*.txt"))
    for filepath in zone_files:
        try:
            with open(filepath, "r", encoding="utf-16", errors="replace") as f:
                for line in f:
                    parts = line.strip().split("\t")
                    if len(parts) >= 4 and parts[0] == "1":
                        # region ID is at parts[2]
                        # Korean name at parts[3], English name at parts[9]
                        reg_id = parts[2]
                        val = parts[3]
                        if len(parts) > 9 and parts[9] not in ("0", "xxx", ""):
                            val = parts[9]
                        zone_translations[reg_id] = val
        except Exception as e:
            print(f"  Warning: failed to read zone translations from {filepath}: {e}")

    print("Step 4: Extracting NPC templates...")
    # Load templates from the merged file
    char_templates = {}
    try:
        with open(merged_char_path, "r", encoding="utf-16", errors="replace") as f:
            for line in f:
                parts = line.strip().split("\t")
                if len(parts) >= 6 and parts[0] == "1":
                    cid = parts[1]
                    code = parts[2]
                    name_key = parts[5]
                    # Filter for NPCs and Structures
                    if code.startswith("NPC_") or code.startswith("STRUCTURE_"):
                        if name_key in translations:
                            name = translations[name_key]
                            if name not in ("0", "xxx", ""):
                                char_templates[cid] = {"codename": code, "name": name, "name_key": name_key}
    except Exception as e:
        print(f"Error reading merged characterdata: {e}")
        sys.exit(1)

    print(f"Loaded {len(char_templates)} NPC templates from characterdata_all.txt.")

    print("Step 5: Loading teleport buildings...")
    buildings = {}
    path_bldg = find_file_case_insensitive(base_dir, "teleportbuilding.txt")
    if os.path.exists(path_bldg):
        with open(path_bldg, "r", encoding="utf-16", errors="replace") as f:
            for line in f:
                parts = line.strip().split("\t")
                if len(parts) >= 46 and parts[1].isdigit():
                    bid = parts[1]
                    codename = parts[2]
                    namestrid = parts[5]
                    b_type = parts[12]
                    region = to_signed_16(parts[41])
                    x = float(parts[43])
                    z = float(parts[44])
                    y = float(parts[45])

                    name = translations.get(namestrid, codename)
                    buildings[bid] = {
                        "building_id": bid,
                        "codename": codename,
                        "name": name,
                        "type": b_type,
                        "region": region,
                        "x": x,
                        "z": z,
                        "y": y,
                    }
    print(f"Loaded {len(buildings)} teleport buildings.")

    print("Step 6: Loading teleport data...")
    teleports = {}
    path_tdata = find_file_case_insensitive(base_dir, "TeleportData.txt")
    if os.path.exists(path_tdata):
        with open(path_tdata, "r", encoding="utf-16", errors="replace") as f:
            for line in f:
                parts = line.strip().split("\t")
                if len(parts) >= 9 and parts[1].isdigit():
                    tid = parts[1]
                    codename = parts[2]
                    bid = parts[3]
                    namestrid = parts[4]
                    region = to_signed_16(parts[5])
                    x = float(parts[6])
                    z = float(parts[7])
                    y = float(parts[8])

                    # Resolve name of the teleport
                    name = translations.get(namestrid)
                    if not name or name in ("0", "xxx"):
                        # Try to resolve zone translation
                        name = zone_translations.get(str(region), codename)

                    teleports[tid] = {
                        "teleport_id": tid,
                        "codename": codename,
                        "building_id": bid,
                        "name": name,
                        "region": region,
                        "x": x,
                        "z": z,
                        "y": y,
                    }
    print(f"Loaded {len(teleports)} teleport entries.")

    print("Step 7: Loading teleport links...")
    links = {}
    path_link = find_file_case_insensitive(base_dir, "teleportlink.txt")
    if os.path.exists(path_link):
        with open(path_link, "r", encoding="utf-16", errors="replace") as f:
            for line in f:
                parts = line.strip().split("\t")
                if len(parts) >= 3 and parts[1].isdigit() and parts[2].isdigit():
                    src = parts[1]
                    dst = parts[2]
                    if src not in links:
                        links[src] = []
                    links[src].append(dst)
    print(f"Loaded links for {len(links)} teleports.")

    print("Step 8: Constructing teleports and mapping destinations...")
    teleports_output = []
    npc_teleport_links = {}  # building_id (char_id) -> list of destinations

    for tid, t in teleports.items():
        bid = t["building_id"]
        destinations = []
        for dst_id in links.get(tid, []):
            dest_t = teleports.get(dst_id)
            if dest_t:
                destinations.append(
                    {
                        "name": dest_t["name"],
                        "region": int(dest_t["region"]),
                        "x": int(dest_t["x"]),
                        "z": int(dest_t["z"]),
                        "y": int(dest_t["y"]),
                        "target_id": int(dst_id),
                    }
                )

        # If this is linked to an NPC (e.g. building_id corresponds to a char ID)
        if bid in char_templates:
            npc_teleport_links[bid] = destinations
            continue

        # Determine location and type of physical teleport
        if bid in buildings:
            b = buildings[bid]
            t_name = b["name"]
            t_codename = b["codename"]
            t_region = int(b["region"])
            t_x = int(b["x"])
            t_z = int(b["z"])
            t_y = int(b["y"])
            # Map type
            b_type = b["type"]
            if b_type == "1":
                t_type = 1
            elif b_type == "2":
                t_type = 2
            elif b_type == "3":
                t_type = 3
            elif b_type == "0":
                if any(k in b["codename"].upper() for k in ("MOUNTAIN", "RULER", "TAHOMET")):
                    t_type = 6
                else:
                    t_type = 0
            else:
                t_type = 0
        else:
            t_name = t["name"]
            t_codename = t["codename"]
            t_region = int(t["region"])
            t_x = int(t["x"])
            t_z = int(t["z"])
            t_y = int(t["y"])
            t_type = 5

        teleports_output.append(
            {
                "name": t_name,
                "codename": t_codename,
                "region": t_region,
                "x": t_x,
                "z": t_z,
                "y": t_y,
                "type": t_type,
                "teleport": destinations,
            }
        )

    print("Step 9: Processing NPC spawn positions...")
    npcs_output = []
    path_pos = find_file_case_insensitive(base_dir, "npcpos.txt")
    if os.path.exists(path_pos):
        with open(path_pos, "r", encoding="utf-16", errors="replace") as f:
            for line in f:
                parts = line.strip().split("\t")
                if len(parts) >= 5:
                    cid = parts[0]
                    if cid in char_templates:
                        region = to_signed_16(parts[1])
                        x = float(parts[2])
                        z = float(parts[3])
                        y = float(parts[4])

                        # Get teleport links if this NPC behaves as a portal (e.g. airships)
                        t_links = npc_teleport_links.get(cid, [])

                        npcs_output.append(
                            {
                                "name": char_templates[cid]["name"],
                                "region": region,
                                "x": x,
                                "z": z,
                                "y": y,
                                "teleport": t_links,
                            }
                        )

    print(f"Generated {len(npcs_output)} NPCs and {len(teleports_output)} physical teleports.")

    print("Step 10: Writing output JSON files...")
    with open(os.path.join("map", "public", "assets", "npcs.json"), "w", encoding="utf-8") as f:
        json.dump(npcs_output, f, indent=2)
    with open(os.path.join("map", "public", "assets", "teleports.json"), "w", encoding="utf-8") as f:
        json.dump(teleports_output, f, indent=2)

    print("Done! game data files successfully generated.")


if __name__ == "__main__":
    main()
