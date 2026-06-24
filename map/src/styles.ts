import { Style, Icon, Stroke } from "ol/style";

export const LAYER_URLS: Record<string, string> = {
    world: "/assets/img/silkroad/minimap/{z}/{x}x{y}.webp",
    "32769_1": "/assets/img/silkroad/minimap/d/{z}/dh_a01_floor01_{x}x{y}.webp",
    "32769_2": "/assets/img/silkroad/minimap/d/{z}/dh_a01_floor02_{x}x{y}.webp",
    "32769_3": "/assets/img/silkroad/minimap/d/{z}/dh_a01_floor03_{x}x{y}.webp",
    "32769_4": "/assets/img/silkroad/minimap/d/{z}/dh_a01_floor04_{x}x{y}.webp",
    "32775": "/assets/img/silkroad/minimap/d/{z}/qt_a01_floor01_{x}x{y}.webp",
    "32774": "/assets/img/silkroad/minimap/d/{z}/qt_a01_floor02_{x}x{y}.webp",
    "32773": "/assets/img/silkroad/minimap/d/{z}/qt_a01_floor03_{x}x{y}.webp",
    "32772": "/assets/img/silkroad/minimap/d/{z}/qt_a01_floor04_{x}x{y}.webp",
    "32771": "/assets/img/silkroad/minimap/d/{z}/qt_a01_floor05_{x}x{y}.webp",
    "32770": "/assets/img/silkroad/minimap/d/{z}/qt_a01_floor06_{x}x{y}.webp",
    "32784": "/assets/img/silkroad/minimap/d/{z}/rn_sd_egypt1_01_{x}x{y}.webp",
    "32786": "/assets/img/silkroad/minimap/d/{z}/flame_dungeon01_{x}x{y}.webp",
    "32785": "/assets/img/silkroad/minimap/d/{z}/fort_dungeon01_{x}x{y}.webp",
};

// SRO Sector coordinate bounds normalized at zoom 9
export const WORLD_BOUNDS_Z9 = { minX: 52, maxX: 505, minY: 70, maxY: 253 };

export const TELEPORT_TYPES: Record<number, string> = {
    0: "Dimensional Gate",
    1: "Fortress Gate",
    2: "Revival Gate",
    3: "Glory Gate",
    4: "Small Fortress Gate",
    5: "Teleport Gate",
    6: "Tahomet Gate",
    7: "NPC Teleporter",
};

export const npcStyle = new Style({
    image: new Icon({
        src: "/assets/icons/mm_sign_npc.png",
        anchor: [0.5, 0.5],
        scale: 1.5,
    }),
});

export const teleportStyles: Record<number, Style> = {
    0: new Style({
        image: new Icon({
            src: "/assets/icons/xy_gate.png",
            anchor: [0.5, 0.5],
        }),
    }),
    1: new Style({
        image: new Icon({
            src: "/assets/icons/fort_worldmap.png",
            anchor: [0.5, 0.5],
        }),
    }),
    2: new Style({
        image: new Icon({
            src: "/assets/icons/strut_revival_gate.png",
            anchor: [0.5, 0.5],
        }),
    }),
    3: new Style({
        image: new Icon({
            src: "/assets/icons/strut_glory_gate.png",
            anchor: [0.5, 0.5],
        }),
    }),
    4: new Style({
        image: new Icon({
            src: "/assets/icons/fort_small_worldmap.png",
            anchor: [0.5, 0.5],
        }),
    }),
    5: new Style({
        image: new Icon({
            src: "/assets/icons/map_world_icontel.png",
            anchor: [0.5, 0.5],
        }),
    }),
    6: new Style({
        image: new Icon({
            src: "/assets/icons/tahomet_gate.png",
            anchor: [0.5, 0.5],
        }),
    }),
};

export const connectionStyles: Record<number, Style> = {
    0: new Style({
        stroke: new Stroke({
            color: "#bb86fc",
            width: 1.5,
            lineDash: [4, 4],
        }),
    }),
    1: new Style({
        stroke: new Stroke({
            color: "#ff9100",
            width: 1.5,
            lineDash: [4, 4],
        }),
    }),
    2: new Style({
        stroke: new Stroke({
            color: "#00e676",
            width: 1.5,
            lineDash: [4, 4],
        }),
    }),
    3: new Style({
        stroke: new Stroke({
            color: "#00e5ff",
            width: 1.5,
            lineDash: [4, 4],
        }),
    }),
    4: new Style({
        stroke: new Stroke({
            color: "#ffd740",
            width: 1.5,
            lineDash: [4, 4],
        }),
    }),
    5: new Style({
        stroke: new Stroke({
            color: "#ff5252",
            width: 1.5,
            lineDash: [4, 4],
        }),
    }),
    6: new Style({
        stroke: new Stroke({
            color: "#1de9b6",
            width: 1.5,
            lineDash: [4, 4],
        }),
    }),
    7: new Style({
        stroke: new Stroke({
            color: "#ff4081",
            width: 1.5,
            lineDash: [4, 4],
        }),
    }),
};

export const solidConnectionStyles: Record<number, Style> = {};
for (const key in connectionStyles) {
    const type = parseInt(key, 10);
    const stroke = connectionStyles[type].getStroke()!;
    solidConnectionStyles[type] = new Style({
        stroke: new Stroke({
            color: stroke.getColor(),
            width: 2.5,
        }),
    });
}
