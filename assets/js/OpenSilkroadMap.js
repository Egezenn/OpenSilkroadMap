// Increase performance with too many markers
// Tile Cache using IndexedDB
var TileCache = (function () {
  var dbName = "OpenSilkroadMapCache";
  var storeName = "tiles";
  var dbPromise = null;

  function getDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      var request = indexedDB.open(dbName, 1);
      request.onerror = (e) => reject(e);
      request.onsuccess = (e) => resolve(e.target.result);
      request.onupgradeneeded = (e) => {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };
    });
    return dbPromise;
  }

  return {
    get: async function (key) {
      try {
        var db = await getDB();
        return new Promise((resolve, reject) => {
          var transaction = db.transaction(storeName, "readonly");
          var store = transaction.objectStore(storeName);
          var request = store.get(key);
          request.onsuccess = (e) => resolve(e.target.result);
          request.onerror = (e) => reject(e);
        });
      } catch (e) {
        return null;
      }
    },
    set: async function (key, blob) {
      try {
        var db = await getDB();
        var transaction = db.transaction(storeName, "readwrite");
        var store = transaction.objectStore(storeName);
        store.put(blob, key);
      } catch (e) {
        /* ignore quota errors */
      }
    },
  };
})();

L.Marker.addInitHook(function () {
  if (this.options.virtual) {
    // setup virtualization after marker was added
    this.on(
      "add",
      function () {
        this._updateIconVisibility = function () {
          if (this._map == null) return;
          var isVisible = this._map.getBounds().contains(this.getLatLng());
          var wasVisible = this._wasVisible;

          var icon = this._icon;
          var shadow = this._shadow;

          // add/remove from DOM on change
          if (isVisible != wasVisible) {
            if (isVisible) {
              if (icon && this._iconParent && !icon.parentNode) {
                this._iconParent.appendChild(icon);
              }
              if (shadow && this._shadowParent && !shadow.parentNode) {
                this._shadowParent.appendChild(shadow);
              }
            } else {
              if (icon && icon.parentNode) {
                this._iconParent = icon.parentNode;
                icon.parentNode.removeChild(icon);
              }
              if (shadow && shadow.parentNode) {
                this._shadowParent = shadow.parentNode;
                shadow.parentNode.removeChild(shadow);
              }
            }
            this._wasVisible = isVisible;
          }
        };
        // on map size change, remove/add icon from/to DOM
        this._map.on("resize moveend zoomend", this._updateIconVisibility, this);
        this._updateIconVisibility();
      },
      this,
    );
  }
});
/*
 * Silkroad map handler.
 */
var OpenSilkroadMap = (function () {
  "use strict";

  // Capture original console for the UI
  var originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
  };

  var setupConsoleHook = function () {
    var capture = function (type, args) {
      try {
        var msg = Array.from(args)
          .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : arg))
          .join(" ");
        if (typeof AddLogToUI === "function") {
          AddLogToUI(type, msg);
        }
      } catch (e) {}
    };

    console.log = function () {
      capture("log", arguments);
      originalConsole.log.apply(console, arguments);
    };
    console.warn = function () {
      capture("warn", arguments);
      originalConsole.warn.apply(console, arguments);
    };
    console.error = function () {
      capture("error", arguments);
      originalConsole.error.apply(console, arguments);
    };
    console.info = function () {
      capture("info", arguments);
      originalConsole.info.apply(console, arguments);
    };
  };

  // call hook setup immediately
  setTimeout(setupConsoleHook, 100);

  // OpenSilkroadMap variables
  var imgHost = "assets/img/silkroad/minimap/";
  var iconHost = "assets/icons/";
  // map handler
  var map;
  // current tile layer
  var mapLayer;
  var coordGoBack;
  var lastMarkerSelected;
  // mapping
  var mappingLayers = {};
  var mappingMarkers = {
    npc: {},
    tp: {},
    player: {},
    location: {},
  };
  var mappingShapes = {};
  // navmesh overlay
  var navmeshLayer = null;
  var navmeshVisible = true;
  var navmeshWorldLayer = null;
  var navmeshDungeonLayers = {};
  // navigation linkage
  var linkageLayerGroup = L.layerGroup();
  var linkageVisible = false;
  var currentLinkageData = null; // Store current linkage data
  var nodeMarkers = {}; // nodeId -> marker
  var edgeLines = {}; // edgeId -> polyline
  var selectedChainNodes = []; // List of node IDs in the selected chain
  var botStatusInterval = null;
  var botPlayerMarker = null;
  var lastProcessedLogIndex = 0;
  var processedLogIds = new Set();
  var lastPannedBotPos = null;
  var initialPanDone = false;
  var lastDataVersion = 0;
  var activePathLayerGroup = L.layerGroup();
  var lastPathNodesJson = null;
  // native gate architecture
  var nativeLayerGroup = L.layerGroup();
  var nativeVisible = false;
  var nativeMarkers = {}; // gateId -> marker
  var nativeLines = {}; // linkId -> polyline
  var nativeData = null; // Store fetched gateways

  var getDistance = function (latlng1, latlng2) {
    if (!latlng1 || !latlng2) return 0;
    var c1 = CoordMapToSRO(latlng1);
    var c2 = CoordMapToSRO(latlng2);
    var dx, dy;
    if (c1.posX != null && c2.posX != null) {
      dx = c1.posX - c2.posX;
      dy = c1.posY - c2.posY;
    } else {
      dx = (c1.x - c2.x) / 10;
      dy = (c1.y - c2.y) / 10;
    }
    return Math.sqrt(dx * dx + dy * dy);
  };

  var findNearestNode = function (latlng, threshold) {
    var t = threshold || 2.0;
    var nearestNodeId = null;
    var minDist = t;

    for (var nodeId in nodeMarkers) {
      var marker = nodeMarkers[nodeId];
      var dist = getDistance(latlng, marker.getLatLng());
      if (dist < minDist) {
        minDist = dist;
        nearestNodeId = nodeId;
      }
    }
    return nearestNodeId;
  };

  var updateNodeStyle = function (marker) {
    if (!marker || !marker.nodeData) return;
    var node = marker.nodeData;
    var color = node.edited ? "#af4dff" : "#3388ff";

    // Special color for teleports even if not edited?
    // Actually blue is fine for walk, but let's see if we have types for nodes
    // Nodes don't usually have types, edges do.

    marker.setStyle({
      color: color,
      fillColor: color,
    });

    var status = node.edited ? " (Edited)" : "";
    marker.setPopupContent(
      "<b>Node: " +
        marker.nodeId +
        status +
        "</b><br>X: " +
        node.x +
        " Y: " +
        node.y +
        "<br>Region: " +
        node.region +
        "<br><button onclick=\"OpenSilkroadMap.SelectChain('" +
        marker.nodeId +
        "')\">Select Chain</button> <button onclick=\"OpenSilkroadMap.SendNavigationRequest('" +
        marker.nodeId +
        "')\">Navigate</button>",
    );
  };

  var updateLineStyle = function (line) {
    if (!line || !line.getLatLngs) return;
    var pts = line.getLatLngs();
    if (pts.length < 2) return;
    var dist = getDistance(pts[0], pts[1]);
    var isLong = dist > 100;

    var color = "#3388ff"; // Default walk edge blue
    if (isLong) {
      color = "#ff4d4d"; // Red
    } else if (line.edgeData && line.edgeData.type === "teleport") {
      color = "#ff3388"; // Pink
    } else if (line.edgeData && line.edgeData.edited) {
      color = "#af4dff"; // Purple for editor
    }

    line.setStyle({
      color: color,
      weight: isLong ? 3 : 2,
    });
    var text = Math.round(dist * 10) / 10 + (isLong ? " (TOO LONG)" : "");
    $("#status-length span").css("color", isLong ? "#ff4d4d" : "#e6e6fa");
  };

  // Helper to update edges when a node moves
  var updateEdgesForNode = function (nodeId) {
    for (var edgeId in edgeLines) {
      var line = edgeLines[edgeId];
      if (!line || !line.edgeData) continue;
      var edge = line.edgeData;
      if (edge.from === nodeId || edge.to === nodeId) {
        var fromMarker = nodeMarkers[edge.from];
        var toMarker = nodeMarkers[edge.to];
        if (fromMarker && toMarker) {
          line.setLatLngs([fromMarker.getLatLng(), toMarker.getLatLng()]);
          edge.edited = true;
          updateLineStyle(line);
        }
      }
    }
  };

  var UpdateNavigationPath = function (pathNodes) {
    if (pathNodes === undefined) {
      console.warn("UpdateNavigationPath: 'path' field is MISSING from bot navigation data.");
      return;
    }

    var pathJson = JSON.stringify(pathNodes);
    if (pathJson === lastPathNodesJson) {
      return; // No change
    }
    lastPathNodesJson = pathJson;

    if (pathNodes && pathNodes.length > 0) {
      console.log("UpdateNavigationPath: Path changed (" + pathNodes.length + " nodes). Updating...");
    }

    activePathLayerGroup.clearLayers();
    if (!pathNodes || pathNodes.length < 2) {
      if (map.hasLayer(activePathLayerGroup)) map.removeLayer(activePathLayerGroup);
      return;
    }

    var latlngs = [];
    var resolvedCount = 0;
    for (var i = 0; i < pathNodes.length; i++) {
      var nodeId = pathNodes[i];
      // Handle if bot sends objects instead of IDs
      if (typeof nodeId === "object" && nodeId !== null) nodeId = nodeId.id;

      nodeId = String(nodeId);
      var marker = nodeMarkers[nodeId];
      if (marker) {
        latlngs.push(marker.getLatLng());
        resolvedCount++;
      } else if (currentLinkageData && currentLinkageData.nodes[nodeId]) {
        // Look up from raw data if marker isn't on current layer/visible
        var n = currentLinkageData.nodes[nodeId];
        latlngs.push(CoordSROToMap(fixCoords(n.x, n.y, n.z, n.region)));
        resolvedCount++;
      }
    }

    if (latlngs.length >= 2) {
      var pathLine = L.polyline(latlngs, {
        color: "#ffff00",
        weight: 8,
        opacity: 0.8,
        dashArray: "10, 15",
        lineCap: "round",
        interactive: false,
        zIndexOffset: 2000,
      });
      pathLine.addTo(activePathLayerGroup);
      if (!map.hasLayer(activePathLayerGroup)) activePathLayerGroup.addTo(map);
    }
  };

  var UpdateNativeArchitecture = function () {
    if (!nativeData || Object.keys(nativeData).length === 0) return;

    // Use gold portal icon for native gates
    var nativeIcon = new L.Icon({
      iconUrl: iconHost + "xy_gate.png",
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      popupAnchor: [0, -12],
      className: "native-gate-icon", // We will style this with CSS filter: sepia(1) saturate(5) hue-rotate(10deg);
    });

    for (var gateId in nativeData) {
      var gate = nativeData[gateId];
      var coord = fixCoords(gate.x, gate.y, 0, gate.region);
      var mapPos = CoordSROToMap(coord);
      var layer = getLayer(coord);

      // 1. Handle main gate marker
      if (!nativeMarkers[gateId]) {
        // Build link buttons
        var linkHtml = "";
        if (gate.links && gate.links.length > 0) {
          linkHtml = "<br><b>Destinations:</b><ul style='padding-left:15px; margin:5px 0;'>";
          for (var i = 0; i < gate.links.length; i++) {
            var link = gate.links[i];
            var linkId = gateId + "_" + link.target_id;
            var destName = link.region_name || "Region " + link.region;
            linkHtml +=
              "<li><a href='#' " +
              "onmouseenter='OpenSilkroadMap.HighlightNativeLink(\"" +
              linkId +
              "\", true)' " +
              "onmouseleave='OpenSilkroadMap.HighlightNativeLink(\"" +
              linkId +
              "\", false)' " +
              "onclick='OpenSilkroadMap.ImportNativeLink(\"" +
              gateId +
              '", ' +
              i +
              "); return false;'>Import Link to " +
              destName +
              "</a></li>";
          }
          linkHtml += "</ul>";
        }

        var marker = L.marker(mapPos, {
          icon: nativeIcon,
          pane: "linkageNodes",
          interactive: true,
        }).bindPopup("<b>Native Gate:</b> " + (gate.servername || gateId) + "<br>Region: " + gate.region + linkHtml);

        nativeMarkers[gateId] = {
          marker: marker,
          layer: layer,
        };

        if (layer == mapLayer) marker.addTo(nativeLayerGroup);
      }

      // 2. Handle links
      if (gate.links) {
        for (var i = 0; i < gate.links.length; i++) {
          var link = gate.links[i];
          var linkId = gateId + "_" + link.target_id;

          if (!nativeLines[linkId]) {
            var targetCoord = fixCoords(link.x, link.y, 0, link.region);
            var targetMapPos = CoordSROToMap(targetCoord);

            if (getLayer(targetCoord) == layer) {
              var line = L.polyline([mapPos, targetMapPos], {
                color: "#ffd700",
                weight: 1,
                opacity: 0.4,
                dashArray: "5, 5",
                interactive: false,
                pane: "linkageEdges",
              });

              nativeLines[linkId] = {
                line: line,
                layer: layer,
              };

              if (layer == mapLayer) line.addTo(nativeLayerGroup);
            }
          }
        }
      }
    }
  };

  var FetchNativeGateways = function () {
    console.log("Loading native gateways from teleports.json...");
    fetch("assets/teleports.json")
      .then((res) => res.json())
      .then((data) => {
        var transformed = {};
        data.forEach((tp, idx) => {
          var gateId = tp.x + "_" + tp.y + "_" + tp.region;
          var links = [];
          if (tp.teleport) {
            tp.teleport.forEach((link) => {
              links.push({
                x: link.x,
                y: link.y,
                region: link.region,
                target_id: link.target_id || link.x + "_" + link.y + "_" + link.region,
                region_name: link.name,
              });
            });
          }
          transformed[gateId] = {
            name: tp.name,
            servername: tp.name,
            codename: tp.codename || tp.name,
            x: tp.x,
            y: tp.y,
            region: tp.region,
            links: links,
          };
        });
        console.log("Native gateways loaded from local JSON: " + Object.keys(transformed).length);
        nativeData = transformed;
        UpdateNativeArchitecture();
      })
      .catch((err) => {
        console.error("Could not load native gateways:", err);
      });
  };

  var ImportNativeLink = function (gateId, linkIdx) {
    if (!nativeData || !nativeData[gateId]) return;
    var gate = nativeData[gateId];
    var link = gate.links[linkIdx];
    if (!link) return;

    if (!currentLinkageData) currentLinkageData = { nodes: {}, edges: {} };

    // 1. Resolve source node (Snap to existing if nearby)
    var sourceMapPos = CoordSROToMap(fixCoords(gate.x, gate.y, 0, gate.region));
    var sourceId =
      findNearestNode(L.latLng(sourceMapPos[0], sourceMapPos[1])) ||
      Math.floor(gate.x) + "_" + Math.floor(gate.y) + "_" + gate.region;

    if (!nodeMarkers[sourceId] && !currentLinkageData.nodes[sourceId]) {
      currentLinkageData.nodes[sourceId] = {
        x: gate.x,
        y: gate.y,
        region: gate.region,
        edited: true,
      };
    }

    // 2. Resolve target node (Snap to existing if nearby)
    var targetMapPos = CoordSROToMap(fixCoords(link.x, link.y, 0, link.region));
    var targetId =
      findNearestNode(L.latLng(targetMapPos[0], targetMapPos[1])) ||
      Math.floor(link.x) + "_" + Math.floor(link.y) + "_" + link.region;

    if (!nodeMarkers[targetId] && !currentLinkageData.nodes[targetId]) {
      currentLinkageData.nodes[targetId] = {
        x: link.x,
        y: link.y,
        region: link.region,
        edited: true,
      };
    }

    // 3. Create teleport edge
    var edgeId = sourceId + "__" + targetId;
    if (!edgeLines[edgeId]) {
      var edgeData = {
        from: sourceId,
        to: targetId,
        type: "teleport",
        npc: gate.codename || gate.servername || "Unknown",
        dest: link.target_id,
        steps: null,
        edited: true,
      };
      currentLinkageData.edges[edgeId] = edgeData;
    }

    // Refresh UI
    this.AddNavigationLinkage(currentLinkageData, false);
    console.log("Imported native link: " + edgeId);
  };

  var HighlightNativeLink = function (linkId, isActive) {
    var data = nativeLines[linkId];
    if (!data || !data.line) return;

    if (isActive) {
      data.line.setStyle({
        weight: 4,
        color: "#ffd700",
        opacity: 1.0,
        dashArray: null,
      });
      data.line.bringToFront();
    } else {
      data.line.setStyle({
        weight: 1,
        color: "#ffd700",
        opacity: 0.4,
        dashArray: "5, 5",
      });
    }
  };

  var removeNode = function (nodeId, skipHistory = false) {
    var marker = nodeMarkers[nodeId];
    if (marker) {
      linkageLayerGroup.removeLayer(marker);
      delete nodeMarkers[nodeId];
    }
    // Remove associated edges
    for (var edgeId in edgeLines) {
      var line = edgeLines[edgeId];
      if (line.edgeData.from === nodeId || line.edgeData.to === nodeId) {
        linkageLayerGroup.removeLayer(line);
        delete edgeLines[edgeId];
      }
    }
  };
  // xSRO Map conversions
  var CoordMapToSRO = function (latlng) {
    // world layer
    if (mapLayer == mappingLayers[""])
      return CoordsGameToSRO({ posX: (latlng.lng - 135) * 192, posY: (latlng.lat - 91) * 192 });

    return {
      x: (latlng.lng * 192 - 128 * 192) * 10,
      y: (latlng.lat * 192 - 127 * 192) * 10,
      z: mapLayer.options.posZ,
      region: parseInt(mapLayer.options.region),
    };
  };
  var CoordSROToMap = function (coords) {
    var lng, lat;
    // dungeon?
    if (coords.region > 32767) {
      lng = (128 * 192 + coords.x / 10) / 192;
      lat = (127 * 192 + coords.y / 10) / 192;
      return [lat, lng];
    }
    // world coord type
    if (coords.posY !== undefined && coords.posX !== undefined) {
      lat = coords.posY / 192 + 91;
      lng = coords.posX / 192 + 135;
    } else {
      // RSBot and some other tools store global posX/posY in the x/y fields
      // even when region is present. We detect this by checking if the values
      // exceed the valid local sector range (0-1920) or mathematically align.
      var expectedRegX = Math.floor(coords.x / 192.0) + 135;
      var expectedRegY = Math.floor(coords.y / 192.0) + 92;
      var matchesRegion = expectedRegX === (coords.region & 0xff) && expectedRegY === ((coords.region >> 8) & 0xff);

      if (matchesRegion || coords.x < 0 || coords.x > 1920 || coords.y < 0 || coords.y > 1920) {
        lat = coords.y / 192 + 91;
        lng = coords.x / 192 + 135;
      } else {
        lng = (coords.region & 0xff) + coords.x / 1920;
        lat = ((coords.region >> 8) & 0xff) + coords.y / 1920 - 1;
      }
    }
    return [lat, lng];
  };
  var CoordsGameToSRO = function (gameCoords) {
    gameCoords["x"] = gameCoords.posX;
    gameCoords["y"] = gameCoords.posY;

    var xSector = Math.floor(gameCoords.posX / 192.0) + 135;
    var ySector = Math.floor(gameCoords.posY / 192.0) + 92;
    gameCoords["region"] = (ySector << 8) | xSector;

    return gameCoords;
  };
  // initialize layer setup
  var initLayers = function (id) {
    // map base
    map = L.map("map", {
      crs: L.CRS.Simple,
      minZoom: 0,
      maxZoom: 12,
      zoomControl: false,
    });
    new L.Control.Zoom({ position: "topright" }).addTo(map);

    // Create custom panes for navigation layer order
    map.createPane("linkageEdges");
    map.getPane("linkageEdges").style.zIndex = 450; // Above tiles, below markers
    map.createPane("linkageNodes");
    map.getPane("linkageNodes").style.zIndex = 660; // Above markers, below popups
    map.createPane("player");
    map.getPane("player").style.zIndex = 680; // Above everything else except popups

    // Fix circle drawing on CRS.Simple
    L.LatLng.prototype.distanceTo = function (currentPostion) {
      var dx = currentPostion.lng - this.lng;
      var dy = currentPostion.lat - this.lat;
      return Math.sqrt(dx * dx + dy * dy);
    };
    // Fix Tile layer inversed and add caching/error handling
    var SRLayer = L.TileLayer.extend({
      getTileUrl: function (tile) {
        tile.y = -tile.y;
        return L.TileLayer.prototype.getTileUrl.call(this, tile);
      },
      createTile: function (coords, done) {
        var tile = document.createElement("img");
        tile.alt = "";
        tile.setAttribute("role", "presentation");

        var url = this.getTileUrl(coords);
        var tileKey = url;

        // Aggressive Caching via IndexedDB
        TileCache.get(tileKey).then((blob) => {
          if (blob) {
            var blobUrl = URL.createObjectURL(blob);
            tile.src = blobUrl;
            tile.onload = function () {
              URL.revokeObjectURL(blobUrl);
              done(null, tile);
            };
          } else {
            // Fetch and cache
            fetch(url)
              .then((res) => {
                if (!res.ok) throw new Error("404");
                return res.blob();
              })
              .then((blob) => {
                TileCache.set(tileKey, blob);
                var blobUrl = URL.createObjectURL(blob);
                tile.src = blobUrl;
                tile.onload = function () {
                  URL.revokeObjectURL(blobUrl);
                  done(null, tile);
                };
              })
              .catch((err) => {
                // Overfetch issue fix: SILENT 404
                tile.style.display = "none";
                done(null, tile);
              });
          }
        });

        return tile;
      },
    });
    // 192 map units x 256 tiles = 49152 game units (coords)
    var mapSize = 49152;
    map.fitBounds([
      [0, 0],
      [mapSize, mapSize],
    ]);

    // Default layer
    mapLayer = new SRLayer(imgHost + "{z}/{x}x{y}.jpg", {
      attribution: '<a href="#">World Map</a>',
      maxNativeZoom: 9,
      maxZoom: 12,
    });
    mappingLayers[""] = mapLayer;

    map.addLayer(mapLayer);
    map.setView([91, 135], 8);

    // Navmesh overlay layers (PNG tiles)
    var SRNavMeshLayer = L.TileLayer.extend({
      getTileUrl: function (tile) {
        tile.y = -tile.y;
        return L.TileLayer.prototype.getTileUrl.call(this, tile);
      },
      createTile: function (coords, done) {
        var tile = document.createElement("img");
        tile.alt = "";
        tile.setAttribute("role", "presentation");

        var url = this.getTileUrl(coords);
        var tileKey = url;

        // Aggressive Caching
        TileCache.get(tileKey).then((blob) => {
          if (blob) {
            var blobUrl = URL.createObjectURL(blob);
            tile.src = blobUrl;
            tile.onload = function () {
              URL.revokeObjectURL(blobUrl);
              done(null, tile);
            };
          } else {
            fetch(url)
              .then((res) => {
                if (!res.ok) throw new Error("404");
                return res.blob();
              })
              .then((blob) => {
                TileCache.set(tileKey, blob);
                var blobUrl = URL.createObjectURL(blob);
                tile.src = blobUrl;
                tile.onload = function () {
                  URL.revokeObjectURL(blobUrl);
                  done(null, tile);
                };
              })
              .catch((err) => {
                tile.style.display = "none";
                done(null, tile);
              });
          }
        });

        return tile;
      },
    });
    navmeshWorldLayer = new SRNavMeshLayer(imgHost + "navmesh/{z}/{x}x{y}.png", {
      attribution: "NavMesh",
      opacity: 0.7,
    });

    // Area layers
    // cave donwhang
    mappingLayers["32769"] = new SRLayer(imgHost + "d/{z}/dh_a01_floor01_{x}x{y}.jpg", {
      attribution: '<a href="#">Donwhang Stone Cave [1F]</a>',
      posZ: 0,
      overlap: [
        new SRLayer(imgHost + "d/{z}/dh_a01_floor02_{x}x{y}.jpg", {
          attribution: '<a href="#">Donwhang Stone Cave [2F]</a>',
          posZ: 115,
        }),
        new SRLayer(imgHost + "d/{z}/dh_a01_floor03_{x}x{y}.jpg", {
          attribution: '<a href="#">Donwhang Stone Cave [3F]</a>',
          posZ: 230,
        }),
        new SRLayer(imgHost + "d/{z}/dh_a01_floor04_{x}x{y}.jpg", {
          attribution: '<a href="#">Donwhang Stone Cave [4F]</a>',
          posZ: 345,
        }),
      ],
    });
    // cave jangan
    mappingLayers["32775"] = new SRLayer(imgHost + "d/{z}/qt_a01_floor01_{x}x{y}.jpg", {
      attribution: '<a href="#">Underground Level 1 of Tomb of Qui-Shin [B1]</a>',
    });
    mappingLayers["32774"] = new SRLayer(imgHost + "d/{z}/qt_a01_floor02_{x}x{y}.jpg", {
      attribution: '<a href="#">Underground Level 2 of Tomb of Qui-Shin [B2]</a>',
    });
    mappingLayers["32773"] = new SRLayer(imgHost + "d/{z}/qt_a01_floor03_{x}x{y}.jpg", {
      attribution: '<a href="#">Underground Level 3 of Tomb of Qui-Shin [B3]</a>',
    });
    mappingLayers["32772"] = new SRLayer(imgHost + "d/{z}/qt_a01_floor04_{x}x{y}.jpg", {
      attribution: '<a href="#">Underground Level 4 of Tomb of Qui-Shin [B4]</a>',
    });
    mappingLayers["32771"] = new SRLayer(imgHost + "d/{z}/qt_a01_floor05_{x}x{y}.jpg", {
      attribution: '<a href="#">Underground Level 5 of Tomb of Qui-Shin [B5]</a>',
    });
    mappingLayers["32770"] = new SRLayer(imgHost + "d/{z}/qt_a01_floor06_{x}x{y}.jpg", {
      attribution: '<a href="#">Underground Level 6 of Tomb of Qui-Shin [B6]</a>',
    });
    // job temple
    var jobPath = imgHost + "d/{z}/rn_sd_egypt1_01_{x}x{y}.jpg";
    mappingLayers["32784"] = new SRLayer(jobPath, {
      attribution: '<a href="#">Temple</a>',
    });
    mappingLayers["32783"] = new SRLayer(imgHost + "d/{z}/rn_sd_egypt1_02_{x}x{y}.jpg", {
      attribution: '<a href="#">Sanctum of Seth</a>',
    });
    mappingLayers["32782"] = new SRLayer(jobPath, {
      attribution: '<a href="#">Sanctum of Haroeris</a>',
    });
    mappingLayers["32781"] = new SRLayer(jobPath, {
      attribution: '<a href="#">Sanctum of Isis</a>',
    });
    mappingLayers["32780"] = new SRLayer(jobPath, {
      attribution: '<a href="#">Sanctum of Anubis</a>',
    });
    mappingLayers["32779"] = new SRLayer(jobPath, {
      attribution: '<a href="#">Sanctum of Blue Eye</a>',
    });
    // cave generated by fortress war
    mappingLayers["32785"] = new SRLayer(imgHost + "d/{z}/fort_dungeon01_{x}x{y}.jpg", {
      attribution: '<a href="#">Cave of Meditation [1F]</a>',
    });
    // mountain flame
    mappingLayers["32786"] = new SRLayer(imgHost + "d/{z}/flame_dungeon01_{x}x{y}.jpg", {
      attribution: '<a href="#">Flame Mountain</a>',
    });
    // jupiter rooms
    mappingLayers["32787"] = new SRLayer(imgHost + "d/{z}/rn_jupiter_02_{x}x{y}.jpg", {
      attribution: '<a href="#">The Earth\'s Room</a>',
    });
    mappingLayers["32788"] = new SRLayer(imgHost + "d/{z}/rn_jupiter_03_{x}x{y}.jpg", {
      attribution: '<a href="#">Yuno\'s Room</a>',
    });
    mappingLayers["32789"] = new SRLayer(imgHost + "d/{z}/rn_jupiter_04_{x}x{y}.jpg", {
      attribution: '<a href="#">Jupiter\'s Room</a>',
    });
    mappingLayers["32790"] = new SRLayer(imgHost + "d/{z}/rn_jupiter_01_{x}x{y}.jpg", {
      attribution: '<a href="#">Zealots Hideout</a>',
    });
    // 32791 - GM's Room
    // 32792 - Fortress Prison
    // Bahdag room
    mappingLayers["32793"] = new SRLayer(imgHost + "d/{z}/RN_ARABIA_FIELD_02_BOSS_{x}x{y}.jpg", {
      attribution: '<a href="#">Kalia\'s Hideout</a>',
    });
    // 32794 - Sealed Dungeon of Vicious Shadows
    // Secret Tombs
    mappingLayers["32795"] = new SRLayer(imgHost + "d/{z}/ln_secret_tomb_top_{x}x{y}.jpg", {
      attribution: '<a href="#">Upper Secret Tomb</a>',
    });
    mappingLayers["32796"] = new SRLayer(imgHost + "d/{z}/ln_secret_tomb_bottom_{x}x{y}.jpg", {
      attribution: '<a href="#">Lower Secret Tomb</a>',
    });

    // Load dungeon navmesh manifest
    fetch(imgHost + "navmesh/d/manifest.json")
      .then(function (r) {
        return r.ok ? r.json() : {};
      })
      .then(function (manifest) {
        for (var regionKey in manifest) {
          var floors = manifest[regionKey];
          for (var i = 0; i < floors.length; i++) {
            var info = floors[i];
            // Convert game-world coords to Leaflet lat/lng
            // Dungeon: lng = 128 + x/1920, lat = 127 + z/1920
            var southWest = L.latLng(127 + info.minZ / 1920, 128 + info.minX / 1920);
            var northEast = L.latLng(127 + info.maxZ / 1920, 128 + info.maxX / 1920);
            var bounds = L.latLngBounds(southWest, northEast);
            var overlay = L.imageOverlay(imgHost + "navmesh/d/" + info.file, bounds, {
              opacity: 0.7,
              interactive: false,
            });
            // Key: regionKey + '_' + floor to handle multi-floor dungeons
            var layerKey = regionKey + "_" + info.floor;
            navmeshDungeonLayers[layerKey] = overlay;
          }
        }
      })
      .catch(function (e) {
        /* manifest not available, dungeon navmesh disabled */
      });
  };
  // Get the navmesh layer for the current map layer
  var getNavmeshLayerForCurrent = function () {
    if (mapLayer == mappingLayers[""]) return navmeshWorldLayer;
    // For dungeons, find the matching navmesh overlay
    var region = mapLayer.options.region;
    if (region) {
      // Determine floor index from posZ
      var baseLayer = mappingLayers["" + region];
      var floorIdx = 0;
      if (baseLayer && baseLayer.options.overlap && mapLayer != baseLayer) {
        for (var i = 0; i < baseLayer.options.overlap.length; i++) {
          if (baseLayer.options.overlap[i] == mapLayer) {
            floorIdx = i + 1;
            break;
          }
        }
      }
      var layerKey = region + "_" + floorIdx;
      if (navmeshDungeonLayers[layerKey]) return navmeshDungeonLayers[layerKey];
      // Fallback: try floor 0
      if (navmeshDungeonLayers[region + "_0"]) return navmeshDungeonLayers[region + "_0"];
    }
    return null;
  };
  // Update navmesh overlay visibility
  var updateNavmeshOverlay = function () {
    // Remove current navmesh layer
    if (navmeshLayer && map.hasLayer(navmeshLayer)) {
      map.removeLayer(navmeshLayer);
      navmeshLayer = null;
    }
    if (!navmeshVisible) return;
    // Add appropriate navmesh layer
    var nmLayer = getNavmeshLayerForCurrent();
    if (nmLayer) {
      navmeshLayer = nmLayer;
      map.addLayer(navmeshLayer);
    }
  };
  // initialize UI controls
  var initControls = function () {
    // move back to the last pointer
    L.easyButton({
      states: [
        {
          icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 576" style="vertical-align:middle"><path fill="#5b5b5b" d="M444.52 3.52L28.74 195.42c-47.97 22.39-31.98 92.75 19.19 92.75h175.91v175.91c0 51.17 70.36 67.17 92.75 19.19l191.9-415.78c15.99-38.39-25.59-79.97-63.97-63.97z"/></svg>',
          title: "Go Back",
          onClick: function () {
            setView(coordGoBack);
          },
        },
      ],
    }).addTo(map);
    // Linkage Toolbox (Combined vertically)
    var linkageToolbox = L.control({ position: "topright" });
    linkageToolbox.onAdd = function () {
      var container = L.DomUtil.create("div", "leaflet-pm-toolbar leaflet-bar");

      // Helper to add buttons
      var addToolBtn = function (id, title, icon, onClick, hasActions = false) {
        var btnContainer = L.DomUtil.create("div", "button-container", container);
        var btn = L.DomUtil.create("a", "leaflet-buttons-control-button " + id, btnContainer);
        btn.id = id;
        btn.href = "#";
        btn.title = title;
        btn.innerHTML = '<i data-lucide="' + icon + '"></i>';

        if (hasActions) {
          var actionsDiv = L.DomUtil.create("div", "leaflet-pm-actions-container", btnContainer);
          var hideBtn = L.DomUtil.create("a", "leaflet-pm-action", actionsDiv);
          hideBtn.href = "#";
          hideBtn.textContent = "Hide " + title;

          btn.toggle = function (on) {
            if (on) L.DomUtil.addClass(btnContainer, "active");
            else L.DomUtil.removeClass(btnContainer, "active");
          };

          L.DomEvent.on(hideBtn, "click", function (e) {
            L.DomEvent.stop(e);
            onClick(false, btn);
          });
          L.DomEvent.on(btn, "click", function (e) {
            L.DomEvent.stop(e);
            onClick(true, btn);
          });
        } else {
          L.DomEvent.on(btn, "click", function (e) {
            L.DomEvent.stop(e);
            onClick(e, btn);
          });
        }
        return btn;
      };

      // 1. NavMesh
      var navmeshBtn = addToolBtn(
        "navmesh-btn",
        "NavMesh",
        "layers",
        function (on, btn) {
          navmeshVisible = on === true ? !navmeshVisible : on;
          updateNavmeshOverlay();
          btn.toggle(navmeshVisible);
        },
        true,
      );
      navmeshBtn.toggle(navmeshVisible);

      // 2. Download
      addToolBtn("linkage-dl-btn", "Download JSON", "download", function () {
        OpenSilkroadMap.ExportNavigationLinkage();
      });

      // 3. Refresh
      addToolBtn("linkage-refresh-btn", "Refresh from Bot", "refresh-cw", function () {
        OpenSilkroadMap.LoadLinkageFromBot();
      });

      // 4. Push
      addToolBtn("linkage-push-btn", "Push to Bot", "upload", function () {
        OpenSilkroadMap.PushNavigationLinkageToBot();
      });

      // 6. Native Architecture Toggle
      var nativeBtn = addToolBtn(
        "native-arch-btn",
        "Native Architecture",
        "map-pin",
        function (on, btn) {
          nativeVisible = on === true ? !nativeVisible : on;
          if (nativeVisible) {
            // Force redraw since markers might have been 'added' to the group while it was hidden
            nativeLayerGroup.clearLayers();
            for (var gid in nativeMarkers) {
              if (nativeMarkers[gid].layer == mapLayer) nativeMarkers[gid].marker.addTo(nativeLayerGroup);
            }
            for (var lid in nativeLines) {
              if (nativeLines[lid].layer == mapLayer) nativeLines[lid].line.addTo(nativeLayerGroup);
            }
            nativeLayerGroup.addTo(map);
          } else {
            map.removeLayer(nativeLayerGroup);
          }
          btn.toggle(nativeVisible);
        },
        true,
      );
      nativeBtn.toggle(nativeVisible);

      // 7. Center on Character
      addToolBtn("linkage-center-btn", "Center on Bot", "crosshair", function () {
        if (botPlayerMarker && botPlayerMarker.options.xMap) {
          setView(botPlayerMarker.options.xMap.coordinates);
        }
      });

      L.DomEvent.disableClickPropagation(container);
      return container;
    };
    linkageToolbox.addTo(map);

    // Process Lucide icons
    if (window.lucide) {
      lucide.createIcons();
    }

    // Auto-load once on start
    setTimeout(function () {
      var savedPoll = localStorage.getItem("pollGateway");
      if (savedPoll === null || savedPoll === "true") {
        OpenSilkroadMap.LoadLinkageFromBot();
      }
      FetchNativeGateways();
    }, 1000);

    // Coordinate viewer (bottom left)
    map.on("mousemove", function (e) {
      var coord = CoordMapToSRO(e.latlng);
      var rx = (coord.x / 10) % 192;
      if (rx < 0) rx += 192;
      var ry = (coord.y / 10) % 192;
      if (ry < 0) ry += 192;

      var text =
        "X: " +
        Math.round(coord.x / 10) +
        ", Y: " +
        Math.round(coord.y / 10) +
        " (Sect: " +
        Math.round(rx * 10) +
        "," +
        Math.round(ry * 10) +
        ") R: " +
        coord.region;
      $("#status-coords span").text(text);
    });

    // Console toggle (using delegation for reliability)
    $(document).on("click", "#toggle-console", function (e) {
      e.preventDefault();
      var $console = $("#live-console");
      var $chevron = $("#console-chevron");
      if ($console.hasClass("collapsed")) {
        $console.removeClass("collapsed");
        $chevron.attr("data-lucide", "chevron-up");
        lucide.createIcons();
      } else {
        $console.addClass("collapsed");
        $chevron.attr("data-lucide", "chevron-down");
        lucide.createIcons();
      }
    });

    $(document).on("click", "#close-console", function (e) {
      e.preventDefault();
      $("#live-console").addClass("collapsed");
      $("#console-chevron").attr("data-lucide", "chevron-up");
      lucide.createIcons();
    });
  };

  var PollBotStatus = function () {
    fetch("http://127.0.0.1:5588/status")
      .then((res) => {
        if (!res.ok) throw new Error("Connection Refused");
        return res.json();
      })
      .then((data) => {
        UpdateStatusUI(data);
        UpdateBotPlayerMarker(data.position);
        UpdateConsole(data.logs);

        // Notify if data version changed (e.g., bot healed a node)
        if (data.data_version && data.data_version > lastDataVersion) {
          if (lastDataVersion !== 0) {
            // Don't trigger LoadLinkage if it's the first poll
            console.log(
              "Navigation data updated by bot (Version: " + data.data_version + "). Use 'Load from Bot' to sync UI.",
            );
            // UI refresh was removed to prevent wiping active unsaved drawing work during navigation.
          }
          lastDataVersion = data.data_version;
        }

        if (data.navigation) {
          UpdateNavigationPath(data.navigation.path);
        }
      })
      .catch((err) => {
        // Disconnected
        console.error("Gateway Poll Error:", err);
        $("#status-gateway span").text("Disconnected");
        var $icon = $("#status-gateway [data-lucide]");
        $icon.css("color", "#ff4d4d").attr("data-lucide", "circle");
        if (window.lucide) window.lucide.createIcons();
      });
  };

  var UpdateStatusUI = function (data) {
    // Gateway active?
    var gatewayIcon = $("#status-gateway [data-lucide]");
    if (data.is_gateway_active) {
      $("#status-gateway span").text("Connected");
      gatewayIcon.css("color", "#00ff00");
      if (gatewayIcon.attr("data-lucide") !== "zap") {
        gatewayIcon.attr("data-lucide", "zap");
        if (window.lucide) window.lucide.createIcons();
      }
    } else {
      $("#status-gateway span").text("Inactive");
      gatewayIcon.css("color", "#ffaa00");
      if (gatewayIcon.attr("data-lucide") !== "zap-off") {
        gatewayIcon.attr("data-lucide", "zap-off");
        if (window.lucide) window.lucide.createIcons();
      }
    }

    // Logging?
    var on = data.is_logging;
    var logIcon = $("#status-logging [data-lucide]")[0];
    if (on) {
      $("#status-logging span").text("On").css("color", "#00beff");
      if (logIcon) L.DomUtil.addClass(logIcon, "lucide-spin");
    } else {
      $("#status-logging span").text("Off").css("color", "");
      if (logIcon) L.DomUtil.removeClass(logIcon, "lucide-spin");
    }

    // Navigation?
    var nav = data.navigation;
    var isPaused = data.is_nav_paused;

    // Update Control Buttons
    if (nav.is_active) {
      if (isPaused) {
        $("#btn-nav-resume").show();
        $("#btn-nav-stop").hide();
      } else {
        $("#btn-nav-resume").hide();
        $("#btn-nav-stop").show();
      }
    } else {
      $("#btn-nav-resume").hide();
      $("#btn-nav-stop").hide();
    }

    if (nav.error) {
      $("#status-nav span")
        .text("ERROR: " + nav.error)
        .css("color", "#ff4d4d");
      $("#status-nav i").css("color", "#ff4d4d");
    } else if (isPaused) {
      $("#status-nav span").text("Paused").css("color", "#ffaa00");
      $("#status-nav i").css("color", "#ffaa00");
    } else if (nav.is_active) {
      var progress = nav.remaining !== null ? " (" + nav.remaining + " rem.)" : "";
      var waypoint = nav.next_waypoint ? " -> " + nav.next_waypoint : "";
      $("#status-nav span")
        .text("Active" + waypoint + progress)
        .css("color", "#00beff");
      $("#status-nav i").css("color", "#00beff");
    } else {
      $("#status-nav span").text("Inactive").css("color", "");
      $("#status-nav i").css("color", "");
    }
  };

  var UpdateConsole = function (logs) {
    if (!logs || logs.length === 0) return;

    // Check if we have new logs
    // If the list was cleared or restarted on the bot side, reset index
    if (logs.length < lastProcessedLogIndex) {
      lastProcessedLogIndex = 0;
    }

    for (var i = lastProcessedLogIndex; i < logs.length; i++) {
      var log = logs[i];
      // Expecting format "[HH:MM:SS] Message"
      var parts = log.match(/^(\[[^\]]+\])\s*(.*)/);
      var message = parts ? parts[2] : log;
      var level = "info";

      if (message.toLowerCase().includes("error") || message.toLowerCase().includes("failed")) level = "error";
      else if (message.toLowerCase().includes("warn") || message.toLowerCase().includes("timeout")) level = "warn";

      AddLogToUI(level, log); // Use full string for bot logs as they include timestamp
    }
    lastProcessedLogIndex = logs.length;
  };

  /**
   * Public function to add raw logs to UI
   */
  var AddLogToUI = function (level, message) {
    var container = $("#console-logs");
    var atBottom = container[0].scrollHeight - container.scrollTop() <= container.outerHeight() + 20;

    var time = "";
    var displayMsg = message;

    // If message doesn't start with timestamp, add local one
    if (!message.startsWith("[")) {
      time = "[" + new Date().toLocaleTimeString([], { hour12: false }) + "] ";
    }

    var typeClass = "log-info";
    if (level === "warn") typeClass = "log-warn";
    else if (level === "error") typeClass = "log-error";

    var logDiv = $('<div class="console-log ' + typeClass + '"></div>');
    if (time) {
      logDiv.append($('<span class="timestamp"></span>').text(time));
    }

    // Highlight timestamp if it's already in the string
    var match = displayMsg.match(/^(\[[^\]]+\])\s*(.*)/);
    if (match) {
      logDiv.append($('<span class="timestamp"></span>').text(match[1] + " "));
      displayMsg = match[2];
    }

    var fullText = (time ? time : match ? match[1] + " " : "") + displayMsg;
    logDiv.data("raw-text", fullText);

    logDiv.append($('<span class="message"></span>').text(displayMsg));

    // Add Copy Button
    var $copyBtn = $('<button class="copy-log-btn" title="Copy Log"><i data-lucide="copy"></i></button>');
    $copyBtn.on("click", function () {
      toClipboard(fullText);
      var $icon = $(this).find("i");
      var originalIcon = $icon.attr("data-lucide");
      $icon.attr("data-lucide", "check");
      if (window.lucide) window.lucide.createIcons();
      setTimeout(function () {
        $icon.attr("data-lucide", originalIcon);
        if (window.lucide) window.lucide.createIcons();
      }, 1500);
    });
    logDiv.append($copyBtn);

    container.append(logDiv);

    // Auto-scroll
    if (atBottom) {
      container.scrollTop(container[0].scrollHeight);
    }

    // Limit log entries to 200
    var children = container.children();
    if (children.length > 200) {
      children.slice(0, children.length - 200).remove();
    }

    if (window.lucide) lucide.createIcons();
  };

  /**
   * Copy all console logs to clipboard
   */
  var CopyAllLogs = function () {
    var logs = [];
    $("#console-logs .console-log").each(function () {
      var text = $(this).data("raw-text");
      if (text) logs.push(text);
    });
    if (logs.length > 0) {
      toClipboard(logs.join("\n"));
      // Visual feedback on the header button
      var $btn = $(".console-header-btn");
      $btn.css("color", "#00ff00");
      setTimeout(function () {
        $btn.css("color", "");
      }, 1000);
    }
  };

  /**
   * Stop/Pause navigation
   */
  var StopNavigation = function () {
    fetch("http://127.0.0.1:5588/nav/stop").then(function () {
      PollBotStatus();
    });
  };

  /**
   * Resume navigation
   */
  var ResumeNavigation = function () {
    fetch("http://127.0.0.1:5588/nav/resume").then(function () {
      PollBotStatus();
    });
  };

  var UpdateBotPlayerMarker = function (pos) {
    if (!pos) return;
    var coord = fixCoords(pos.x, pos.y, pos.z, pos.region);
    var mapPos = CoordSROToMap(coord);
    var layer = getLayer(coord);

    if (!botPlayerMarker) {
      var botIcon = new L.Icon({
        iconUrl: iconHost + "mm_sign_otherplayer.png", // Use default player icon for now, or mm_sign_party if preferred
        iconSize: [12, 12],
        iconAnchor: [6, 6],
        popupAnchor: [0, -6],
        className: "bot-player-marker",
      });
      botPlayerMarker = L.marker(mapPos, {
        icon: botIcon,
        zIndexOffset: 1000,
        pane: "player",
      }).bindPopup("<b>RSBot Player</b>");
      if (layer == mapLayer) botPlayerMarker.addTo(map);
      botPlayerMarker.options.xMap = { layer: layer, coordinates: coord };
    } else {
      // Update position
      botPlayerMarker.setLatLng(mapPos);

      // Update orientation/popup if needed
      botPlayerMarker.options.xMap.coordinates = coord;

      // Layer switch
      if (botPlayerMarker.options.xMap.layer != layer) {
        if (botPlayerMarker.options.xMap.layer == mapLayer) map.removeLayer(botPlayerMarker);
        if (layer == mapLayer) botPlayerMarker.addTo(map);
        botPlayerMarker.options.xMap.layer = layer;
      }
    }

    // Follow player logic
    if ($("#follow-player-check").is(":checked") || !initialPanDone) {
      if (mapLayer != layer) {
        // If layer changed, set view will trigger mapLayer update and marker re-add
        setView(coord);
        lastPannedBotPos = L.latLng(mapPos);
        initialPanDone = true;
      } else {
        var currentMapPos = L.latLng(mapPos);
        if (!initialPanDone || !lastPannedBotPos || lastPannedBotPos.distanceTo(currentMapPos) > 0.01) {
          map.panTo(currentMapPos);
          lastPannedBotPos = currentMapPos;
          initialPanDone = true;
        }
      }
    }
  };
  var initEvents = function () {
    // Follow Player LocalStorage Integration
    $(function () {
      var savedFollow = localStorage.getItem("followPlayer");
      if (savedFollow !== null) {
        $("#follow-player-check").prop("checked", savedFollow === "true");
      }
      $("#follow-player-check").on("change", function () {
        localStorage.setItem("followPlayer", $(this).is(":checked"));
      });
    });

    // Poll Gateway LocalStorage Integration
    $(function () {
      var savedPoll = localStorage.getItem("pollGateway");
      if (savedPoll !== null) {
        $("#poll-gateway-check").prop("checked", savedPoll === "true");
      } else {
        $("#poll-gateway-check").prop("checked", true);
      }
      $("#poll-gateway-check").on("change", function () {
        var isChecked = $(this).is(":checked");
        localStorage.setItem("pollGateway", isChecked);
        if (isChecked) {
          OpenSilkroadMap.StartPolling();
        } else {
          OpenSilkroadMap.StopPolling();
        }
      });
    });

    // Keyboard Shortcuts
    $(document).on("keydown", function (e) {
      var key = e.key.toLowerCase();
      var isInput = $(e.target).is("input, textarea");

      if (isInput) return;

      if (key === "r") {
        OpenSilkroadMap.LoadLinkageFromBot();
        PollBotStatus();
      } else if (key === "q") {
        $("#native-arch-btn").click();
      } else if (key === "t") {
        $("#toggle-console").click();
      } else if (key === "b") {
        $("#toggle-sidebar").click();
      } else if (key === "c") {
        if (e.shiftKey) {
          var $check = $("#follow-player-check");
          $check.prop("checked", !$check.prop("checked"));
        } else {
          if (botPlayerMarker) {
            map.panTo(botPlayerMarker.getLatLng());
          }
        }
      }
    });

    var showCoordinatePopup = function (latlng) {
      var coord = CoordMapToSRO(latlng);
      var content =
        "[<b> X:" +
        coord.x +
        " , Y:" +
        coord.y +
        " , Z:" +
        coord.z +
        " , Region: " +
        coord.region +
        (coord.region <= 32767 ? " (" + (coord.region & 0xff) + "," + (coord.region >> 8) + ")" : "") +
        " </b>]";
      if (coord.region <= 32767) content = "(<b> PosX:" + coord.posX + " , PosY:" + coord.posY + " </b>)<br>" + content;

      // link shortcut
      var copyLink =
        '<a class="leaflet-popup-copy-button" title="Copy Link" href="#" onClick="OpenSilkroadMap.LinkToClipboard(' +
        coord.x +
        "," +
        coord.y +
        "," +
        coord.z +
        "," +
        coord.region +
        ')"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 576" style="vertical-align:middle"><path d="M320 448v40c0 13.255-10.745 24-24 24H24c-13.255 0-24-10.745-24-24V120c0-13.255 10.745-24 24-24h72v296c0 30.879 25.121 56 56 56h168zm0-344V0H152c-13.255 0-24 10.745-24 24v368c0 13.255 10.745 24 24 24h272c13.255 0 24-10.745 24-24V128H344c-13.2 0-24-10.8-24-24zm120.971-31.029L375.029 7.029A24 24 0 0 0 358.059 0H352v96h96v-6.059a24 24 0 0 0-7.029-16.97z"/></svg></a>';

      // navigate buttons
      var navBtn =
        '<button class="leaflet-popup-nav-button" onclick="OpenSilkroadMap.SendNavigationRequest({x:' +
        coord.x +
        ",y:" +
        coord.y +
        ",z:" +
        (coord.z || 0) +
        ",region:" +
        coord.region +
        '})">Navigate Here</button>';

      var directBtn =
        '<button class="leaflet-popup-nav-button direct-walk-btn" onclick="OpenSilkroadMap.SendNavigationRequest({x:' +
        coord.x +
        ",y:" +
        coord.y +
        ",z:" +
        (coord.z || 0) +
        ",region:" +
        coord.region +
        ',direct:true})">Direct Walk</button>';

      // show popup
      L.popup()
        .setLatLng(latlng)
        .setContent(
          copyLink + content + '<div style="margin-top:8px; display:flex; gap:5px">' + navBtn + directBtn + "</div>",
        )
        .openOn(map);
    };

    map.on("dblclick", function (e) {
      showCoordinatePopup(e.latlng);
    });

    map.on("contextmenu", function (e) {
      showCoordinatePopup(e.latlng);
    });
    // tracking all shapes created with toolbar at the current layer
    map.on("pm:create", function (e) {
      var shape = e.layer;
      shape["xMap"] = { layer: mapLayer, type: e.shape, id: shape._leaflet_id };
      // normalize
      if (e.shape == "Line") shape.xMap.type = "Polyline";

      if (linkageVisible) {
        if (shape.xMap.type == "Marker") {
          // Register as new node
          var coord = CoordMapToSRO(shape.getLatLng());
          var id = Math.floor(coord.x) + "_" + Math.floor(coord.y) + "_" + coord.region + "_" + Date.now();
          shape.nodeId = id;
          shape.nodeData = { x: coord.x, y: coord.y, region: coord.region, edited: true };
          nodeMarkers[id] = shape;

          shape.on("pm:dragend", function (e) {
            var m = e.target;
            var c = CoordMapToSRO(m.getLatLng());
            m.nodeData.x = c.x;
            m.nodeData.y = c.y;
            m.nodeData.edited = true;
            updateEdgesForNode(m.nodeId);
          });

          shape.bindPopup(
            "<b>New Node: " +
              id +
              '</b><br><div style="margin-top:5px"><button onclick="OpenSilkroadMap.SelectChain(\'' +
              id +
              "')\">Select Chain</button> " +
              "<button onclick=\"OpenSilkroadMap.SendNavigationRequest('" +
              id +
              "')\">Navigate</button></div>",
          );
        } else if (shape.xMap.type == "Polyline") {
          var rawLatlngs = shape.getLatLngs();
          // Fallback: Original auto-sectioning logic for new paths
          var latlngs = [];
          for (var i = 0; i < rawLatlngs.length - 1; i++) {
            var lp1 = rawLatlngs[i],
              lp2 = rawLatlngs[i + 1];
            latlngs.push(lp1);
            var c1 = CoordMapToSRO(lp1),
              c2 = CoordMapToSRO(lp2);
            var dist = Math.sqrt((c2.x - c1.x) ** 2 + (c2.y - c1.y) ** 2);
            if (dist > 50.0) {
              var num_chunks = Math.ceil(dist / 50.0);
              for (var j = 1; j < num_chunks; j++) {
                var ratio = j / num_chunks;
                latlngs.push(L.latLng(lp1.lat + (lp2.lat - lp1.lat) * ratio, lp1.lng + (lp2.lng - lp1.lng) * ratio));
              }
            }
          }
          if (rawLatlngs.length > 0) latlngs.push(rawLatlngs[rawLatlngs.length - 1]);

          var prevId = null,
            newNodes = [],
            newEdges = [];
          for (var i = 0; i < latlngs.length; i++) {
            var coord = CoordMapToSRO(latlngs[i]),
              id = null;
            for (var existId in nodeMarkers) {
              var existNode = nodeMarkers[existId].nodeData;
              if (
                existNode.region === coord.region &&
                Math.sqrt((existNode.x - coord.x) ** 2 + (existNode.y - coord.y) ** 2) < 10.0
              ) {
                id = existId;
                break;
              }
            }
            if (!id) {
              id = Math.floor(coord.x) + "_" + Math.floor(coord.y) + "_" + coord.region + "_" + (Date.now() + i);
              var circle = L.circleMarker(latlngs[i], {
                radius: 5,
                color: "#3388ff",
                fillColor: "#3388ff",
                fillOpacity: 1,
                weight: 1,
                pmIgnore: false,
              }).addTo(linkageLayerGroup);
              circle.nodeId = id;
              circle.nodeData = { x: coord.x, y: coord.y, region: coord.region, edited: true };
              nodeMarkers[id] = circle;
              circle.on("pm:dragend", function (e) {
                var m = e.target,
                  c = CoordMapToSRO(m.getLatLng());
                m.nodeData.x = c.x;
                m.nodeData.y = c.y;
                m.nodeData.edited = true;
                updateEdgesForNode(m.nodeId);
              });
              circle.bindPopup(
                "<b>Node: " +
                  id +
                  ' (New)</b><br><div style="margin-top:5px"><button onclick="OpenSilkroadMap.SelectChain(\'' +
                  id +
                  "')\">Select Chain</button> <button onclick=\"OpenSilkroadMap.SendNavigationRequest('" +
                  id +
                  "')\">Navigate</button></div>",
              );
              newNodes.push(id);
            }
            if (prevId && prevId !== id) {
              var edgeId = prevId + "__" + id;
              if (!edgeLines[edgeId] && !edgeLines[id + "__" + prevId]) {
                var line = L.polyline([nodeMarkers[prevId].getLatLng(), nodeMarkers[id].getLatLng()], {
                  color: "#3388ff",
                  weight: 2,
                  pmIgnore: true,
                }).addTo(linkageLayerGroup);
                line.edgeId = edgeId;
                line.edgeData = {
                  from: prevId,
                  to: id,
                  type: "walk",
                  npc: null,
                  dest: null,
                  steps: null,
                  edited: true,
                };
                edgeLines[edgeId] = line;
                updateLineStyle(line);
                newEdges.push(edgeId);
              }
            }
            prevId = id;
          }
          map.removeLayer(shape);
          return;
        }
      }

      addShapeEditListener(shape);
    });
    // remove
    map.on("pm:remove", function (f) {
      if (f.layer && f.layer.xMap && f.layer.xMap.id) {
        delete mappingShapes[f.layer.xMap.id];
      }
      if (f.layer && f.layer.nodeId) {
        removeNode(f.layer.nodeId);
      }
    });

    // Real-time distance update while drawing
    map.on("pm:drawstart", function (e) {
      var layer = e.workingLayer;
      if (layer) {
        layer.on("pm:vertexadded pm:change", function (v) {
          var pts = layer.getLatLngs();
          if (pts.length < 2) return;
          var dist = getDistance(pts[pts.length - 2], pts[pts.length - 1]);
          var isLong = dist > 100;
          var text = Math.round(dist * 10) / 10 + (isLong ? " (TOO LONG)" : "");
          layer.setStyle({ color: isLong ? "#ff4d4d" : "#3388ff" });
        });
      }
    });

    // Global Escape key listener to close any and all popovers
    $(window).on("keydown", function (e) {
      if (
        e.target &&
        (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT")
      ) {
        return;
      }

      if (e.key === "Escape") {
        // Cancel all Leaflet-Geoman utility states
        if (map && map.pm) {
          if (typeof map.pm.disableDraw === "function") map.pm.disableDraw();
          if (typeof map.pm.disableGlobalDragMode === "function") map.pm.disableGlobalDragMode();
          if (typeof map.pm.disableGlobalEditMode === "function") map.pm.disableGlobalEditMode();
          if (typeof map.pm.disableGlobalRemovalMode === "function") map.pm.disableGlobalRemovalMode();
        }

        // Close Leaflet popups
        if (map) map.closePopup();
        // Close any Bootstrap modals
        if (window.$ && $(".modal").length) $(".modal").modal("hide");
      } else if (e.key === "a" || e.key === "A") {
        if (map && map.pm) map.pm.enableDraw("Line");
      } else if (e.key === "s" || e.key === "S") {
        if (map && map.pm && map.pm.Draw && map.pm.Draw.Line && map.pm.Draw.Line._finishShape) {
          map.pm.Draw.Line._finishShape();
        }
      } else if (e.key === "d" || e.key === "D") {
        if (map && map.pm && map.pm.Draw && map.pm.Draw.Line && map.pm.Draw.Line._removeLastVertex) {
          map.pm.Draw.Line._removeLastVertex();
        }
      } else if (e.key === "w" || e.key === "W") {
        if (map && map.pm) map.pm.toggleGlobalDragMode();
      } else if (e.key === "e" || e.key === "E") {
        if (map && map.pm) map.pm.toggleGlobalRemovalMode();
      } else if (e.key === "u" || e.key === "U") {
        OpenSilkroadMap.PushNavigationLinkageToBot(true);
      }
    });
  };
  var setInitialView = function (coord) {
    var GET = function (parameter) {
      var items = location.search.substr(1).split("&");
      for (var i = 0; i < items.length; i++) {
        var tmp = items[i].split("=");
        if (tmp[0] === parameter) return decodeURIComponent(tmp[1]);
      }
      return null;
    };
    // Reading GET's from coordinates link
    var x = parseFloat(GET("x"));
    var y = parseFloat(GET("y"));
    // filter
    if (!isNaN(x) && !isNaN(y)) {
      var z = parseFloat(GET("z"));
      var r = parseFloat(GET("region"));
      if (!isNaN(z) && !isNaN(r)) setView(fixCoords(x, y, z, r));
      else setView(fixCoords(x, y));
    } else {
      // Parameters not found, set predefined view
      setView(coord);
    }

    // Explicitly trigger navmesh application at startup
    updateNavmeshOverlay();
  };
  // Set the map layer
  var setMapLayer = function (tileLayer) {
    // Do nothing
    if (tileLayer == null) return;
    // Different from current layer?
    if (mapLayer != tileLayer) {
      // Clear map
      map.eachLayer(function (layer) {
        map.removeLayer(layer);
      });
      // Set the new layer
      mapLayer = tileLayer;
      map.addLayer(mapLayer);

      // re-add navmesh overlay if enabled
      updateNavmeshOverlay();

      // re-add linkage if enabled
      if (linkageVisible) linkageLayerGroup.addTo(map);

      // re-add active navigation path if it exists
      if (activePathLayerGroup.getLayers().length > 0) {
        activePathLayerGroup.addTo(map);
      }

      // Restore native gateways for current layer
      if (nativeVisible) {
        nativeLayerGroup.clearLayers();
        for (var gid in nativeMarkers) {
          if (nativeMarkers[gid].layer == mapLayer) {
            nativeMarkers[gid].marker.addTo(nativeLayerGroup);
          }
        }
        for (var lid in nativeLines) {
          if (nativeLines[lid].layer == mapLayer) {
            nativeLines[lid].line.addTo(nativeLayerGroup);
          }
        }
        nativeLayerGroup.addTo(map);
      }

      // init highlight
      lastMarkerSelected = null;
      // Add markers from the new layer
      for (var type in mappingMarkers) {
        for (var id in mappingMarkers[type]) {
          var marker = mappingMarkers[type][id];
          if (marker.options.xMap.layer == mapLayer) {
            marker.addTo(map);
          }
        }
      }
      // Add shape layers
      for (var id in mappingShapes) {
        var shape = mappingShapes[id];
        if (shape.xMap.layer == mapLayer) {
          shape.addTo(map);
        }
      }
    }
  };
  // Return the layer from the specified silkroad coordinate
  var getLayer = function (coord) {
    if (coord.region > 32767) {
      var layer = mappingLayers["" + coord.region];
      if (layer) {
        // check if has overlap at same region
        if (layer.options.overlap) {
          var layers = layer.options.overlap;
          // check the Z position
          for (var i = 0; i < layers.length; i++) {
            if (coord.z < layers[i].options.posZ) break;
            layer = layers[i];
          }
        } else {
          layer.options["posZ"] = 0;
        }
        // add/override layer region
        layer.options["region"] = coord.region;
      }
      return layer;
    }
    return mappingLayers[""];
  };
  // Set the view using a silkroad coord
  var setView = function (coord) {
    // track navigation
    coordGoBack = coord;
    // update layer
    setMapLayer(getLayer(coord));
    // center view
    map.panTo(CoordSROToMap(coord), 8);
  };
  var flyView = function (coord) {
    // track navigation
    coordGoBack = coord;
    // update layer
    setMapLayer(getLayer(coord));
    // center view
    map.flyTo(CoordSROToMap(coord), 8, { duration: 2.5 });
  };
  // Fix coordinates, return internal silkroad coords
  var fixCoords = function (x, y, z, region) {
    // Fix negative region
    if (region < 0) region += 65536;
    // Check coord type
    if (region == null) {
      // using x,y as game coords
      return CoordsGameToSRO({ posX: x, posY: y });
    }
    // using x,y,z,region internal silkroad coords
    return { x: x, y: y, z: z, region: region };
  };
  // Copy text to clipboard
  var toClipboard = function (text) {
    var e = document.createElement("textarea");
    e.value = text;
    document.body.appendChild(e);
    e.select();
    document.execCommand("copy");
    document.body.removeChild(e);
  };
  var addShapeEditListener = function (shape) {
    // create register
    mappingShapes[shape.xMap.id] = shape;

    // add popup to marker types only
    if (shape.xMap.type == "Marker") {
      shape.on("click", function (e) {
        // add game coords
        var coord = CoordMapToSRO(e.latlng);
        var content =
          "[<b> X:" + coord.x + " , Y:" + coord.y + " , Z:" + coord.z + " , Region: " + coord.region + " </b>]";
        if (coord.region <= 32767)
          content =
            "(<b> PosX:" + Math.round(coord.posX) + " , PosY:" + Math.round(coord.posY) + " </b>)<br>" + content;
        // add leaflet ID to check differences quickly
        content =
          (shape.xMap.desc ? shape.xMap.desc : "<b>&lt; Marker ID:" + shape.xMap.id + " &gt;</b>") + "<br>" + content;
        L.popup().setLatLng(e.latlng).setContent(content).openOn(map);
      });
    } else if (shape.xMap.type == "Polygon" || shape.xMap.type == "Polyline") {
      if (shape.xMap.desc) {
        shape.on("click", function (e) {
          L.popup().setLatLng(e.latlng).setContent(shape.xMap.desc).openOn(map);
        });
      }
    }

    // edit
    shape.on("pm:edit", function (f) {
      mappingShapes[f.target.xMap.id] = f.target;
    });

    // polyline/polygons
    shape.on("pm:vertexremoved", function (f) {
      if (f.target._latlngs.length == 0) delete mappingShapes[f.target.xMap.id];
    });
  };
  return {
    // Initialize silkroad world map
    init: function (id, x = 114, y = 47.25, z = null, region = null) {
      // init stuffs
      initLayers(id);
      initControls();
      initEvents();
      window.onload = setInitialView(fixCoords(x, y, z, region));

      // Bot Status Polling
      if (botStatusInterval) clearInterval(botStatusInterval);
      var savedPoll = localStorage.getItem("pollGateway");
      if (savedPoll === null || savedPoll === "true") {
        botStatusInterval = setInterval(PollBotStatus, 2000);
      } else {
        console.log("Gateway polling disabled on startup.");
      }
    },
    SetZoomLimit: function (minZoom, maxZoom) {
      // Check min max values
      if (minZoom < 0) minZoom = 0;
      if (maxZoom > 9) maxZoom = 9;
      // Check wrong values
      if (minZoom > maxZoom) {
        var temp = minZoom;
        minZoom = maxZoom;
        maxZoom = temp;
      }
      map.options.minZoom = minZoom;
      map.options.maxZoom = maxZoom;
    },
    // Set the view quickly
    SetView: function (x, y, z = null, region = null) {
      // Remove highlight if exists
      if (lastMarkerSelected) {
        L.DomUtil.removeClass(lastMarkerSelected._icon, "leaflet-marker-selected");
        lastMarkerSelected = null;
      }
      // view
      setView(fixCoords(x, y, z, region));
    },
    // Set the view flying
    FlyView: function (x, y, z = null, region = null) {
      // Remove highlight if exists
      if (lastMarkerSelected) {
        L.DomUtil.removeClass(lastMarkerSelected._icon, "leaflet-marker-selected");
        lastMarkerSelected = null;
      }
      // view
      flyView(fixCoords(x, y, z, region));
    },
    AddNPC(id, html, x, y, z = null, region = null) {
      // Add only new ones
      if (!mappingMarkers["npc"][id]) {
        var coord = fixCoords(x, y, z, region);
        // create dimensions
        var iconNPC = new L.Icon({
          iconUrl: iconHost + "mm_sign_npc.png",
          iconSize: [6, 6], // (w,h)
          iconAnchor: [3, 3], // (w/2,h/2)
          popupAnchor: [0, -3], // (0,-h/2)
        });
        // create marker virtualized
        var marker = L.marker(CoordSROToMap(coord), { icon: iconNPC, pmIgnore: true, virtual: true }).bindPopup(html);
        // Check if is from the current layer
        var layer = getLayer(coord);
        if (layer == mapLayer) marker.addTo(map);
        marker.options["xMap"] = { layer: layer, coordinates: coord };
        // keep register to not get lost on changing layers
        mappingMarkers["npc"][id] = marker;
      }
    },
    GoToNPC(id) {
      var marker = mappingMarkers["npc"][id];
      // check if exists and has a valid layer
      if (marker && marker.options.xMap.layer) {
        setView(marker.options.xMap.coordinates);
        // Add/remove highlight
        if (lastMarkerSelected) {
          // reset
          lastMarkerSelected._icon.style.zIndex = lastMarkerSelected._icon._leaflet_pos.y;
          L.DomUtil.removeClass(lastMarkerSelected._icon, "leaflet-marker-selected");
        }
        lastMarkerSelected = marker;
        marker._icon.style.zIndex = Object.keys(mappingMarkers["npc"]).length;
        L.DomUtil.addClass(marker._icon, "leaflet-marker-selected");
        return true;
      }
      return false;
    },
    AddTeleport(html, type, x, y, z = null, region = null) {
      var coord = fixCoords(x, y, z, region);
      // create icon
      var iconNPC;
      switch (type) {
        case 1: // fortress
          iconNPC = new L.Icon({
            iconUrl: iconHost + "fort_worldmap.png",
            iconSize: [23, 45],
            iconAnchor: [12, 17],
            popupAnchor: [0, -17],
          });
          break;
        case 2: // gate of ress
          iconNPC = new L.Icon({
            iconUrl: iconHost + "strut_revival_gate.png",
            iconSize: [24, 24],
            iconAnchor: [12, 12],
            popupAnchor: [0, -12],
          });
          break;
        case 3: // gate of glory
          iconNPC = new L.Icon({
            iconUrl: iconHost + "strut_glory_gate.png",
            iconSize: [24, 24],
            iconAnchor: [12, 12],
            popupAnchor: [0, -12],
          });
          break;
        case 4: // fortress small
          iconNPC = new L.Icon({
            iconUrl: iconHost + "fort_small_worldmap.png",
            iconSize: [20, 31],
            iconAnchor: [10, 15],
            popupAnchor: [0, -15],
          });
          break;
        case 5: // ground teleport
          iconNPC = new L.Icon({
            iconUrl: iconHost + "map_world_icontel.png",
            iconSize: [22, 23],
            iconAnchor: [11, 12],
            popupAnchor: [0, -12],
          });
          break;
        case 6: // tahomet
          iconNPC = new L.Icon({
            iconUrl: iconHost + "tahomet_gate.png",
            iconSize: [26, 28],
            iconAnchor: [13, 14],
            popupAnchor: [0, -14],
          });
          break;
        case 0: // gate
        default:
          iconNPC = new L.Icon({
            iconUrl: iconHost + "xy_gate.png",
            iconSize: [24, 24],
            iconAnchor: [12, 12],
            popupAnchor: [0, -12],
          });
          break;
      }
      // create marker virtualized
      var marker = L.marker(CoordSROToMap(coord), { icon: iconNPC, pmIgnore: true, virtual: true }).bindPopup(html);
      // Check if is from the current layer
      var layer = getLayer(coord);
      if (layer == mapLayer) marker.addTo(map);
      marker.options["xMap"] = { layer: layer, coordinates: coord };
      // keep register to not get lost on changing layers
      var id = Object.keys(mappingMarkers["tp"]).length;
      mappingMarkers["tp"][id] = marker;
    },
    AddPlayer(id, html, x, y, z = null, region = null) {
      // Add only new ones
      if (!mappingMarkers["player"][id]) {
        var coord = fixCoords(x, y, z, region);
        // create dimensions
        var iconNPC = new L.Icon({
          iconUrl: iconHost + "mm_sign_otherplayer.png",
          iconSize: [6, 6],
          iconAnchor: [3, 3],
          popupAnchor: [0, -3],
        });
        // create marker virtualized
        var marker = L.marker(CoordSROToMap(coord), {
          icon: iconNPC,
          pmIgnore: true,
          virtual: true,
          pane: "player",
        }).bindPopup(html);
        // Check if is from the current layer
        var layer = getLayer(coord);
        if (layer == mapLayer) marker.addTo(map);
        marker.options["xMap"] = { layer: layer, coordinates: coord };
        // keep register to not get lost on changing layers
        mappingMarkers["player"][id] = marker;
      }
    },
    MovePlayer(id, x, y, z = null, region = null) {
      var marker = mappingMarkers["player"][id];
      // check if exists and has a valid layer
      if (marker && marker.options.xMap.layer) {
        // update the position
        marker.options.xMap.coord = fixCoords(x, y, z, region);
        marker.setLatLng(CoordSROToMap(marker.options.xMap.coord));
        // check if there is a layer change
        var newLayer = getLayer(marker.options.xMap.coord);
        if (marker.options.xMap.layer != newLayer) {
          // add it to the current layer
          if (newLayer == mapLayer) {
            marker.addTo(map);
          }
          // remove it from the current layer
          else if (marker.options.xMap.layer == mapLayer) {
            map.eachLayer(function (layer) {
              if (layer == marker) map.removeLayer(layer);
            });
          }
          // update layer
          marker.options.xMap.layer = newLayer;
        }
      }
    },
    GoToPlayer(id) {
      var marker = mappingMarkers["player"][id];
      // check if exists and has a valid layer
      if (marker && marker.options.xMap.layer) {
        setView(marker.options.xMap.coordinates);
        // Add/remove highlight
        if (lastMarkerSelected) {
          // reset
          lastMarkerSelected._icon.style.zIndex = lastMarkerSelected._icon._leaflet_pos.y;
          L.DomUtil.removeClass(lastMarkerSelected._icon, "leaflet-marker-selected");
        }
        lastMarkerSelected = marker;
        marker._icon.style.zIndex = Object.keys(mappingMarkers["player"]).length;
        L.DomUtil.addClass(marker._icon, "leaflet-marker-selected");
        return true;
      }
      return false;
    },
    RemovePlayer(id) {
      var marker = mappingMarkers["player"][id];
      if (marker && marker.options.xMap.layer) {
        // delete from the current layer
        if (marker.options.xMap.layer == mapLayer) {
          // Goes through every object and remove it
          map.eachLayer(function (layer) {
            if (layer == marker) map.removeLayer(layer);
          });
        }
        // delete from register
        delete mappingMarkers["player"][id];
      }
    },
    AddLocation(id, html, x, y, z = null, region = null) {
      // Add only new ones
      if (!mappingMarkers["location"][id]) {
        var coord = fixCoords(x, y, z, region);
        // create dimensions
        var icon = new L.Icon({
          iconUrl: iconHost + "wmap_sign_location.gif",
          iconSize: [36, 36],
          iconAnchor: [18, 24],
          popupAnchor: [-1, -16],
        });
        // create marker virtualized
        var marker = L.marker(CoordSROToMap(coord), { icon: icon, pmIgnore: true, virtual: true });
        // Add html popup
        if (html !== "") marker = marker.bindPopup(html);
        // Check if is from the current layer
        var layer = getLayer(coord);
        if (layer == mapLayer) marker.addTo(map);
        marker.options["xMap"] = { layer: layer, coordinates: coord };
        // keep register to not get lost on changing layers
        mappingMarkers["location"][id] = marker;
      }
    },
    RemoveLocation(id) {
      var marker = mappingMarkers["location"][id];
      if (marker && marker.options.xMap.layer) {
        // delete from the current layer
        if (marker.options.xMap.layer == mapLayer) {
          map.removeLayer(marker);
        }
        // delete from register
        delete mappingMarkers["location"][id];
      }
    },
    AddNavigationLinkage(data, autoPan = true) {
      if (!data || !data.nodes) return;

      linkageVisible = true;
      if (!map.hasLayer(linkageLayerGroup)) linkageLayerGroup.addTo(map);

      // Sync Nodes
      var nodePoints = {};
      var newNodeIds = Object.keys(data.nodes);

      // Remove nodes that no longer exist
      for (var id in nodeMarkers) {
        if (!data.nodes[id]) {
          linkageLayerGroup.removeLayer(nodeMarkers[id]);
          delete nodeMarkers[id];
        }
      }

      for (var id in data.nodes) {
        var node = data.nodes[id];
        node.region = parseInt(node.region); // Ensure integer
        var latlng = CoordSROToMap(node);
        nodePoints[id] = latlng;

        var existingMarker = nodeMarkers[id];
        if (existingMarker) {
          existingMarker.setLatLng(latlng);
          existingMarker.nodeData = node;
          updateNodeStyle(existingMarker);
          continue;
        }

        var nodeColor = node.edited ? "#af4dff" : "#3388ff";
        var circle = L.circleMarker(latlng, {
          pane: "linkageNodes",
          radius: 5,
          color: nodeColor,
          fillColor: nodeColor,
          fillOpacity: 1,
          weight: 1,
          pmIgnore: false,
        }).bindPopup("<b>Node: " + id + "</b><br>X: " + node.x + " Y: " + node.y + "<br>Region: " + node.region);

        circle.nodeId = id;
        circle.nodeData = node;
        nodeMarkers[id] = circle;

        // Add move handlers
        circle.on("pm:dragstart", function (e) {
          var marker = e.target;
          marker._startPos = marker.getLatLng();
        });

        circle.on("pm:drag", function (e) {
          var marker = e.target;
          if (selectedChainNodes.indexOf(marker.nodeId) !== -1) {
            var currentPos = marker.getLatLng();
            var deltaLat = currentPos.lat - marker._startPos.lat;
            var deltaLng = currentPos.lng - marker._startPos.lng;

            for (var i = 0; i < selectedChainNodes.length; i++) {
              var otherId = selectedChainNodes[i];
              if (otherId === marker.nodeId) continue;
              var otherMarker = nodeMarkers[otherId];
              if (otherMarker) {
                var oldLatLng = otherMarker.getLatLng();
                otherMarker.setLatLng([oldLatLng.lat + deltaLat, oldLatLng.lng + deltaLng]);
                updateEdgesForNode(otherId);
              }
            }
            marker._startPos = currentPos;
          }
          updateEdgesForNode(marker.nodeId);
        });

        circle.on("pm:dragend", function (e) {
          var marker = e.target;
          var nodesToUpdate =
            selectedChainNodes.length > 0 && selectedChainNodes.indexOf(marker.nodeId) !== -1
              ? selectedChainNodes
              : [marker.nodeId];

          for (var i = 0; i < nodesToUpdate.length; i++) {
            var id = nodesToUpdate[i];
            var m = nodeMarkers[id];
            var nodeCoord = CoordMapToSRO(m.getLatLng());
            m.nodeData.x = nodeCoord.x;
            m.nodeData.y = nodeCoord.y;
            m.nodeData.z = 0;
            m.nodeData.edited = true;

            updateEdgesForNode(id);

            var status = m.nodeData.edited ? " (Edited)" : "";
            m.setPopupContent(
              "<b>Node: " +
                id +
                status +
                "</b><br>X: " +
                m.nodeData.x +
                " Y: " +
                m.nodeData.y +
                " Z: " +
                m.nodeData.z +
                "<br>Region: " +
                m.nodeData.region +
                "<br><button onclick=\"OpenSilkroadMap.SelectChain('" +
                id +
                "')\">Select Chain</button> <button onclick=\"OpenSilkroadMap.SendNavigationRequest('" +
                id +
                "')\">Navigate</button>",
            );
            updateNodeStyle(marker);
          }
        });

        circle.setPopupContent(
          "<b>Node: " +
            id +
            "</b><br>X: " +
            node.x +
            " Y: " +
            node.y +
            "<br>Region: " +
            node.region +
            "<br><button onclick=\"OpenSilkroadMap.SelectChain('" +
            id +
            "')\">Select Chain</button> <button onclick=\"OpenSilkroadMap.SendNavigationRequest('" +
            id +
            "')\">Navigate</button>",
        );

        linkageLayerGroup.addLayer(circle);
      }

      // Sync Edges
      if (data.edges) {
        // Remove edges that no longer exist
        for (var id in edgeLines) {
          if (!data.edges[id]) {
            linkageLayerGroup.removeLayer(edgeLines[id]);
            delete edgeLines[id];
          }
        }

        for (var id in data.edges) {
          var edge = data.edges[id];
          var fromPoint = nodePoints[edge.from];
          var toPoint = nodePoints[edge.to];
          if (fromPoint && toPoint) {
            var existingLine = edgeLines[id];
            if (existingLine) {
              existingLine.setLatLngs([fromPoint, toPoint]);
              existingLine.edgeData = edge;
              updateLineStyle(existingLine);
              continue;
            }

            var edgeColor = edge.edited ? "#af4dff" : "#3388ff";
            var line = L.polyline([fromPoint, toPoint], {
              pane: "linkageEdges",
              color: edgeColor,
              pmIgnore: true,
            }).addTo(linkageLayerGroup);
            line.edgeId = id;
            line.edgeData = edge;
            edgeLines[id] = line;
            updateLineStyle(line);
          }
        }
      }

      currentLinkageData = data;

      var firstNodeId = Object.keys(data.nodes)[0];
      if (firstNodeId && autoPan) {
        var firstNode = data.nodes[firstNodeId];
        this.SetView(firstNode.x, firstNode.y, firstNode.z, firstNode.region);
      }
    },
    _getPreparedLinkageData() {
      if (!currentLinkageData) return null;

      var exportedNodes = {};
      var exportedEdges = {};
      var idMap = {};

      for (var oldId in nodeMarkers) {
        var marker = nodeMarkers[oldId];
        var latlng = marker.getLatLng();
        var localCoord = CoordMapToSRO(latlng);

        // Standardize data to global floats
        var x = localCoord.x;
        var y = localCoord.y;
        var region = parseInt(localCoord.region);

        // Generate new semantic ID: globalX_globalY_region
        // Preserve timestamp suffix if present
        var suffix = "";
        var idParts = oldId.split("_");
        if (idParts.length > 4) {
          suffix = "_" + idParts[idParts.length - 1];
        }

        var newId = Math.floor(x) + "_" + Math.floor(y) + "_" + region + suffix;

        // Handle collisions (unlikely but possible with flooring)
        var collisionCount = 0;
        while (exportedNodes[newId]) {
          collisionCount++;
          newId = Math.floor(x) + "_" + Math.floor(y) + "_" + region + "_" + collisionCount + suffix;
        }

        idMap[oldId] = newId;

        exportedNodes[newId] = {
          x: x,
          y: y,
          region: region,
        };
        if (marker.nodeData.edited) exportedNodes[newId].edited = true;
      }

      for (var oldEdgeId in edgeLines) {
        var line = edgeLines[oldEdgeId];
        var edge = line.edgeData;
        var newFrom = idMap[edge.from];
        var newTo = idMap[edge.to];

        if (!newFrom || !newTo) continue;

        var newEdgeId = newFrom + "__" + newTo;
        exportedEdges[newEdgeId] = {
          from: newFrom,
          to: newTo,
          type: edge.type,
          npc: edge.npc !== undefined ? edge.npc : null,
          dest: edge.dest !== undefined ? edge.dest : null,
          steps: edge.steps !== undefined ? edge.steps : null,
        };
        if (edge.edited) exportedEdges[newEdgeId].edited = true;
      }

      return {
        nodes: exportedNodes,
        edges: exportedEdges,
      };
    },
    ExportNavigationLinkage() {
      var finalData = this._getPreparedLinkageData();
      if (!finalData) return;

      // Download
      var json = JSON.stringify(finalData, null, 4);
      var blob = new Blob([json], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.getElementById("download-link");
      a.href = url;
      a.download = "navigation_linkage_edited.json";
      a.click();
      URL.revokeObjectURL(url);
    },
    PushNavigationLinkageToBot(skipConfirm = false) {
      var self = this;
      var finalData = self._getPreparedLinkageData();
      if (!finalData) {
        Swal.fire({
          icon: "warning",
          title: "No Data",
          text: "No linkage data to push.",
          timer: 2000,
          showConfirmButton: false,
          position: "bottom-end",
          toast: true,
        });
        return;
      }

      var doPush = function () {
        console.log("Pushing navigation data to bot gateway...");
        var url = "http://127.0.0.1:5588/data";

        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(finalData),
        })
          .then(function (res) {
            if (!res.ok) throw new Error("HTTP error " + res.status);
            return res.json();
          })
          .then(function (resData) {
            console.log("Navigation data pushed successfully:", resData);
            Swal.fire({
              icon: "success",
              title: "Pushed",
              text: resData.message || "Navigation data pushed to bot.",
              timer: 2000,
              showConfirmButton: false,
              position: "bottom-end",
              toast: true,
            });
            OpenSilkroadMap.LoadLinkageFromBot();
          })
          .catch(function (err) {
            console.error("Failed to push data to bot gateway:", err);
            Swal.fire({
              icon: "error",
              title: "Push Failed",
              text: err.message,
              position: "bottom-end",
              toast: true,
              timer: 3000,
              showConfirmButton: false,
            });
          });
      };

      if (skipConfirm) {
        doPush();
      } else {
        Swal.fire({
          title: "Push to Bot?",
          text: "This will overwrite the bot's current navigation_linkage.json file.",
          icon: "question",
          showCancelButton: true,
          confirmButtonText: "Push",
          cancelButtonText: "Cancel",
          position: "bottom-end",
        }).then(function (result) {
          if (result.isConfirmed) doPush();
        });
      }
    },
    SelectChain(startNodeId) {
      // Clear previous selection highlight
      for (var i = 0; i < selectedChainNodes.length; i++) {
        var m = nodeMarkers[selectedChainNodes[i]];
        if (m) m.setStyle({ color: "#3388ff", fillColor: "#3388ff" });
      }

      selectedChainNodes = [];
      var queue = [startNodeId];
      var visited = {};
      visited[startNodeId] = true;

      while (queue.length > 0) {
        var nodeId = queue.shift();
        selectedChainNodes.push(nodeId);

        // Find all connected nodes via 'walk' edges
        for (var edgeId in edgeLines) {
          var edge = edgeLines[edgeId].edgeData;
          if (edge.type === "walk") {
            var neighbor = null;
            if (edge.from === nodeId) neighbor = edge.to;
            else if (edge.to === nodeId) neighbor = edge.from;

            if (neighbor && !visited[neighbor]) {
              visited[neighbor] = true;
              queue.push(neighbor);
            }
          }
        }
      }

      // Highlight selection
      for (var i = 0; i < selectedChainNodes.length; i++) {
        var m = nodeMarkers[selectedChainNodes[i]];
        if (m) m.setStyle({ color: "#ffcc00", fillColor: "#ffcc00" });
      }

      console.log("Selected chain nodes:", selectedChainNodes);
    },
    RegisterNewNode(id, nodeData) {
      // Helper to add a manually created node to the linkage
      if (!currentLinkageData) currentLinkageData = { nodes: {}, edges: {} };
      currentLinkageData.nodes[id] = nodeData;
      // This would be called when a new marker is drawn
    },
    ClearNavigationLinkage() {
      linkageVisible = false;
      linkageLayerGroup.clearLayers();
      map.removeLayer(linkageLayerGroup);
    },
    LinkToClipboard(x, y, z = null, region = null) {
      var coord = fixCoords(x, y, z, region);
      toClipboard(
        window.location.href.split(/\?|#/)[0] +
          "?x=" +
          coord.x +
          "&y=" +
          coord.y +
          "&z=" +
          coord.z +
          "&region=" +
          coord.region,
      );
    },
    // Toolbar for drawing and editing geometry shapes
    ShowDrawingToolbar(
      position,
      drawMarker,
      drawCircleMarker,
      drawPolyline,
      drawRectangle,
      drawPolygon,
      drawCircle,
      canEdit,
      canDrag,
      canCut,
      canDelete,
    ) {
      map.pm.addControls({
        position: position,
        drawMarker: drawMarker,
        drawCircleMarker: drawCircleMarker,
        drawPolyline: drawPolyline,
        drawRectangle: drawRectangle,
        drawPolygon: drawPolygon,
        drawCircle: drawCircle,
        editMode: canEdit,
        dragMode: canDrag,
        cutPolygon: canCut,
        removalMode: canDelete,
      });
    },
    HideDrawingToolbar() {
      var f = false;
      map.pm.addControls({
        drawMarker: f,
        drawCircleMarker: f,
        drawPolyline: f,
        drawRectangle: f,
        drawPolygon: f,
        drawCircle: f,
        editMode: f,
        dragMode: f,
        cutPolygon: f,
        removalMode: f,
      });
    },
    AddDrawingShape(type, param1, param2 = null) {
      var shape;
      switch (type) {
        case "Marker":
          var coord = fixCoords(param1[0], param1[1], param1[2], param1[3]);

          shape = L.marker(CoordSROToMap(coord), { virtual: true });
          shape["xMap"] = { layer: getLayer(coord) };
          // Add shape description
          if (param2 != null) shape["xMap"]["desc"] = param2;
          break;
        case "Polyline":
        case "Polygon":
          var latlngs = [];
          for (var i = 0; i < param1.length; i++)
            latlngs.push(CoordSROToMap(fixCoords(param1[i][0], param1[i][1], param1[i][2], param1[i][3])));
          shape = type == "Polyline" ? L.polyline(latlngs, { virtual: true }) : L.polygon(latlngs, { virtual: true });
          shape["xMap"] = { layer: getLayer(fixCoords(param1[0][0], param1[0][1], param1[0][2], param1[0][3])) };
          // Add shape description
          if (param2 != null) shape["xMap"]["desc"] = param2;
          break;
        case "Circle":
          var coord = fixCoords(param1[0], param1[1], param1[2], param1[3]);

          shape = L.circle(CoordSROToMap(coord), param2 / 192, { virtual: true });
          shape["xMap"] = { layer: getLayer(coord) };
          break;
        default:
          return;
      }
      shape.xMap["type"] = type;
      shape.xMap["id"] = new Date().getUTCMilliseconds();
      mappingShapes[shape.xMap.id] = shape;

      // add
      if (shape.xMap.layer == mapLayer) shape.addTo(map);

      addShapeEditListener(shape);
    },
    // Returns the all shapes from the current map layer
    GetDrawingShapes() {
      var shapes = [];
      for (var id in mappingShapes) {
        var shape = mappingShapes[id];
        if (shape.xMap.layer == mapLayer) shapes.push(shape);
      }
      return shapes;
    },
    ConvertLatLngToCoords(latlng) {
      return CoordMapToSRO(latlng);
    },
    ClearDrawingShapes() {
      // Remove one by one
      for (var id in mappingShapes) {
        var shape = mappingShapes[id];
        if (shape.xMap.layer == mapLayer) {
          map.eachLayer(function (layer) {
            if (layer == shape) map.removeLayer(layer);
          });
        }
      }
      mappingShapes = {};
    },
    UpdateEdgesForNode(nodeId) {
      updateEdgesForNode(nodeId);
    },
    SendNavigationRequest(param) {
      console.log("Sending navigation request:", param);
      var url = "http://127.0.0.1:5588/navigate";

      if (typeof param === "object") {
        url += "?x=" + param.x + "&y=" + param.y + "&z=" + param.z + "&region=" + param.region;
        if (param.direct) url += "&direct=true";
      } else {
        url += "?id=" + encodeURIComponent(param);
      }

      // Use a shorter timeout for navigation requests
      var controller = new AbortController();
      var signal = controller.signal;
      setTimeout(() => controller.abort(), 2000);

      fetch(url, { mode: "no-cors", signal: signal })
        .then(() => {
          console.log("Navigation command sent to bot.");
          // Refresh the graph data so we see the new bridge nodes
          setTimeout(() => this.LoadLinkageFromBot(), 300);
        })
        .catch((err) => {
          if (err.name === "AbortError") {
            console.warn("Navigation request timed out.");
          } else {
            console.error("Failed to reach bot gateway at 127.0.0.1:5588.", err);
            Swal.fire({
              icon: "error",
              title: "Gateway Unreachable",
              text: "Please ensure the RSBot plugin is running.",
              timer: 3000,
              showConfirmButton: false,
              position: "bottom-end",
              toast: true,
            });
          }
        });
    },
    LoadLinkageFromBot() {
      console.log("Fetching navigation data from bot gateway...");
      var url = "http://127.0.0.1:5588/data";

      var controller = new AbortController();
      var signal = controller.signal;
      setTimeout(() => controller.abort(), 5000); // 5s timeout for data load

      fetch(url, { signal: signal })
        .then((res) => {
          if (!res.ok) throw new Error("HTTP error " + res.status);
          return res.json();
        })
        .then((data) => {
          console.log("Connected! Successfully loaded " + Object.keys(data.nodes || {}).length + " nodes.");
          this.AddNavigationLinkage(data, false); // Don't autopan on initial bot load
        })
        .catch((err) => {
          if (err.name === "AbortError") {
            console.error("Linkage data fetch timed out after 5 seconds.");
          } else {
            console.warn("Could not auto-load data from bot gateway:", err.message);
          }
        });
    },
    ImportNativeLink(gateId, linkIdx) {
      ImportNativeLink.call(this, gateId, linkIdx);
    },
    HighlightNativeLink(linkId, isActive) {
      HighlightNativeLink.call(this, linkId, isActive);
    },
    AddLogToUI(level, message) {
      AddLogToUI(level, message);
    },
    CopyAllLogs() {
      CopyAllLogs();
    },
    StopNavigation() {
      StopNavigation();
    },
    ResumeNavigation() {
      ResumeNavigation();
    },
    StartPolling() {
      if (botStatusInterval) clearInterval(botStatusInterval);
      botStatusInterval = setInterval(PollBotStatus, 2000);
      PollBotStatus();
      console.log("Gateway polling started.");
    },
    StopPolling() {
      if (botStatusInterval) {
        clearInterval(botStatusInterval);
        botStatusInterval = null;
      }
      console.log("Gateway polling stopped.");
      $("#status-gateway span").text("Disconnected");
      var $icon = $("#status-gateway [data-lucide]");
      $icon.css("color", "#ff4d4d").attr("data-lucide", "circle");
      if (window.lucide) window.lucide.createIcons();
    },
    PanToPlayer() {
      if (botPlayerMarker) {
        map.panTo(botPlayerMarker.getLatLng());
      }
    },
    ToggleFollowPlayer() {
      var $check = $("#follow-player-check");
      $check.prop("checked", !$check.prop("checked")).change();
    },
    EnableDrawLine() {
      if (map && map.pm) map.pm.enableDraw("Line");
    },
    FinishDrawLine() {
      if (map && map.pm && map.pm.Draw && map.pm.Draw.Line && map.pm.Draw.Line._finishShape) {
        map.pm.Draw.Line._finishShape();
      }
    },
    RemoveLastVertex() {
      if (map && map.pm && map.pm.Draw && map.pm.Draw.Line && map.pm.Draw.Line._removeLastVertex) {
        map.pm.Draw.Line._removeLastVertex();
      }
    },
    ToggleDragMode() {
      if (map && map.pm) map.pm.toggleGlobalDragMode();
    },
    ToggleDeleteMode() {
      if (map && map.pm) map.pm.toggleGlobalRemovalMode();
    },
    CancelDrawingActions() {
      if (map && map.pm) {
        if (typeof map.pm.disableDraw === "function") map.pm.disableDraw();
        if (typeof map.pm.disableGlobalDragMode === "function") map.pm.disableGlobalDragMode();
        if (typeof map.pm.disableGlobalEditMode === "function") map.pm.disableGlobalEditMode();
        if (typeof map.pm.disableGlobalRemovalMode === "function") map.pm.disableGlobalRemovalMode();
      }
      if (map) map.closePopup();
      if (window.$ && $(".modal").length) $(".modal").modal("hide");
    },
  };
})();
