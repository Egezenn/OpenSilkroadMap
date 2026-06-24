import {
    currentLayerKey,
    map,
    mapLayer,
    overlay,
    regionOverlaySource,
    registerCachedPMTiles,
    resetLastRegionId,
    setCurrentLayerKey,
    tileSource,
    updateCoordsVal,
} from "./map";
import { getDungeonFloorKey, registerCachedNavmesh, updateNavmesh } from "./navmesh";
import {
    fetchMarkersData,
    npcsData,
    renderTeleports,
    setRenderTeleports,
    teleportsData,
    updateMarkers,
} from "./markers";
import { convertSROToMap } from "./coord";
import { TELEPORT_TYPES } from "./styles";
import { PMTilesDB } from "./pmtiles_db";

// Handle map tiles toggle change
const mapTilesToggle = document.getElementById("maptiles-toggle") as HTMLInputElement | null;
if (mapTilesToggle) {
    const savedMapTiles = localStorage.getItem("maptiles-toggle");
    if (savedMapTiles !== null) {
        mapTilesToggle.checked = savedMapTiles === "true";
    }
    mapLayer.setVisible(mapTilesToggle.checked);
    mapTilesToggle.addEventListener("change", () => {
        localStorage.setItem("maptiles-toggle", String(mapTilesToggle.checked));
        mapLayer.setVisible(mapTilesToggle.checked);
    });
}

// Handle navmesh toggle change
const navmeshToggle = document.getElementById("navmesh-toggle") as HTMLInputElement | null;
if (navmeshToggle) {
    const savedNavmesh = localStorage.getItem("navmesh-toggle");
    if (savedNavmesh !== null) {
        navmeshToggle.checked = savedNavmesh === "true";
    }
    navmeshToggle.addEventListener("change", () => {
        localStorage.setItem("navmesh-toggle", String(navmeshToggle.checked));
        updateNavmesh(map, currentLayerKey);
    });
}

// Handle region info toggle change
const regionToggle = document.getElementById("region-info-toggle") as HTMLInputElement | null;
if (regionToggle) {
    const savedRegion = localStorage.getItem("region-info-toggle");
    if (savedRegion !== null) {
        regionToggle.checked = savedRegion === "true";
    }
    regionToggle.addEventListener("change", () => {
        localStorage.setItem("region-info-toggle", String(regionToggle.checked));
        if (!regionToggle.checked) {
            regionOverlaySource.clear();
            resetLastRegionId();
        }
    });
}

// Handle teleport connection toggles changes
for (let i = 0; i <= 7; i++) {
    const toggle = document.getElementById(`toggle-conn-${i}`) as HTMLInputElement | null;
    if (toggle) {
        const savedToggle = localStorage.getItem(`toggle-conn-${i}`);
        if (savedToggle !== null) {
            toggle.checked = savedToggle === "true";
        }
        toggle.addEventListener("change", () => {
            localStorage.setItem(`toggle-conn-${i}`, String(toggle.checked));
            updateMarkers(currentLayerKey);
        });
    }
}

// Handle toggle all connections button
const toggleAllBtn = document.getElementById("toggle-all-conn");
if (toggleAllBtn) {
    toggleAllBtn.addEventListener("click", () => {
        let anyChecked = false;
        const checkboxes: HTMLInputElement[] = [];
        for (let i = 0; i <= 7; i++) {
            const cb = document.getElementById(`toggle-conn-${i}`) as HTMLInputElement | null;
            if (cb) {
                checkboxes.push(cb);
                if (cb.checked) {
                    anyChecked = true;
                }
            }
        }

        const targetState = !anyChecked;
        checkboxes.forEach((cb, i) => {
            cb.checked = targetState;
            localStorage.setItem(`toggle-conn-${i}`, String(targetState));
        });

        updateMarkers(currentLayerKey);
    });
}

// Handle layer selection updates
const layerSelect = document.getElementById("layer-select") as HTMLSelectElement | null;
if (layerSelect) {
    layerSelect.addEventListener("change", (e) => {
        const target = e.target as HTMLSelectElement;
        setCurrentLayerKey(target.value);

        // Refresh the background JPEGs source
        tileSource.clear();
        mapLayer.setSource(null);
        mapLayer.setSource(tileSource);

        // Redraw markers & navmeshes
        updateMarkers(currentLayerKey);
        updateNavmesh(map, currentLayerKey);
        updateCoordsVal();

        // Re-center maps
        const view = map.getView();
        if (currentLayerKey === "world") {
            view.setCenter([135, 91]);
            view.setZoom(6);
        } else {
            view.setCenter([128, 127]);
            view.setZoom(8);
        }
    });
}

// Trigger initial remote datasets fetch and render
fetchMarkersData(() => {
    updateMarkers(currentLayerKey);
    updateNavmesh(map, currentLayerKey);
});

let teleportRenderTimeout: number | null = null;

map.on("movestart", () => {
    if (teleportRenderTimeout !== null) {
        clearTimeout(teleportRenderTimeout);
        teleportRenderTimeout = null;
    }
    setRenderTeleports(false);
    updateMarkers(currentLayerKey);
});

map.on("pointerdrag", () => {
    if (teleportRenderTimeout !== null) {
        clearTimeout(teleportRenderTimeout);
        teleportRenderTimeout = null;
    }
    if (renderTeleports) {
        setRenderTeleports(false);
        updateMarkers(currentLayerKey);
    }
});

map.on("moveend", () => {
    if (teleportRenderTimeout !== null) {
        clearTimeout(teleportRenderTimeout);
    }
    teleportRenderTimeout = window.setTimeout(() => {
        teleportRenderTimeout = null;
        setRenderTeleports(true);
        updateMarkers(currentLayerKey);
    }, 500);
});

// Search input and dropdown functionality with collapsed details tags
const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
const searchResults = document.getElementById("search-results") as HTMLDivElement | null;

function renderCategories(query = "") {
    if (!searchResults) return;
    searchResults.innerHTML = "";

    const matchedNPCs = npcsData
        .filter((n) => !query || n.name.toLowerCase().includes(query))
        .map((n) => ({ ...n, typeName: "NPC", category: "NPC" }));

    const matchedTPs = teleportsData
        .filter((t) => !query || t.name.toLowerCase().includes(query))
        .map((t) => {
            const typeName = TELEPORT_TYPES[t.type] || "Teleport";
            return { ...t, typeName, category: typeName };
        });

    const allItems = [...matchedNPCs, ...matchedTPs];

    // Group by category
    const groups: Record<string, typeof allItems> = {
        NPC: [],
        "Dimensional Gate": [],
        "Fortress Gate": [],
        "Revival Gate": [],
        "Glory Gate": [],
        "Small Fortress Gate": [],
        "Teleport Gate": [],
        "Tahomet Gate": [],
        "NPC Teleport": [],
    };

    allItems.forEach((item) => {
        const cat = item.category || "Teleport";
        if (!groups[cat]) {
            groups[cat] = [];
        }
        groups[cat].push(item);
    });

    let hasAnyMatches = false;

    Object.entries(groups).forEach(([categoryName, items]) => {
        if (items.length === 0) return;
        hasAnyMatches = true;

        const detailsEl = document.createElement("details");
        if (query) {
            detailsEl.open = true; // expand when searched
        }

        const summaryEl = document.createElement("summary");
        summaryEl.textContent = `${categoryName} (${items.length})`;
        detailsEl.appendChild(summaryEl);

        // Limit default visible items to 100 inside a category for performance
        const itemsToShow = query ? items : items.slice(0, 100);

        itemsToShow.forEach((item) => {
            const itemDiv = document.createElement("div");
            itemDiv.className = "search-result-item";
            itemDiv.textContent = item.name;
            itemDiv.addEventListener("click", () => {
                let region = item.region;
                if (region < 0) region += 65536;

                let targetLayerKey = "world";
                if (region >= 32768) {
                    const dungeonFloorKey = getDungeonFloorKey(item.x, item.y, region);
                    if (dungeonFloorKey) {
                        targetLayerKey = dungeonFloorKey;
                    }
                }

                if (currentLayerKey !== targetLayerKey) {
                    setCurrentLayerKey(targetLayerKey);
                    if (layerSelect) {
                        layerSelect.value = targetLayerKey;
                    }

                    tileSource.clear();
                    mapLayer.setSource(null);
                    mapLayer.setSource(tileSource);

                    updateMarkers(currentLayerKey);
                    updateNavmesh(map, currentLayerKey);
                }

                const coords = convertSROToMap(item.x, item.y, region);
                const view = map.getView();
                view.animate({
                    center: coords,
                    zoom: 11,
                    duration: 500,
                });

                // Show popup
                const regionString =
                    targetLayerKey === "world" ? `${region} (${region & 0xff},${region >> 8})` : `${region}`;

                const contentEl = document.getElementById("popup-content");
                if (contentEl) {
                    contentEl.innerHTML = `
            <div class="popup-title">${item.name}</div>
            <div class="popup-detail">Type: ${item.typeName}</div>
            <div class="popup-detail">X: ${item.x}</div>
            <div class="popup-detail">Y: ${item.y}</div>
            <div class="popup-detail">Region: ${regionString}</div>
          `;
                }
                overlay.setPosition(coords);
            });
            detailsEl.appendChild(itemDiv);
        });

        if (!query && items.length > 100) {
            const moreDiv = document.createElement("div");
            moreDiv.className = "search-result-item";
            moreDiv.style.cursor = "default";
            moreDiv.style.color = "#888";
            moreDiv.style.fontStyle = "italic";
            moreDiv.textContent = `... and ${items.length - 100} more (use search to filter)`;
            detailsEl.appendChild(moreDiv);
        }

        searchResults.appendChild(detailsEl);
    });

    if (!hasAnyMatches) {
        const emptyDiv = document.createElement("div");
        emptyDiv.className = "search-result-item";
        emptyDiv.style.cursor = "default";
        emptyDiv.style.color = "#888";
        emptyDiv.textContent = "No results found";
        searchResults.appendChild(emptyDiv);
    }
}

if (searchInput && searchResults) {
    searchInput.addEventListener("focus", () => {
        renderCategories(searchInput.value.toLowerCase().trim());
        searchResults.style.display = "block";
    });

    searchInput.addEventListener("input", () => {
        renderCategories(searchInput.value.toLowerCase().trim());
        searchResults.style.display = "block";
    });

    // Hide search results when clicking outside
    document.addEventListener("click", (e) => {
        if (
            searchInput &&
            searchResults &&
            !searchInput.contains(e.target as Node) &&
            !searchResults.contains(e.target as Node)
        ) {
            searchResults.style.display = "none";
        }
    });
}

const precacheBtn = document.getElementById("precache-btn");
const precacheIcon = document.getElementById("precache-icon");
const precacheProgress = document.getElementById("precache-progress");
const precachePercent = document.getElementById("precache-percent");
const precacheCount = document.getElementById("precache-count");

const ARCHIVE_KEYS = [
    "world",
    "navmesh_world",
    "32769_1",
    "32769_2",
    "32769_3",
    "32769_4",
    "32775",
    "32774",
    "32773",
    "32772",
    "32771",
    "32770",
    "32784",
    "32786",
    "32785",
];

async function updateCacheStatusIcon() {
    if (!precacheIcon) return;
    let allCached = true;
    for (const key of ARCHIVE_KEYS) {
        const hasArchive = await PMTilesDB.has(key);
        if (!hasArchive) {
            allCached = false;
            break;
        }
    }
    precacheIcon.textContent = allCached ? "check_box" : "check_box_outline_blank";
}

if (precacheBtn && precacheProgress && precachePercent && precacheCount) {
    updateCacheStatusIcon();

    precacheBtn.addEventListener("click", async () => {
        precacheBtn.setAttribute("disabled", "true");
        precacheBtn.style.opacity = "0.6";
        precacheBtn.style.cursor = "not-allowed";
        precacheProgress.style.display = "block";

        try {
            let completedCount = 0;
            for (const key of ARCHIVE_KEYS) {
                precachePercent.textContent = `Downloading ${key}...`;
                precacheCount.textContent = `${completedCount}/${ARCHIVE_KEYS.length}`;

                const url = `/assets/${key}.pmtiles`;
                const res = await fetch(url);
                if (!res.ok) throw new Error(`Failed to fetch ${key}`);

                const contentLength = res.headers.get("content-length");
                const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
                let loadedBytes = 0;

                const reader = res.body!.getReader();
                const chunks: Uint8Array[] = [];
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value) {
                        chunks.push(value);
                        loadedBytes += value.length;
                        if (totalBytes > 0) {
                            const pct = Math.round((loadedBytes / totalBytes) * 100);
                            precachePercent.textContent = `Downloading ${key}: ${pct}%`;
                        }
                    }
                }

                const fullBlob = new Blob(chunks, { type: "application/octet-stream" });
                await PMTilesDB.set(key, fullBlob);

                // Instantly register blob inside Map/Navmesh to bypass network range fetches
                if (key === "navmesh_world") {
                    registerCachedNavmesh(fullBlob);
                } else {
                    registerCachedPMTiles(key, fullBlob);
                }

                completedCount++;
                precacheCount.textContent = `${completedCount}/${ARCHIVE_KEYS.length}`;
            }

            precachePercent.textContent = "100% (Done)";
            precacheCount.textContent = `Cached ${ARCHIVE_KEYS.length} archives`;
        } catch (e) {
            precachePercent.textContent = "Error caching";
            precacheCount.textContent = String(e);
        } finally {
            precacheBtn.removeAttribute("disabled");
            precacheBtn.style.opacity = "1";
            precacheBtn.style.cursor = "pointer";
            updateCacheStatusIcon();
        }
    });
}
