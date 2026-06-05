/*
 * Initialize OpenSilkroadMap
 */

OpenSilkroadMap.init("map");

// Load external data and initialize map markers
Promise.all([
  fetch("assets/npcs.json").then((res) => res.json()),
  fetch("assets/teleports.json").then((res) => res.json()),
])
  .then(function (data) {
    var NPCs = data[0];
    var TPs = data[1];

    // Add NPC's: [ { name , x , z , y , region, teleport : [ { name , x , z , y , region } , ... ] } , ...]
    var ul_NPCs = $("#navigation-npc .sidebar-submenu ul");
    var npcListHtml = "";
    for (var i = 0; i < NPCs.length; i++) {
      // Create html
      var html = "<b>" + NPCs[i].name + "</b>";
      for (var j = 0; j < NPCs[i].teleport.length; j++)
        html +=
          '<br><a href="#" onclick="OpenSilkroadMap.FlyView(' +
          NPCs[i].teleport[j].x +
          "," +
          NPCs[i].teleport[j].y +
          "," +
          NPCs[i].teleport[j].z +
          "," +
          NPCs[i].teleport[j].region +
          ')">' +
          NPCs[i].teleport[j].name +
          "</a>";
      // Add to map
      OpenSilkroadMap.AddNPC(i, html, NPCs[i].x, NPCs[i].y, NPCs[i].z, NPCs[i].region);
      // Accumulate GUI html
      npcListHtml += '<li><a href="#" onclick="OpenSilkroadMap.GoToNPC(' + i + ')">' + NPCs[i].name + "</a></li>";
    }
    ul_NPCs.append(npcListHtml);

    // Add Teleports: [ { name , x , z , y , region , type,  teleport : [ { name , x , z , y , region } , ... ] } , ...]
    for (var i = 0; i < TPs.length; i++) {
      // Create html
      var html = "<b>" + TPs[i].name + "</b>";
      for (var j = 0; j < TPs[i].teleport.length; j++)
        html +=
          '<br><a href="#" onclick="OpenSilkroadMap.FlyView(' +
          TPs[i].teleport[j].x +
          "," +
          TPs[i].teleport[j].y +
          "," +
          TPs[i].teleport[j].z +
          "," +
          TPs[i].teleport[j].region +
          ')">' +
          TPs[i].teleport[j].name +
          "</a>";
      // Add to map
      OpenSilkroadMap.AddTeleport(html, TPs[i].type, TPs[i].x, TPs[i].y, TPs[i].z, TPs[i].region);
    }
  })
  .catch(function (err) {
    console.error("Failed to load map data:", err);
  });

// Activate drawing creator
OpenSilkroadMap.ShowDrawingToolbar("topright", true, false, true, false, true, true, true, true, false, true);

/*
 * Navigation Linkage Loader
 */

// Linkage file loader
$("#linkage-file-input").on("change", function (e) {
  var file = e.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function (e) {
    try {
      var data = JSON.parse(e.target.result);
      OpenSilkroadMap.AddNavigationLinkage(data);
    } catch (err) {
      alert("Failed to parse JSON file: " + err.message);
    }
  };
  reader.readAsText(file);
});

// Drag and drop support for the map
var mapContainer = document.getElementById("map");
mapContainer.addEventListener("dragover", function (e) {
  e.preventDefault();
  e.stopPropagation();
});
mapContainer.addEventListener("drop", function (e) {
  e.preventDefault();
  e.stopPropagation();
  var file = e.dataTransfer.files[0];
  if (file && file.name.toLowerCase().endsWith(".json")) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);
        OpenSilkroadMap.AddNavigationLinkage(data);
      } catch (err) {
        alert("Failed to parse JSON file: " + err.message);
      }
    };
    reader.readAsText(file);
  }
});

// Examples about how to add shapes

/*
 * Sidebar actions
 */

// sidebar dropdown menu lv.1
$(".sidebar-dropdown > a").click(function () {
  $(".sidebar-submenu").slideUp(200);
  if ($(this).parent().hasClass("active")) {
    $(".sidebar-dropdown").removeClass("active");
    $(this).parent().removeClass("active");
  } else {
    $(".sidebar-dropdown").removeClass("active");
    $(this).next(".sidebar-submenu").slideDown(200);
    $(this).parent().addClass("active");
  }
});
// sidebar dropdown menu lv.2
$(".sidebar-submenu-dropdown > a").click(function () {
  $(".sidebar-submenu-submenu").slideUp(200);
  if ($(this).parent().hasClass("active")) {
    $(".sidebar-submenu-dropdown").removeClass("active");
    $(this).parent().removeClass("active");
  } else {
    $(".sidebar-submenu-dropdown").removeClass("active");
    $(this).next(".sidebar-submenu-submenu").slideDown(200);
    $(this).parent().addClass("active");
  }
});
// sidebar toggle logic
$(document).on("click", "#toggle-sidebar, #show-sidebar", function (e) {
  e.preventDefault();
  e.stopPropagation();
  $(".page-wrapper").toggleClass("toggled");
});

$(document).on("click", "#close-sidebar", function (e) {
  e.preventDefault();
  e.stopPropagation();
  $(".page-wrapper").removeClass("toggled");
});
// filter
$('#search input[type="text"]').keyup(function () {
  var searchText = $(this).val();

  // check if value are coordinates type
  if (searchText.split(",").length > 1) searchText = "";
  else searchText = searchText.toLowerCase();

  // Navigate through every category and all his items
  $("#navigation li.sidebar-dropdown").each(function (index) {
    var showCounter = 0;
    $(this)
      .find(".sidebar-submenu>ul>li")
      .each(function (index) {
        if ($(this).text().toLowerCase().indexOf(searchText) > -1) {
          $(this).show();
          showCounter++;
        } else {
          $(this).hide();
        }
      });

    // hide category if has no match
    if (showCounter > 0) $(this).show();
    else $(this).hide();
  });
});
// Coordinate search on click/enter
searchId = 0;
$("#search .input-group-append").click(function () {
  var searchCoordinates = $('#search input[type="text"]').val().split(",");
  // check if value are coordinates type
  if (searchCoordinates.length > 1) {
    var x = parseFloat(searchCoordinates[0]);
    var y = parseFloat(searchCoordinates[1]);
    // x and y correctly parsed?
    if (!isNaN(x) && !isNaN(y)) {
      // check if is a region coordinate
      if (searchCoordinates.length == 4) {
        var z = parseFloat(searchCoordinates[2]);
        var r = parseFloat(searchCoordinates[3]);
        if (!isNaN(z) && !isNaN(r)) {
          OpenSilkroadMap.SetView(x, y, z, r);
          // Add visual reference
          OpenSilkroadMap.AddLocation(
            searchId,
            '<a href="#" onclick="OpenSilkroadMap.RemoveLocation(' +
              searchId++ +
              ')">Remove <i data-lucide="trash-2" style="width: 14px; height: 14px; vertical-align: middle;"></i></a>',
            x,
            y,
            z,
            r,
          );
        }
      } else {
        OpenSilkroadMap.SetView(x, y);
        // Add visual reference
        OpenSilkroadMap.AddLocation(
          searchId,
          '<a href="#" onclick="OpenSilkroadMap.RemoveLocation(' +
            searchId++ +
            ')">Remove <i data-lucide="trash-2" style="width: 14px; height: 14px; vertical-align: middle;"></i></a>',
          x,
          y,
        );
      }
    }
  }
});
$('#search input[type="text"]').keypress(function (e) {
  if (e.which == 13) {
    $("#search .input-group-append").click();
  }
});

// Show coordinates link at search box
window.onload = function () {
  // Reading GET inputs
  var GET = function (parameter) {
    var tmp;
    var items = location.search.substr(1).split("&");
    for (var i = 0; i < items.length; i++) {
      tmp = items[i].split("=");
      if (tmp[0] === parameter) return decodeURIComponent(tmp[1]);
    }
    return null;
  };
  var x = parseFloat(GET("x"));
  var y = parseFloat(GET("y"));
  if (!isNaN(x) && !isNaN(y)) {
    var z = parseFloat(GET("z"));
    var r = parseFloat(GET("region"));
    // Show link
    if (!isNaN(z) && !isNaN(r)) $('#search input[type="text"]').val(x + "," + y + "," + z + "," + r);
    else $('#search input[type="text"]').val(x + "," + y);
  }
};

/*
 * Script Generator
 */

var ImportDrawingLayers = function () {
  var textarea = $("#textareaScriptEditor").val();
  if (textarea == "") return;

  var lines = textarea.match(/[^\r\n]+/g);
  // analyze script type
  var type = $("#selectEditorType").val();
  // default type
  if (type.startsWith("--")) type = null;

  if (type == null) {
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("> Marker")) {
        // Check next line position
        if (i + 1 < lines.length) {
          var pos = lines[i + 1].split(",");
          if (pos.length == 2 && pos[0].startsWith("PosX:") && pos[1].startsWith("PosY:")) {
            var posX = parseFloat(pos[0].substr(5));
            var posY = parseFloat(pos[1].substr(5));
            if (!isNaN(posX) && !isNaN(posY)) {
              OpenSilkroadMap.AddDrawingShape("Marker", [posX, posY], lines[i].substr(9));
              i++;
            }
          } else if (
            pos.length == 4 &&
            pos[0].startsWith("X:") &&
            pos[1].startsWith("Y:") &&
            pos[2].startsWith("Z:") &&
            pos[3].startsWith("Region:")
          ) {
            var x = parseFloat(pos[0].substr(2));
            var y = parseFloat(pos[1].substr(2));
            var z = parseFloat(pos[2].substr(2));
            var r = parseFloat(pos[3].substr(7));
            if (!isNaN(x) && !isNaN(y) && !isNaN(z) && !isNaN(r)) {
              OpenSilkroadMap.AddDrawingShape("Marker", [x, y, z, r], lines[i].substr(9));
              i++;
            }
          }
        }
      } else if (lines[i].startsWith("> Polyline") || lines[i].startsWith("> Polygon")) {
        var t = lines[i].startsWith("> Polyl") ? "Polyline" : "Polygon";
        var coords = [];
        var param2 = lines[i].substr(t.length + 3);
        // extract and leave the cursor when cannot continue
        var j = i + 1;
        while (j < lines.length) {
          var pos = lines[j].split(",");
          if (pos.length == 2 && pos[0].startsWith("PosX:") && pos[1].startsWith("PosY:")) {
            var posX = parseFloat(pos[0].substr(5));
            var posY = parseFloat(pos[1].substr(5));
            if (!isNaN(posX) && !isNaN(posY)) {
              coords.push([posX, posY]);
              j++;
              i = j - 1;
              continue;
            }
          } else if (
            pos.length == 4 &&
            pos[0].startsWith("X:") &&
            pos[1].startsWith("Y:") &&
            pos[2].startsWith("Z:") &&
            pos[3].startsWith("Region:")
          ) {
            var x = parseFloat(pos[0].substr(2));
            var y = parseFloat(pos[1].substr(2));
            var z = parseFloat(pos[2].substr(2));
            var r = parseFloat(pos[3].substr(7));
            if (!isNaN(x) && !isNaN(y) && !isNaN(z) && !isNaN(r)) {
              coords.push([x, y, z, r]);
              j++;
              i = j - 1;
              continue;
            }
          }
          break;
        }
        OpenSilkroadMap.AddDrawingShape(t, coords, param2);
      } else if (lines[i].startsWith("> Circle")) {
        // Check next line position
        if (i + 1 < lines.length) {
          var pos = lines[i + 1].split(",");
          if (pos.length >= 2 && pos[0].startsWith("PosX:") && pos[1].startsWith("PosY:")) {
            var posX = parseFloat(pos[0].substr(5));
            var posY = parseFloat(pos[1].substr(5));
            if (!isNaN(posX) && !isNaN(posY)) {
              // Check next line radius
              if (i + 2 < lines.length && lines[i + 2].startsWith("Radius:")) {
                var radius = parseFloat(lines[i + 2].substr(7));
                if (!isNaN(radius)) OpenSilkroadMap.AddDrawingShape("Circle", [posX, posY], radius);
                i += 2;
              }
            }
          } else if (
            pos.length == 4 &&
            pos[0].startsWith("X:") &&
            pos[1].startsWith("Y:") &&
            pos[2].startsWith("Z:") &&
            pos[3].startsWith("Region:")
          ) {
            var x = parseFloat(pos[0].substr(2));
            var y = parseFloat(pos[1].substr(2));
            var z = parseFloat(pos[2].substr(2));
            var r = parseFloat(pos[3].substr(7));
            if (!isNaN(x) && !isNaN(y) && !isNaN(z) && !isNaN(r)) {
              // Check next line radius
              if (i + 2 < lines.length && lines[i + 2].startsWith("Radius:")) {
                var radius = parseFloat(lines[i + 2].substr(7));
                if (!isNaN(radius)) OpenSilkroadMap.AddDrawingShape("Circle", [x, y, z, r], radius);
                i += 2;
              }
            }
          }
        }
      }
    }
  } else if (type == "sBot") {
    // Add paths
    var coords = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("teleport(")) {
        if (coords.length > 2) OpenSilkroadMap.AddDrawingShape("Polyline", coords);
        coords = [];
      } else if (lines[i].startsWith("go(")) {
        var coord = lines[i].substr(3).split(",");
        if (coord.length == 2) {
          var x = parseFloat(coord[0]);
          var y = parseFloat(coord[1]);
          if (!isNaN(x) && !isNaN(y)) coords.push([x, y]);
        }
      }
    }
    if (coords.length >= 2) OpenSilkroadMap.AddDrawingShape("Polyline", coords);
  } else if (type == "mBot") {
    // Add paths
    var coords = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("teleport,")) {
        if (coords.length > 2) OpenSilkroadMap.AddDrawingShape("Polyline", coords);
        coords = [];
      } else if (lines[i].startsWith("go,")) {
        var coord = lines[i].split(",");
        if (coord.length == 3) {
          var x = parseFloat(coord[1]);
          var y = parseFloat(coord[2]);
          if (!isNaN(x) && !isNaN(y)) coords.push([x, y]);
        }
      }
    }
    if (coords.length >= 2) OpenSilkroadMap.AddDrawingShape("Polyline", coords);
  } else if (type == "phBot") {
    // Add paths
    var coords = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("teleport,") || lines[i].startsWith("wait,")) {
        if (coords.length > 2) OpenSilkroadMap.AddDrawingShape("Polyline", coords);
        coords = [];
      } else if (lines[i].startsWith("walk,")) {
        var coord = lines[i].split(",");
        if (coord.length == 4) {
          var posX = parseFloat(coord[1]);
          var posY = parseFloat(coord[2]);
          if (!isNaN(posX) && !isNaN(posY)) coords.push([posX, posY]);
        } else if (coord.length == 5) {
          var region = parseInt(coord[1]);
          var x = parseFloat(coord[2]);
          var y = parseFloat(coord[3]);
          var z = parseFloat(coord[4]);
          if (region < 0) {
            // phBot synchronization on dungeons
            region += 65535 + 1;
            x = 10 * (x - ((region & 0xff) - 128) * 192);
            y = 10 * (y - ((region >> 8) - 128) * 192);
          }
          if (!isNaN(region) && !isNaN(x) && !isNaN(y) && !isNaN(z)) coords.push([x, y, z, region]);
        } else if (coord.length == 6) {
          var xsec = parseInt(coord[1]);
          var ysec = parseInt(coord[2]);
          var x = parseFloat(coord[3]);
          var y = parseFloat(coord[4]);
          var z = parseFloat(coord[5]);
          if (!isNaN(x) && !isNaN(y) && !isNaN(z) && !isNaN(xsec) && !isNaN(ysec)) {
            var region = (ysec << 8) | xsec;
            coords.push([x, y, z, region]);
          }
        }
      } else if (lines[i].startsWith("AttackArea")) {
        if (coords.length > 0) {
          var lastCoord = coords[coords.length - 1];
          var options = lines[i].split(",");
          var radius = 45; // Silkroad spawn radius 45-65, approx.
          if (options.length >= 2) radius = parseFloat(options[1]);
          OpenSilkroadMap.AddDrawingShape("Circle", lastCoord, radius);
        }
      }
    }
    if (coords.length >= 2) OpenSilkroadMap.AddDrawingShape("Polyline", coords);
  } else if (type == "RSBot") {
    // Add paths
    var coords = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("move ")) {
        var data = lines[i].split(" ");
        if (data.length == 6) {
          var x = parseFloat(data[1]);
          var y = parseFloat(data[2]);
          var z = parseFloat(data[3]);
          var xsec = parseInt(data[4]);
          var ysec = parseInt(data[5]);
          if (!isNaN(x) && !isNaN(y) && !isNaN(z) && !isNaN(xsec) && !isNaN(ysec)) {
            var region = (ysec << 8) | xsec;
            coords.push([x, y, z, region]);
          }
        }
      }
    }
    if (coords.length >= 2) OpenSilkroadMap.AddDrawingShape("Polyline", coords);
  }
};
var ExportDrawingLayers = function () {
  var shapes = OpenSilkroadMap.GetDrawingShapes();
  var textarea = "";

  var type = $("#selectEditorType").val();
  // default type
  if (type.startsWith("--")) type = null;

  for (var id in shapes) {
    var shape = shapes[id];

    // filter and extract script type
    if (type == null) {
      switch (shape.xMap.type) {
        case "Marker":
          {
            textarea += "> Marker ID:" + shape._leaflet_id + "\n";

            var coord = OpenSilkroadMap.ConvertLatLngToCoords(shape._latlng);
            textarea += "X:" + coord.x + ",Y:" + coord.y + ",Z:" + coord.z + ",Region:" + coord.region + "\n";
          }
          break;
        case "Polyline":
          textarea += "> Polyline:\n";
          var distance = 0;
          var lastCoord;

          for (var i = 0; i < shape._latlngs.length; i++) {
            var coord = OpenSilkroadMap.ConvertLatLngToCoords(shape._latlngs[i]);
            textarea += "X:" + coord.x + ",Y:" + coord.y + ",Z:" + coord.z + ",Region:" + coord.region + "\n";
            if (coord.posX != null) {
              // calc distance at world map
              if (lastCoord)
                distance += Math.sqrt(
                  Math.pow(lastCoord.posX - coord.posX, 2) + Math.pow(lastCoord.posY - coord.posY, 2),
                );
            } else {
              // calc distance at cave
              if (lastCoord)
                distance += Math.sqrt(Math.pow(lastCoord.x - coord.x, 2) + Math.pow(lastCoord.y - coord.y, 2)) / 10;
            }
            lastCoord = coord;
          }

          textarea += "Total Distance: " + Math.round(distance, 2) + "\n";
          break;
        case "Polygon":
          textarea += "> Polygon:\n";
          console.log(shape);

          for (var i = 0; i < shape._latlngs[0].length; i++) {
            var coord = OpenSilkroadMap.ConvertLatLngToCoords(shape._latlngs[0][i]);
            textarea += "X:" + coord.x + ",Y:" + coord.y + ",Z:" + coord.z + ",Region:" + coord.region + "\n";
          }
          break;
        case "Circle":
          {
            textarea += "> Circle:\n";

            var coord = OpenSilkroadMap.ConvertLatLngToCoords(shape._latlng);
            textarea += "X:" + coord.x + ",Y:" + coord.y + ",Z:" + coord.z + ",Region:" + coord.region + "\n";

            textarea += "Radius:" + Math.round(shape._mRadius * 192, 2) + "\n";
          }
          break;
      }
    } else if (type == "sBot") {
      if (shape.xMap.type == "Polyline") {
        for (var i = 0; i < shape._latlngs.length; i++) {
          var coord = OpenSilkroadMap.ConvertLatLngToCoords(shape._latlngs[i]);
          if (coord.posX != null) textarea += "go(" + Math.round(coord.posX) + "," + Math.round(coord.posY) + ")\n";
          //else
          //	textarea += "X:"+coord.x+",Y:"+coord.y+",Z:"+coord.z+",Region:"+coord.region+"\n";
        }
      }
    } else if (type == "mBot") {
      if (shape.xMap.type == "Polyline") {
        for (var i = 0; i < shape._latlngs.length; i++) {
          var coord = OpenSilkroadMap.ConvertLatLngToCoords(shape._latlngs[i]);
          if (coord.posX != null) textarea += "walk," + Math.round(coord.posX) + "," + Math.round(coord.posY) + "\n";
          //else
          //	textarea += "X:"+coord.x+",Y:"+coord.y+",Z:"+coord.z+",Region:"+coord.region+"\n";
        }
      }
    } else if (type == "phBot") {
      switch (shape.xMap.type) {
        case "Marker":
          {
            textarea += "// Marker - ID:" + shape._leaflet_id + "\n";

            var coord = OpenSilkroadMap.ConvertLatLngToCoords(shape._latlng);
            if (coord.posX != null)
              textarea += "// PosX:" + Math.round(coord.posX) + ",PosY:" + Math.round(coord.posY) + "\n";
            else
              textarea +=
                "// Region:" +
                (coord.region > 32767 ? coord.region - 65536 : coord.region) +
                ",X:" +
                coord.x +
                ",Y:" +
                coord.y +
                ",Z:" +
                coord.z +
                "\n";
          }
          break;
        case "Polyline":
          var distance = 0;
          var lastCoord;
          var path = "";

          for (var i = 0; i < shape._latlngs.length; i++) {
            var coord = OpenSilkroadMap.ConvertLatLngToCoords(shape._latlngs[i]);
            if (coord.posX != null) {
              path += "walk," + Math.round(coord.posX) + "," + Math.round(coord.posY) + ",0\n";
              // calc distance at world map
              if (lastCoord)
                distance += Math.sqrt(
                  Math.pow(lastCoord.posX - coord.posX, 2) + Math.pow(lastCoord.posY - coord.posY, 2),
                );
            } else {
              // phBot synchronization on dungeons
              coord["posX"] = ((coord.region & 0xff) - 128) * 192 + coord.x / 10;
              coord["posY"] = ((coord.region >> 8) - 128) * 192 + coord.y / 10;
              if (coord.region > 0) coord.region -= 65535 + 1;

              path +=
                "walk," +
                coord.region +
                "," +
                Math.round(coord.posX) +
                "," +
                Math.round(coord.posY) +
                "," +
                coord.z +
                "\n";
              // calc distance at cave
              if (lastCoord)
                distance += Math.sqrt(Math.pow(lastCoord.x - coord.x, 2) + Math.pow(lastCoord.y - coord.y, 2));
            }
            lastCoord = coord;
          }

          textarea += "// Polyline - Distance:" + Math.round(distance, 2) + "\n" + path;
          break;
        case "Circle":
          {
            textarea += "// Circle - Radius:" + Math.round(shape._mRadius * 192, 2) + "\n";

            var coord = OpenSilkroadMap.ConvertLatLngToCoords(shape._latlng);
            if (coord.posX != null)
              textarea += "// PosX:" + Math.round(coord.posX) + ",PosY:" + Math.round(coord.posY) + "\n";
            else
              textarea +=
                "// Region:" +
                (coord.region > 32767 ? coord.region - 65536 : coord.region) +
                ",X:" +
                coord.x +
                ",Y:" +
                coord.y +
                ",Z:" +
                coord.z +
                "\n";
          }
          break;
      }
    } else if (type == "RSBot") {
      if (shape.xMap.type == "Polyline") {
        for (var i = 0; i < shape._latlngs.length; i++) {
          var coord = OpenSilkroadMap.ConvertLatLngToCoords(shape._latlngs[i]);
          xsec = coord.region & 0xff;
          ysec = coord.region >> 8;
          textarea +=
            "move " +
            Math.round(coord.x) +
            " " +
            Math.round(coord.y) +
            " " +
            Math.round(coord.z) +
            " " +
            xsec +
            " " +
            ysec +
            "\n";
        }
      } else if (shape.xMap.type == "Circle") {
        var coord = OpenSilkroadMap.ConvertLatLngToCoords(shape._latlng);
        if (coord.posX != null)
          textarea +=
            "area " +
            Math.round(coord.posX) +
            " " +
            Math.round(coord.posY) +
            " " +
            Math.floor(shape._mRadius * 192) +
            "\n";
        else
          textarea +=
            "area " + Math.round(coord.x) + " " + Math.round(coord.y) + " " + Math.floor(shape._mRadius * 192) + "\n";
      }
    }
  }

  $("#textareaScriptEditor").val(textarea);
};
