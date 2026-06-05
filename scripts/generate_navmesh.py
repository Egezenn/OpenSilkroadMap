# /// script
# dependencies = [
#   "pillow",
# ]
# ///

"""
Extract navmesh data from Silkroad Online .nvm files and dungeon .dof files,
render them as PNG overlays (no background) for OpenSilkroadMap.

Colours match RSBot NavMeshRenderer:
  - Global/Internal edges (normal): lime (#00FF00)
  - Blocked edges:                  red  (#FF0000)
  - Railing edges:                  blue (#0000FF)
  - Object ground triangles:        per-object-id colour with alpha

Requirements: Python 3.10+

Usage: uv run generate_navmesh.py
"""

import argparse
from collections import defaultdict
import json
import math
import os
import re
import struct
import sys

from PIL import Image, ImageDraw

# ---------------------------------------------------------------------------
#  Constants (mirrors RSBot NavMeshApi)
# ---------------------------------------------------------------------------

REGION_WIDTH = 1920.0
REGION_LENGTH = 1920.0

TILES_X = 96
TILES_Z = 96
TILES_TOTAL = TILES_X * TILES_Z

VERTICES_X = TILES_X + 1
VERTICES_Z = TILES_Z + 1
VERTICES_TOTAL = VERTICES_X * VERTICES_Z

BLOCKS_X = 6
BLOCKS_Z = 6
BLOCKS_TOTAL = BLOCKS_X * BLOCKS_Z

TILE_WIDTH = 20.0
TILE_LENGTH = 20.0

# NavMeshEdgeFlag
FLAG_BLOCK_DST2SRC = 1
FLAG_BLOCK_SRC2DST = 2
FLAG_BLOCKED = 3  # both bits
FLAG_INTERNAL = 4
FLAG_GLOBAL = 8
FLAG_RAILING = 16
FLAG_ENTRANCE = 32
FLAG_BIT6 = 64
FLAG_SIEGE = 128

# NavMeshStructOption
STRUCT_OPT_EDGE = 1
STRUCT_OPT_CELL = 2
STRUCT_OPT_EVENT = 4

# PNG tile size matches map tiles
PNG_SIZE = 256

# Render size: 2x tile size for native zoom-9 quality
RENDER_SIZE = PNG_SIZE * 2  # 512

# ---------------------------------------------------------------------------
#  Binary helpers
# ---------------------------------------------------------------------------

class BinaryStream:
    """Minimal binary reader matching NavMeshReader behaviour."""

    def __init__(self, data: bytes):
        self._buf = data
        self._pos = 0

    @property
    def pos(self):
        return self._pos

    def seek(self, offset, whence=0):
        if whence == 0:
            self._pos = offset
        elif whence == 1:
            self._pos += offset
        elif whence == 2:
            self._pos = len(self._buf) + offset

    def read_bytes(self, n):
        r = self._buf[self._pos:self._pos + n]
        self._pos += n
        return r

    def read_int16(self):
        r = struct.unpack_from('<h', self._buf, self._pos)[0]
        self._pos += 2
        return r

    def read_uint16(self):
        r = struct.unpack_from('<H', self._buf, self._pos)[0]
        self._pos += 2
        return r

    def read_int32(self):
        r = struct.unpack_from('<i', self._buf, self._pos)[0]
        self._pos += 4
        return r

    def read_float(self):
        r = struct.unpack_from('<f', self._buf, self._pos)[0]
        self._pos += 4
        return r

    def read_bool(self):
        r = self._buf[self._pos]
        self._pos += 1
        return bool(r)

    def read_byte(self):
        r = self._buf[self._pos]
        self._pos += 1
        return r

    def read_string_fixed(self, n):
        raw = self._buf[self._pos:self._pos + n]
        self._pos += n
        # Find null terminator
        end = n
        for i in range(n):
            if raw[i] == 0:
                end = i
                break
        return raw[:end].decode('ascii', errors='replace')

    def read_string(self):
        length = self.read_int32()
        if length <= 0:
            return ""
        return self.read_string_fixed(length)

    def read_vec2(self):
        x = self.read_float()
        y = self.read_float()
        return (x, y)

    def read_vec3(self):
        x = self.read_float()
        y = self.read_float()
        z = self.read_float()
        return (x, y, z)

    def read_line2d(self):
        """Read 2D line: 2x Vector2 → ((x1,z1), (x2,z2))."""
        x1, z1 = self.read_vec2()
        x2, z2 = self.read_vec2()
        return ((x1, z1), (x2, z2))


# ---------------------------------------------------------------------------
#  Region ID helpers
# ---------------------------------------------------------------------------

def rid_x(rid):
    return rid & 0xFF

def rid_z(rid):
    return (rid >> 8) & 0x7F

def rid_is_dungeon(rid):
    return (rid >> 15) & 1 == 1

def rid_make(x, z, dungeon=False):
    v = (x & 0xFF) | ((z & 0x7F) << 8)
    if dungeon:
        v |= 0x8000
    return v

# ---------------------------------------------------------------------------
#  Edge colour (matches NavMeshExtenions.ToPen)
# ---------------------------------------------------------------------------

def edge_color(flag):
    if flag & FLAG_BLOCKED:
        return "#FF0000"  # Red
    if flag & FLAG_RAILING:
        return "#0000FF"  # Blue
    return "#00FF00"  # Lime


# ---------------------------------------------------------------------------
#  Object ID → colour (matches NavMeshExtenions.ToColor)
# ---------------------------------------------------------------------------

def obj_id_color(i):
    def bit(a, b):
        return (a >> b) & 1
    if i == 0:
        return (0, 192, 255, 128)
    r = (bit(i, 4) + bit(i, 1) * 2 + 1) * 63
    g = (bit(i, 3) + bit(i, 2) * 2 + 1) * 63
    b = (bit(i, 5) + bit(i, 0) * 2 + 1) * 63
    return (min(r, 255), min(g, 255), min(b, 255), 128)

def obj_id_css(i):
    r, g, b, a = obj_id_color(i)
    return f"rgba({r},{g},{b},{a / 255:.2f})"


# ---------------------------------------------------------------------------
#  Load MapInfo.mfo → set of enabled region IDs
# ---------------------------------------------------------------------------

def load_map_info(data_dir):
    path = os.path.join(data_dir, "NavMesh", "MapInfo.mfo")
    if not os.path.isfile(path):
        print(f"  [!] MapInfo.mfo not found at {path}")
        return set()

    with open(path, 'rb') as f:
        raw = f.read()

    s = BinaryStream(raw)
    sig = s.read_string_fixed(12)
    if sig != "JMXVMFO 1000":
        print(f"  [!] Invalid MapInfo signature: {sig}")
        return set()

    map_width = s.read_int16()
    map_length = s.read_int16()
    s.read_int16()  # short2
    s.read_int16()  # short3
    s.read_int16()  # short4
    s.read_int16()  # short5

    total = 256 * 256
    bitmap = s.read_bytes(total // 8)

    enabled = set()
    for z in range(map_length):
        for x in range(map_width):
            rid = rid_make(x, z)
            byte_idx = rid >> 3
            bit_mask = 128 >> (rid % 8)
            if byte_idx < len(bitmap) and (bitmap[byte_idx] & bit_mask):
                enabled.add(rid)

    return enabled


# ---------------------------------------------------------------------------
#  Load Object.ifo → dict[id] → path
# ---------------------------------------------------------------------------

def load_object_index(data_dir):
    path = os.path.join(data_dir, "NavMesh", "Object.ifo")
    if not os.path.isfile(path):
        print(f"  [!] Object.ifo not found at {path}")
        return {}

    obj_map = {}
    with open(path, 'r', encoding='ascii', errors='replace') as f:
        sig = f.readline().strip()
        if sig != "JMXVOBJI1000":
            print(f"  [!] Invalid Object.ifo signature: {sig}")
            return {}
        count = int(f.readline().strip())
        pattern = re.compile(r'(\d{5})\s+0x([0-9a-fA-F]{8})\s+"(.+?)"')
        for line in f:
            m = pattern.match(line.strip())
            if m:
                obj_id = int(m.group(1))
                obj_flag = int(m.group(2), 16)
                obj_path = m.group(3)
                obj_map[obj_id] = (obj_flag, obj_path)

    return obj_map


# ---------------------------------------------------------------------------
#  Load DungeonInfo.txt → dict[rid] → dof_path
# ---------------------------------------------------------------------------

def load_dungeon_info(data_dir):
    path = os.path.join(data_dir, "Dungeon", "DungeonInfo.txt")
    if not os.path.isfile(path):
        path2 = os.path.join(data_dir, "Dungeon", "dungeoninfo.txt")
        if os.path.isfile(path2):
            path = path2
        else:
            print(f"  [!] DungeonInfo.txt not found")
            return {}

    dungeons = {}
    pattern = re.compile(r'^(?:(\d)\t)?(\d+)\t"(.+)"$')
    with open(path, 'r', encoding='ascii', errors='replace') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("//"):
                continue
            m = pattern.match(line)
            if not m:
                continue
            service = m.group(1)
            if service is not None and service == "0":
                continue
            dun_id = int(m.group(2))
            dun_path = m.group(3)
            rid = rid_make(dun_id & 0xFF, (dun_id >> 8) & 0x7F, dungeon=True)
            # Actually dungeon RID = short(dun_id) with dungeon bit set
            rid = dun_id & 0x7FFF
            rid |= 0x8000
            dungeons[rid] = dun_path

    return dungeons


# ---------------------------------------------------------------------------
#  Parse NavMeshObj from .bms file (JMXVBMS 0110)
# ---------------------------------------------------------------------------

def parse_navmesh_obj_bms(data):
    """Parse a .bms NavMeshObj. Returns (vertices, cells, global_edges, internal_edges, struct_option)."""
    s = BinaryStream(data)
    sig = s.read_string_fixed(12)
    if sig != "JMXVBMS 0110":
        return None

    # Header
    vertex_offset = s.read_int32()
    skin_offset = s.read_int32()
    face_offset = s.read_int32()
    cloth_vertex_offset = s.read_int32()
    cloth_edge_offset = s.read_int32()
    bbox_offset = s.read_int32()
    occlusion_portal_offset = s.read_int32()
    navmesh_obj_offset = s.read_int32()
    skined_navmesh_offset = s.read_int32()
    offset9 = s.read_int32()
    int1 = s.read_int32()
    struct_option = s.read_int32()

    s.seek(4, 1)  # SubPrimCount
    s.seek(4, 1)  # VertexFlag
    s.seek(4, 1)  # 0

    name = s.read_string()

    if navmesh_obj_offset == 0:
        return None

    s.seek(navmesh_obj_offset)

    # Vertices: index, position(vec3), normal(byte)
    vertex_count = s.read_int32()
    vertices = []
    for i in range(vertex_count):
        pos = s.read_vec3()
        normal_idx = s.read_byte()
        vertices.append(pos)  # (x, y, z)

    # Cells: 3 vertex indices + flag + optional event zone
    cell_count = s.read_int32()
    cells = []
    for i in range(cell_count):
        vi0 = s.read_int16()
        vi1 = s.read_int16()
        vi2 = s.read_int16()
        flag = s.read_int16()
        if struct_option & STRUCT_OPT_CELL:
            s.read_byte()  # event zone
        cells.append((vi0, vi1, vi2))

    # Global edges: 2 vertex indices, src_cell, dst_cell, flag + optional event zone
    global_edge_count = s.read_int32()
    global_edges = []
    for i in range(global_edge_count):
        vi0 = s.read_int16()
        vi1 = s.read_int16()
        src_cell = s.read_int16()
        dst_cell = s.read_int16()
        flag = s.read_byte() | FLAG_GLOBAL
        if struct_option & STRUCT_OPT_EDGE:
            s.read_byte()  # event zone
        p0 = vertices[vi0]
        p1 = vertices[vi1]
        global_edges.append((p0, p1, flag))

    # Internal edges
    internal_edge_count = s.read_int32()
    internal_edges = []
    for i in range(internal_edge_count):
        vi0 = s.read_int16()
        vi1 = s.read_int16()
        src_cell = s.read_int16()
        dst_cell = s.read_int16()
        flag = s.read_byte() | FLAG_INTERNAL
        if struct_option & STRUCT_OPT_EDGE:
            s.read_byte()  # event zone
        p0 = vertices[vi0]
        p1 = vertices[vi1]
        internal_edges.append((p0, p1, flag))

    return {
        'name': name,
        'vertices': vertices,
        'cells': cells,
        'global_edges': global_edges,
        'internal_edges': internal_edges,
        'struct_option': struct_option,
    }


# ---------------------------------------------------------------------------
#  Parse NavMeshObj from .bsr file (JMXVRES 0109)
# ---------------------------------------------------------------------------

def parse_navmesh_obj_bsr(data):
    s = BinaryStream(data)
    sig = s.read_string_fixed(12)
    if sig != "JMXVRES 0109":
        return None

    prim_mtrl_set_offset = s.read_int32()
    prim_mesh_offset = s.read_int32()
    anim_set_offset = s.read_int32()
    anim_snd_set_offset = s.read_int32()
    mesh_group_offset = s.read_int32()
    anim_set2_offset = s.read_int32()
    mod_palette_offset = s.read_int32()
    navmesh_obj_offset = s.read_int32()
    int0 = s.read_int32()
    int1 = s.read_int32()
    int2 = s.read_int32()
    int3 = s.read_int32()
    int4 = s.read_int32()

    if navmesh_obj_offset == 0:
        return None

    s.seek(navmesh_obj_offset)
    navmesh_obj_path = s.read_string()
    if not navmesh_obj_path:
        return None

    return navmesh_obj_path  # returns path to .bms


def parse_navmesh_obj_cpd(data):
    s = BinaryStream(data)
    sig = s.read_string_fixed(12)
    if sig != "JMXVCPD 0101":
        return None

    navmesh_obj_offset = s.read_int32()
    res_obj_list_offset = s.read_int32()
    s.read_int32()  # int0
    s.read_int32()  # int1
    s.read_int32()  # int2
    s.read_int32()  # int3
    s.read_int32()  # int4

    if navmesh_obj_offset == 0:
        return None

    s.seek(navmesh_obj_offset)
    navmesh_obj_path = s.read_string()
    if not navmesh_obj_path:
        return None

    return navmesh_obj_path  # returns path to .bsr


# ---------------------------------------------------------------------------
#  Resolve and load NavMeshObj (handles .bms / .bsr / .cpd chain)
# ---------------------------------------------------------------------------

_obj_cache = {}

def load_navmesh_obj(data_dir, obj_path):
    """Load a NavMeshObj following the chain: .cpd → .bsr → .bms"""
    if obj_path in _obj_cache:
        return _obj_cache[obj_path]

    full_path = os.path.join(data_dir, obj_path.replace('\\', os.sep))
    if not os.path.isfile(full_path):
        _obj_cache[obj_path] = None
        return None

    with open(full_path, 'rb') as f:
        data = f.read()

    ext = obj_path.rsplit('.', 1)[-1].lower()

    if ext == 'bms':
        result = parse_navmesh_obj_bms(data)
        _obj_cache[obj_path] = result
        return result
    elif ext == 'bsr':
        bms_path = parse_navmesh_obj_bsr(data)
        if bms_path:
            result = load_navmesh_obj(data_dir, bms_path)
            _obj_cache[obj_path] = result
            return result
    elif ext == 'cpd':
        bsr_path = parse_navmesh_obj_cpd(data)
        if bsr_path:
            result = load_navmesh_obj(data_dir, bsr_path)
            _obj_cache[obj_path] = result
            return result

    _obj_cache[obj_path] = None
    return None


# ---------------------------------------------------------------------------
#  Parse terrain NVM file
# ---------------------------------------------------------------------------

def parse_terrain_nvm(data, data_dir, obj_index):
    """
    Parse a terrain .nvm file.
    Returns dict with 'instances', 'global_edges', 'internal_edges'.
    """
    s = BinaryStream(data)
    sig = s.read_string_fixed(12)
    if sig != "JMXVNVM 1000":
        print(f"  [!] Invalid NVM signature: {sig}")
        return None

    # Instances (NavMeshInstObj)
    instance_count = s.read_int16()
    instances = []
    for i in range(instance_count):
        obj_idx = s.read_int32()
        local_pos = s.read_vec3()  # (x, y, z)
        s.read_int16()  # type
        yaw = s.read_float()
        inst_id = s.read_uint16()
        s.read_uint16()  # short0
        is_big = s.read_bool()
        is_struct = s.read_bool()
        region = s.read_uint16()
        world_uid = (region << 16) | inst_id

        # Link edges
        link_edge_count = s.read_int16()
        for _ in range(link_edge_count):
            s.read_int16()  # linked_obj_id
            s.read_int16()  # linked_obj_edge_id
            s.read_int16()  # edge_id

        # Load the object mesh
        obj_data = None
        if obj_idx in obj_index:
            obj_flag, obj_path = obj_index[obj_idx]
            obj_data = load_navmesh_obj(data_dir, obj_path)

        instances.append({
            'obj_idx': obj_idx,
            'local_pos': local_pos,
            'yaw': yaw,
            'world_uid': world_uid,
            'obj_data': obj_data,
        })

    # Cells
    total_cell_count = s.read_int32()
    open_cell_count = s.read_int32()
    for i in range(total_cell_count):
        s.read_vec2()  # rect min
        s.read_vec2()  # rect max
        inst_count = s.read_byte()
        for _ in range(inst_count):
            s.read_int16()

    # Global edges
    global_edge_count = s.read_int32()
    global_edges = []
    for i in range(global_edge_count):
        line = s.read_line2d()  # ((x1,z1),(x2,z2))
        flag = s.read_byte()
        s.read_byte()  # src side
        s.read_byte()  # dst side
        s.read_int16()  # src cell index
        s.read_int16()  # dst cell index
        s.read_int16()  # src mesh index
        s.read_int16()  # dst mesh index
        global_edges.append((line, flag))

    # Internal edges
    internal_edge_count = s.read_int32()
    internal_edges = []
    for i in range(internal_edge_count):
        line = s.read_line2d()
        flag = s.read_byte()
        s.read_byte()  # src side
        s.read_byte()  # dst side
        s.read_int16()  # src cell index
        s.read_int16()  # dst cell index
        internal_edges.append((line, flag))

    # TileMap (skip - we don't need it for PNG rendering)
    # HeightMap (skip)
    # SurfaceMap (skip)

    return {
        'instances': instances,
        'global_edges': global_edges,
        'internal_edges': internal_edges,
    }


# ---------------------------------------------------------------------------
#  Parse dungeon DOF file (JMXVDOF 0101)
# ---------------------------------------------------------------------------

def parse_dungeon_dof(data, data_dir):
    """
    Parse a dungeon .dof file.
    Returns list of blocks, each with navmesh obj data, transforms, floor info.
    """
    s = BinaryStream(data)
    sig = s.read_string_fixed(12)
    if sig != "JMXVDOF 0101":
        print(f"  [!] Invalid DOF signature: {sig}")
        return None

    block_offset = s.read_int32()
    link_offset = s.read_int32()
    voxel_offset = s.read_int32()
    group_offset = s.read_int32()
    label_offset = s.read_int32()
    offset5 = s.read_int32()
    offset6 = s.read_int32()
    bbox_offset = s.read_int32()

    # BoundingBox
    s.seek(bbox_offset)
    bbox_min = s.read_vec3()
    bbox_max = s.read_vec3()

    # Blocks
    s.seek(block_offset)
    block_count = s.read_int32()

    blocks = []
    for i in range(block_count):
        path = s.read_string()
        name = s.read_string()
        s.seek(4, 1)  # skip 4 bytes

        position = s.read_vec3()
        yaw = s.read_float()
        is_entrance = s.read_int32()
        bb_min = s.read_vec3()
        bb_max = s.read_vec3()

        s.seek(20, 1)  # skip 20 bytes

        has_height_fog = s.read_bool()
        if has_height_fog:
            s.seek(16, 1)

        has_unknown_vec = s.read_bool()
        if has_unknown_vec:
            s.seek(28, 1)

        str_len = s.read_int32()
        s.seek(str_len, 1)  # skip string

        room_index = s.read_int32()
        floor_index = s.read_int32()

        connected_count = s.read_int32()
        for _ in range(connected_count):
            s.read_int32()

        visible_count = s.read_int32()
        s.seek(visible_count * 4, 1)

        block_obj_count = s.read_int32()
        block_col_obj_count = s.read_int32()
        for _ in range(block_obj_count):
            s.read_string()  # name
            s.read_string()  # path
            s.read_vec3()    # position
            s.seek(24, 1)
            block_obj_flag = s.read_int32()
            s.read_int32()
            s.read_float()   # radius squared
            if block_obj_flag & 4:
                s.seek(4, 1)  # color

        block_light_count = s.read_int32()
        for _ in range(block_light_count):
            light_str_len = s.read_int32()
            s.seek(light_str_len, 1)
            s.seek(60, 1)

        # Load the navmesh object
        obj_data = load_navmesh_obj(data_dir, path)

        blocks.append({
            'id': i,
            'path': path,
            'name': name,
            'position': position,
            'yaw': yaw,
            'floor_index': floor_index,
            'room_index': room_index,
            'obj_data': obj_data,
            'bb_min': bb_min,
            'bb_max': bb_max,
        })

    # Labels
    floor_labels = {}
    if label_offset != 0:
        s.seek(label_offset)
        room_count = s.read_int32()
        for i in range(room_count):
            s.read_string()  # room label
        floor_count = s.read_int32()
        for i in range(floor_count):
            floor_labels[i] = s.read_string()

    return {
        'blocks': blocks,
        'floor_labels': floor_labels,
        'bbox_min': bbox_min,
        'bbox_max': bbox_max,
    }


# ---------------------------------------------------------------------------
#  PNG tile rendering
# ---------------------------------------------------------------------------

def transform_obj_point(px, pz, yaw, lx, lz):
    """Apply rotation (-yaw) and translation to get world-space coords."""
    cos_y = math.cos(-yaw)
    sin_y = math.sin(-yaw)
    wx = px * cos_y + pz * sin_y + lx
    wz = -px * sin_y + pz * cos_y + lz
    return wx, wz


def edge_rgba(flag):
    """Edge colour as RGBA tuple."""
    if flag & FLAG_BLOCKED:
        return (255, 0, 0, 255)
    if flag & FLAG_RAILING:
        return (0, 0, 255, 255)
    return (0, 255, 0, 255)


def obj_id_rgba(i):
    """Object colour as RGBA tuple (alpha=128)."""
    def bit(a, b):
        return (a >> b) & 1
    if i == 0:
        return (0, 192, 255, 128)
    r = (bit(i, 4) + bit(i, 1) * 2 + 1) * 63
    g = (bit(i, 3) + bit(i, 2) * 2 + 1) * 63
    b = (bit(i, 5) + bit(i, 0) * 2 + 1) * 63
    return (min(r, 255), min(g, 255), min(b, 255), 128)


def render_terrain_region(nvm_data, size):
    """
    Render navmesh for one region into a RGBA PIL Image.
    NVM Z axis points north, image Y axis points down -> flip Z.
    """
    scale = size / REGION_WIDTH
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    def tx(x):
        return x * scale

    def ty(z):
        return size - z * scale

    # Object triangles
    drawn_uids = set()
    for inst in nvm_data['instances']:
        if inst['world_uid'] in drawn_uids:
            continue
        drawn_uids.add(inst['world_uid'])
        obj = inst['obj_data']
        if obj is None:
            continue
        lx, ly, lz = inst['local_pos']
        yaw = inst['yaw']
        fill = obj_id_rgba(inst['world_uid'])

        for vi0, vi1, vi2 in obj['cells']:
            verts = obj['vertices']
            pts = []
            for vi in (vi0, vi1, vi2):
                wx, wz = transform_obj_point(verts[vi][0], verts[vi][2], yaw, lx, lz)
                pts.append((tx(wx), ty(wz)))
            draw.polygon(pts, fill=fill)

        for edges, w in ((obj['global_edges'], 1), (obj['internal_edges'], 1)):
            for p0, p1, flag in edges:
                x0, z0 = transform_obj_point(p0[0], p0[2], yaw, lx, lz)
                x1, z1 = transform_obj_point(p1[0], p1[2], yaw, lx, lz)
                draw.line([(tx(x0), ty(z0)), (tx(x1), ty(z1))], fill=edge_rgba(flag), width=w)

    # Terrain edges
    for edges, w in ((nvm_data['global_edges'], 1), (nvm_data['internal_edges'], 1)):
        for line, flag in edges:
            (x0, z0), (x1, z1) = line
            draw.line([(tx(x0), ty(z0)), (tx(x1), ty(z1))], fill=edge_rgba(flag), width=w)

    return img


def save_png(img, path):
    """Save RGBA image as PNG."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "PNG")


# ---------------------------------------------------------------------------
#  Generate lower zoom levels: merge 2x2 -> 1
# ---------------------------------------------------------------------------

def generate_lower_zooms(tiles_z8, out_dir, base_zoom=8, min_zoom=0):
    """
    Generate zoom levels base_zoom-1 down to min_zoom by merging 2x2 tiles.
    tiles_z8: dict[(x, y)] -> PIL Image at base zoom level.
    """
    tiles_by_zoom = {base_zoom: tiles_z8}

    for z in range(base_zoom - 1, min_zoom - 1, -1):
        parent_tiles = tiles_by_zoom[z + 1]
        if not parent_tiles:
            print(f"  Level {z}: no source tiles, skipping")
            break

        # Parent tile coordinates (y inverted like in generate_tiles.py)
        parent_coords = set()
        for (x, y) in parent_tiles:
            parent_coords.add((x // 2, -(-y // 2)))

        current_tiles = {}
        tile_size = PNG_SIZE
        for (px, py) in parent_coords:
            merged = Image.new("RGBA", (tile_size * 2, tile_size * 2), (0, 0, 0, 0))
            has_any = False
            for dx in (0, 1):
                for child_y, img_y in ((2 * py, 0), (2 * py - 1, tile_size)):
                    child = parent_tiles.get((2 * px + dx, child_y))
                    if child:
                        merged.paste(child, (dx * tile_size, img_y))
                        has_any = True

            if has_any:
                resized = merged.resize((tile_size, tile_size), Image.LANCZOS)
                path = os.path.join(out_dir, str(z), f"{px}x{py}.png")
                save_png(resized, path)
                current_tiles[(px, py)] = resized

        tiles_by_zoom[z] = current_tiles
        print(f"  Level {z}: {len(current_tiles)} tiles")


# ---------------------------------------------------------------------------
#  Process world map regions -> PNG tiles at all zoom levels
# ---------------------------------------------------------------------------

def process_world_navmesh(data_dir, out_dir, obj_index):
    print("=" * 60)
    print("World map navmesh")
    print("=" * 60)

    enabled_regions = load_map_info(data_dir)
    print(f"  Active regions: {len(enabled_regions)}")

    navmesh_dir = os.path.join(data_dir, "navmesh")
    if not os.path.isdir(navmesh_dir):
        navmesh_dir = os.path.join(data_dir, "NavMesh")
    if not os.path.isdir(navmesh_dir):
        print(f"  [!] navmesh directory not found in {data_dir}")
        return

    nm_out = os.path.join(out_dir, "navmesh")

    # Render at 2x resolution (RENDER_SIZE=512) for native zoom-9 quality
    tiles_hires = {}
    count = 0
    total = len(enabled_regions)
    for idx, rid in enumerate(sorted(enabled_regions), 1):
        x = rid_x(rid)
        z = rid_z(rid)
        nvm_file = os.path.join(navmesh_dir, f"nv_{rid:04X}.nvm")
        if not os.path.isfile(nvm_file):
            nvm_file = os.path.join(navmesh_dir, f"nv_{rid:04x}.nvm")
        if not os.path.isfile(nvm_file):
            continue

        with open(nvm_file, 'rb') as f:
            raw = f.read()

        nvm_data = parse_terrain_nvm(raw, data_dir, obj_index)
        if nvm_data is None:
            continue

        img = render_terrain_region(nvm_data, RENDER_SIZE)

        # Check if image is not fully transparent
        if img.getbbox() is None:
            continue

        tiles_hires[(x, z)] = img
        count += 1

        if idx % 200 == 0 or idx == total:
            print(f"  {idx}/{total} regions processed, {count} rendered")

    # Zoom 9: split each 512x512 into 4 native 256x256 quadrants
    print(f"  Generating zoom 9 (native from {RENDER_SIZE}x{RENDER_SIZE})...")
    count9 = 0
    tile_size = PNG_SIZE
    for (x, y), img in tiles_hires.items():
        for dx in (0, 1):
            for img_y, child_y in ((0, 2 * y), (1, 2 * y - 1)):
                crop = img.crop((
                    dx * tile_size, img_y * tile_size,
                    (dx + 1) * tile_size, (img_y + 1) * tile_size
                ))
                if crop.getbbox() is not None:
                    path = os.path.join(nm_out, "9", f"{2 * x + dx}x{child_y}.png")
                    save_png(crop, path)
                    count9 += 1
    print(f"  Level 9: {count9} tiles")

    # Zoom 8: downscale 512->256
    print("  Generating zoom 8 (downscale)...")
    tiles_z8 = {}
    for (x, y), img in tiles_hires.items():
        z8 = img.resize((tile_size, tile_size), Image.LANCZOS)
        path = os.path.join(nm_out, "8", f"{x}x{y}.png")
        save_png(z8, path)
        tiles_z8[(x, y)] = z8
    print(f"  Level 8: {len(tiles_z8)} tiles")

    # Free hi-res images
    del tiles_hires

    # Generate lower zoom levels
    print("  Generating lower zoom levels (7 -> 0)...")
    generate_lower_zooms(tiles_z8, nm_out)

    # Free memory
    del tiles_z8


# ---------------------------------------------------------------------------
#  Process dungeons -> PNG images (one per floor)
# ---------------------------------------------------------------------------

def process_dungeon_navmesh(data_dir, out_dir):
    print()
    print("=" * 60)
    print("Dungeon navmesh")
    print("=" * 60)

    dungeons = load_dungeon_info(data_dir)
    print(f"  Dungeons found: {len(dungeons)}")

    nm_out = os.path.join(out_dir, "navmesh", "d")
    manifest = {}

    count = 0
    for rid, dof_rel_path in sorted(dungeons.items()):
        dof_path = os.path.join(data_dir, dof_rel_path.replace('\\', os.sep))
        if not os.path.isfile(dof_path):
            print(f"  [!] DOF not found: {dof_path}")
            continue

        with open(dof_path, 'rb') as f:
            raw = f.read()

        try:
            dof_data = parse_dungeon_dof(raw, data_dir)
        except Exception as e:
            print(f"  [!] Error parsing {dof_rel_path}: {e}")
            continue

        if dof_data is None:
            continue

        # Group blocks by floor
        floors = defaultdict(list)
        for block in dof_data['blocks']:
            floors[block['floor_index']].append(block)

        dof_basename = os.path.splitext(os.path.basename(dof_path))[0]
        dungeon_id = rid & 0x7FFF

        for floor_idx, floor_blocks in sorted(floors.items()):
            # Compute bounding box across all blocks on this floor
            all_xs = []
            all_zs = []
            for block in floor_blocks:
                obj = block['obj_data']
                if obj is None:
                    continue
                lx, ly, lz = block['position']
                yaw = block['yaw']
                for vert in obj['vertices']:
                    wx, wz = transform_obj_point(vert[0], vert[2], yaw, lx, lz)
                    all_xs.append(wx)
                    all_zs.append(wz)

            if not all_xs:
                continue

            min_x = min(all_xs)
            max_x = max(all_xs)
            min_z = min(all_zs)
            max_z = max(all_zs)

            pad = 50.0
            min_x -= pad
            min_z -= pad
            max_x += pad
            max_z += pad

            width = max_x - min_x
            height = max_z - min_z

            if width <= 0 or height <= 0:
                continue

            # Scale to high-resolution image
            max_dim = max(width, height)
            img_w = int(width / max_dim * 2048)
            img_h = int(height / max_dim * 2048)
            scale = img_w / width

            img = Image.new("RGBA", (img_w, img_h), (0, 0, 0, 0))
            draw = ImageDraw.Draw(img)
            has_content = False

            def txd(x):
                return (x - min_x) * scale

            def tyd(z):
                return (max_z - z) * scale

            for block in floor_blocks:
                obj = block['obj_data']
                if obj is None:
                    continue

                lx, ly, lz = block['position']
                yaw = block['yaw']
                bid = block['id']
                fill = obj_id_rgba(bid)

                for vi0, vi1, vi2 in obj['cells']:
                    verts = obj['vertices']
                    pts = []
                    for vi in (vi0, vi1, vi2):
                        wx, wz = transform_obj_point(verts[vi][0], verts[vi][2], yaw, lx, lz)
                        pts.append((txd(wx), tyd(wz)))
                    draw.polygon(pts, fill=fill)
                    has_content = True

                for edges, w in ((obj['global_edges'], 1), (obj['internal_edges'], 1)):
                    for p0, p1, flag in edges:
                        x0, z0 = transform_obj_point(p0[0], p0[2], yaw, lx, lz)
                        x1, z1 = transform_obj_point(p1[0], p1[2], yaw, lx, lz)
                        draw.line([(txd(x0), tyd(z0)), (txd(x1), tyd(z1))],
                                  fill=edge_rgba(flag), width=w)
                        has_content = True

            if not has_content:
                continue

            floor_str = f"floor{floor_idx + 1:02d}"
            png_name = f"{dungeon_id}_{floor_str}.png"
            png_path = os.path.join(nm_out, png_name)
            save_png(img, png_path)

            region_key = str(rid)
            if region_key not in manifest:
                manifest[region_key] = []
            manifest[region_key].append({
                'file': png_name,
                'floor': floor_idx,
                'minX': round(min_x, 2),
                'minZ': round(min_z, 2),
                'maxX': round(max_x, 2),
                'maxZ': round(max_z, 2),
            })

            count += 1
            print(f"  [{dungeon_id}] {dof_basename} floor {floor_idx} -> {png_name}")

    # Write manifest JSON
    manifest_path = os.path.join(nm_out, "manifest.json")
    os.makedirs(os.path.dirname(manifest_path), exist_ok=True)
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)
    print(f"  Manifest written: {manifest_path}")
    print(f"  Total: {count} dungeon navmesh PNGs")


# ---------------------------------------------------------------------------
#  Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Generate navmesh PNG overlays for OpenSilkroadMap")
    parser.add_argument("--data", default=r"game_source/Data",
                        help="Path to Silkroad Data directory")
    parser.add_argument("--out", default=os.path.join("assets", "img", "silkroad", "minimap"),
                        help="Output directory for navmesh PNGs")
    args = parser.parse_args()

    data_dir = args.data
    out_dir = args.out

    if not os.path.isdir(data_dir):
        print(f"Error: data directory '{data_dir}' not found.")
        sys.exit(1)

    print(f"Data directory: {data_dir}")
    print(f"Output directory: {out_dir}")
    print()

    # Load object index
    obj_index = load_object_index(data_dir)
    print(f"Loaded {len(obj_index)} objects from Object.ifo")
    print()

    # Process world map
    process_world_navmesh(data_dir, out_dir, obj_index)

    # Process dungeons
    process_dungeon_navmesh(data_dir, out_dir)

    print()
    print("Done!")


if __name__ == "__main__":
    main()
