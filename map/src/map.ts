import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/WebGLTile";
import XYZ from "ol/source/XYZ";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import Overlay from "ol/Overlay";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Style, Stroke, Fill, Text } from "ol/style";
import { sroProjection, tileGrid, convertMapToSRO, convertSROToMap } from "./coord";
import { markerLayer, connectionLayer, updateMarkers, npcsData, teleportsData } from "./markers";
import { LAYER_URLS, WORLD_BOUNDS_Z9, TELEPORT_TYPES } from "./styles";
import { PMTiles } from "pmtiles";
import { PMTilesDB, BlobSource } from "./pmtiles_db";
import { updateNavmesh, getDungeonFloorKey } from "./navmesh";

export const regionOverlaySource = new VectorSource();
export const regionOverlayLayer = new VectorLayer({
    source: regionOverlaySource,
    style: (feature) => {
        const regionId = feature.get("regionId") as number;
        const xSector = feature.get("xSector") as number;
        const ySector = feature.get("ySector") as number;
        const hex = "0x" + regionId.toString(16).toUpperCase();
        return new Style({
            stroke: new Stroke({
                color: "rgba(187, 134, 252, 0.4)",
                width: 1.5,
            }),
            fill: new Fill({
                color: "rgba(187, 134, 252, 0.08)",
            }),
            text: new Text({
                font: "bold 16px Roboto, monospace",
                text: `ID: ${regionId}\nHex: ${hex}\n[${xSector}, ${ySector}]`,
                fill: new Fill({
                    color: "#e0e0e0",
                }),
                stroke: new Stroke({
                    color: "#121212",
                    width: 3,
                }),
                textAlign: "center",
                textBaseline: "middle",
            }),
        });
    },
});

export let lastRegionId: number | null = null;
export function resetLastRegionId() {
    lastRegionId = null;
}

export let currentLayerKey = "world";
export function setCurrentLayerKey(key: string) {
    currentLayerKey = key;
}

let hoveredFeature: any = null;
let selectedFeature: any = null;

const pmtilesCache: Record<string, PMTiles> = {};
const pmtilesPromises: Record<string, Promise<PMTiles>> = {};

export function getPMTilesForLayer(layerKey: string): Promise<PMTiles> {
    if (!pmtilesPromises[layerKey]) {
        pmtilesPromises[layerKey] = (async () => {
            if (pmtilesCache[layerKey]) return pmtilesCache[layerKey];
            const cachedBlob = await PMTilesDB.get(layerKey);
            if (cachedBlob) {
                pmtilesCache[layerKey] = new PMTiles(new BlobSource(layerKey, cachedBlob));
            } else {
                pmtilesCache[layerKey] = new PMTiles(`/assets/${layerKey}.pmtiles`);
            }
            return pmtilesCache[layerKey];
        })();
    }
    return pmtilesPromises[layerKey];
}

export function registerCachedPMTiles(layerKey: string, blob: Blob) {
    const instance = new PMTiles(new BlobSource(layerKey, blob));
    pmtilesCache[layerKey] = instance;
    pmtilesPromises[layerKey] = Promise.resolve(instance);
}

// Tile Source representing map background tiles from PMTiles
export const tileSource = new XYZ({
    projection: sroProjection,
    tileGrid: tileGrid,
    tileUrlFunction: (tileCoord) => {
        const tileGridZ = tileCoord[0];
        const x = tileCoord[1];
        const y = -tileCoord[2];
        const z = tileGridZ === 0 ? 3 : tileGridZ === 1 ? 6 : 9;

        // Bounds check for world map to optimize requests
        if (currentLayerKey === "world") {
            const scale = Math.pow(2, 9 - z);
            const minX = Math.floor(WORLD_BOUNDS_Z9.minX / scale);
            const maxX = Math.ceil(WORLD_BOUNDS_Z9.maxX / scale);
            const minY = Math.floor(WORLD_BOUNDS_Z9.minY / scale);
            const maxY = Math.ceil(WORLD_BOUNDS_Z9.maxY / scale);
            if (x < minX || x > maxX || y < minY || y > maxY) return undefined;
        }
        return "dummy";
    },
    tileLoadFunction: (tile: any, src: string) => {
        if (src === "dummy") {
            const tileCoord = tile.getTileCoord();
            const tileGridZ = tileCoord[0];
            const x = tileCoord[1];
            const y = -tileCoord[2];
            const z = tileGridZ === 0 ? 3 : tileGridZ === 1 ? 6 : 9;

            getPMTilesForLayer(currentLayerKey).then((pmtilesInstance) => {
                pmtilesInstance
                    .getZxy(z, x, y)
                    .then((res) => {
                        if (!res) throw new Error("No data");
                        const blob = new Blob([res.data], { type: "image/webp" });
                        const blobUrl = URL.createObjectURL(blob);
                        const img = tile.getImage() as HTMLImageElement;
                        img.src = blobUrl;
                        img.addEventListener(
                            "load",
                            () => {
                                URL.revokeObjectURL(blobUrl);
                            },
                            { once: true },
                        );
                    })
                    .catch(() => {
                        (tile.getImage() as HTMLImageElement).src =
                            "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
                    });
            });
        }
    },
});

export const mapLayer = new TileLayer({
    source: tileSource,
});

// Popup overlay elements
const container = document.getElementById("popup")!;
const content = document.getElementById("popup-content")!;
const closer = document.getElementById("popup-closer")!;

export const overlay = new Overlay({
    element: container,
    autoPan: {
        animation: {
            duration: 250,
        },
    },
});

closer.onclick = () => {
    overlay.setPosition(undefined);
    closer.blur();
    if (selectedFeature && selectedFeature.get("isConnection")) {
        selectedFeature.set("highlighted", false);
        selectedFeature = null;
    }
    return false;
};

// OpenLayers core Map setup
export const map = new Map({
    target: "map",
    layers: [mapLayer, regionOverlayLayer, connectionLayer, markerLayer],
    overlays: [overlay],
    view: new View({
        projection: sroProjection,
        center: [135, 91], // Default center Jangan
        zoom: 6,
        minZoom: 0,
        maxZoom: 12,
        resolutions: (() => {
            const res = [];
            for (let z = 0; z <= 12; z++) {
                res.push(1 / Math.pow(2, z));
            }
            return res;
        })(),
    }),
});

// Coordinates DOM panel
const coordsVal = document.getElementById("coords-val");
let lastCoordinate: number[] | null = null;

export function updateCoordsVal() {
    if (!coordsVal) return;

    const zoom = map.getView().getZoom() ?? 0;
    const resolution = map.getView().getResolution() ?? 0;
    const tileGridZ = tileGrid.getZForResolution(resolution);
    const extrapolatedFrom = tileGridZ === 0 ? 3 : tileGridZ === 1 ? 6 : 9;

    let coordText = "";
    if (lastCoordinate) {
        const [secX, secY] = lastCoordinate;
        const sro = convertMapToSRO(secX, secY, currentLayerKey);
        const regionString =
            currentLayerKey === "world" ? `${sro.region} (${sro.region & 0xff},${sro.region >> 8})` : `${sro.region}`;
        coordText = `X: ${sro.x}, Y: ${sro.y}, R: ${regionString} | `;
    }

    coordsVal.textContent = `${coordText}Zoom: ${zoom.toFixed(1)} (extrapolated from L${extrapolatedFrom})`;
}

// Initial update and view resolution listener
map.getView().on("change:resolution", updateCoordsVal);
updateCoordsVal();

// Event listener for cursor movements (pointermove)
let hoverTimeout: number | null = null;
map.on("pointermove", (event) => {
    if (!event.coordinate || !coordsVal) return;

    const [secX, secY] = event.coordinate;
    lastCoordinate = event.coordinate;
    updateCoordsVal();

    // Region hover detail layer update
    const showRegionInfo = (document.getElementById("region-info-toggle") as HTMLInputElement | null)?.checked ?? false;
    if (showRegionInfo && currentLayerKey === "world") {
        const xSector = Math.floor(secX);
        const ySector = Math.floor(secY) + 1;
        const regionId = (ySector << 8) | xSector;

        if (regionId !== lastRegionId) {
            lastRegionId = regionId;
            regionOverlaySource.clear();

            const features: Feature[] = [];
            const centerX = xSector;
            const centerY = ySector;

            const radius = 2.5; // Circular adjacency, slightly larger
            const maxL = Math.ceil(radius);
            for (let dx = -maxL; dx <= maxL; dx++) {
                for (let dy = -maxL; dy <= maxL; dy++) {
                    if (dx * dx + dy * dy > radius * radius) continue;
                    const x = centerX + dx;
                    const y = centerY + dy;
                    if (x < 0 || x > 255 || y < 0 || y > 255) continue;

                    const rId = (y << 8) | x;
                    const feature = new Feature({
                        geometry: new Polygon([
                            [
                                [x, y - 1],
                                [x + 1, y - 1],
                                [x + 1, y],
                                [x, y],
                                [x, y - 1],
                            ],
                        ]),
                        regionId: rId,
                        xSector: x,
                        ySector: y,
                    });
                    features.push(feature);
                }
            }
            regionOverlaySource.addFeatures(features);
        }
    } else {
        if (lastRegionId !== null) {
            lastRegionId = null;
            regionOverlaySource.clear();
        }
    }

    // Throttle expensive hit detection
    if (hoverTimeout !== null) return;
    hoverTimeout = window.setTimeout(() => {
        hoverTimeout = null;
        const pixel = map.getEventPixel(event.originalEvent);
        const hitFeature = map.forEachFeatureAtPixel(pixel, (f) => f) as Feature | null;
        const isClickable =
            hitFeature && (hitFeature.getGeometry()?.getType() === "Point" || hitFeature.get("isConnection"));
        map.getTargetElement().style.cursor = isClickable ? "pointer" : "";

        // Handle connection lines hover transitions
        if (hitFeature && hitFeature.get("isConnection")) {
            if (hoveredFeature !== hitFeature) {
                if (hoveredFeature && hoveredFeature !== selectedFeature) {
                    hoveredFeature.set("highlighted", false);
                }
                hoveredFeature = hitFeature;
                if (hoveredFeature !== selectedFeature) {
                    hoveredFeature.set("highlighted", true);
                }
            }
        } else {
            if (hoveredFeature) {
                if (hoveredFeature !== selectedFeature) {
                    hoveredFeature.set("highlighted", false);
                }
                hoveredFeature = null;
            }
        }
    }, 30);
});

// Event listener for click details popup (singleclick)
map.on("singleclick", (evt) => {
    const feature = map.forEachFeatureAtPixel(evt.pixel, (f) => f) as Feature | null;

    // Restore style of previously selected line feature
    if (selectedFeature && selectedFeature.get("isConnection") && selectedFeature !== feature) {
        selectedFeature.set("highlighted", false);
        selectedFeature = null;
    }

    if (feature) {
        const geomType = feature.getGeometry()?.getType();
        if (geomType === "Point") {
            const coordinates = (feature.getGeometry() as Point).getCoordinates();
            const name = feature.get("name") || "Unknown Feature";

            const sro = convertMapToSRO(coordinates[0], coordinates[1], currentLayerKey);
            const regionString =
                currentLayerKey === "world"
                    ? `${sro.region} (${sro.region & 0xff},${sro.region >> 8})`
                    : `${sro.region}`;

            const type = feature.get("type");
            const typeString = type !== undefined ? TELEPORT_TYPES[type] || "Unknown Category" : null;
            const teleport = feature.get("teleport") || [];

            content.innerHTML = `
        <div class="popup-title">${name}</div>
        ${typeString ? `<div class="popup-detail">Type: ${typeString}</div>` : ""}
        <div class="popup-detail">X: ${sro.x}</div>
        <div class="popup-detail">Y: ${sro.y}</div>
        <div class="popup-detail">Region: ${regionString}</div>
        ${
            teleport.length > 0
                ? `
          <div class="popup-detail" style="margin-top: 8px; border-top: 1px solid #444; padding-top: 6px; font-weight: bold; color: #03dac6;">Teleport Destinations:</div>
          ${teleport
              .map((d: any) => {
                  let r = d.region;
                  if (r < 0) r += 65536;
                  return `
              <div class="popup-detail">
                <a href="#" class="teleport-link" data-x="${d.x}" data-y="${d.y}" data-region="${r}" data-name="${d.name}" style="color: #bb86fc; text-decoration: underline; cursor: pointer;">
                  ${d.name} (Region: ${r})
                </a>
              </div>
            `;
              })
              .join("")}
        `
                : ""
        }
      `;
            overlay.setPosition(coordinates);
        } else if (feature.get("isConnection")) {
            selectedFeature = feature;
            feature.set("highlighted", true);
            const type = feature.get("type");

            const sourceName = feature.get("sourceName");
            const targetName = feature.get("targetName");
            const typeString =
                type !== undefined ? TELEPORT_TYPES[type] || "Teleport Connection" : "Teleport Connection";

            content.innerHTML = `
        <div class="popup-title">${typeString}</div>
        <div class="popup-detail" style="color: #bb86fc; font-weight: bold;">Source:</div>
        <div class="popup-detail" style="margin-left: 8px; margin-bottom: 6px;">${sourceName}</div>
        <div class="popup-detail" style="color: #03dac6; font-weight: bold;">Destination:</div>
        <div class="popup-detail" style="margin-left: 8px;">${targetName}</div>
      `;
            overlay.setPosition(evt.coordinate);
        } else {
            overlay.setPosition(undefined);
        }
    } else {
        overlay.setPosition(undefined);
    }
});

// Event listener for teleport links inside the popup content
content.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const link = target.closest(".teleport-link") as HTMLElement | null;
    if (!link) return;
    e.preventDefault();

    const destX = parseFloat(link.getAttribute("data-x") || "0");
    const destY = parseFloat(link.getAttribute("data-y") || "0");
    const destRegionRaw = parseInt(link.getAttribute("data-region") || "0", 10);
    const destRegion = destRegionRaw < 0 ? destRegionRaw + 65536 : destRegionRaw;
    const destName = link.getAttribute("data-name") || "Destination";

    let targetLayerKey = "world";
    if (destRegion >= 32768) {
        const dungeonFloorKey = getDungeonFloorKey(destX, destY, destRegion);
        if (dungeonFloorKey) {
            targetLayerKey = dungeonFloorKey;
        }
    }

    // Switch layers if needed
    if (currentLayerKey !== targetLayerKey) {
        setCurrentLayerKey(targetLayerKey);
        const layerSelect = document.getElementById("layer-select") as HTMLSelectElement | null;
        if (layerSelect) {
            layerSelect.value = targetLayerKey;
        }

        tileSource.clear();
        mapLayer.setSource(null);
        mapLayer.setSource(tileSource);

        // Refresh markers & navmesh
        updateMarkers(currentLayerKey);
        updateNavmesh(map, currentLayerKey);
        updateCoordsVal();
    }

    const coords = convertSROToMap(destX, destY, destRegion);

    // Pan view to destination coords
    map.getView().animate({
        center: coords,
        zoom: 11,
        duration: 500,
    });

    // Find actual object in database to resolve its teleport links
    const foundNpc = npcsData.find((n) => n.name === destName);
    const foundTp = foundNpc ? null : teleportsData.find((t) => t.name === destName);
    const teleportList = foundNpc?.teleport || foundTp?.teleport || [];
    const type = foundNpc ? 7 : foundTp ? foundTp.type : undefined;
    const typeString = type !== undefined ? TELEPORT_TYPES[type] || "Teleport Connection" : null;

    const destSro = convertMapToSRO(coords[0], coords[1], currentLayerKey);
    const regionString =
        currentLayerKey === "world"
            ? `${destSro.region} (${destSro.region & 0xff},${destSro.region >> 8})`
            : `${destSro.region}`;

    // Update popup content for target
    content.innerHTML = `
    <div class="popup-title">${destName}</div>
    ${typeString ? `<div class="popup-detail">Type: ${typeString}</div>` : ""}
    <div class="popup-detail">X: ${destSro.x}</div>
    <div class="popup-detail">Y: ${destSro.y}</div>
    <div class="popup-detail">Region: ${regionString}</div>
    ${
        teleportList.length > 0
            ? `
      <div class="popup-detail" style="margin-top: 8px; border-top: 1px solid #444; padding-top: 6px; font-weight: bold; color: #03dac6;">Teleport Destinations:</div>
      ${teleportList
          .map((d: any) => {
              let r = d.region;
              if (r < 0) r += 65536;
              return `
          <div class="popup-detail">
            <a href="#" class="teleport-link" data-x="${d.x}" data-y="${d.y}" data-region="${r}" data-name="${d.name}" style="color: #bb86fc; text-decoration: underline; cursor: pointer;">
              ${d.name} (Region: ${r})
            </a>
          </div>
        `;
          })
          .join("")}
    `
            : ""
    }
  `;
    overlay.setPosition(coords);
});
