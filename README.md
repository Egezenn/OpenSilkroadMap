# OpenSilkroadMap

The hackable [**Silkroad Online**](http://www.joymax.com/silkroad/) world map.

## Features

- Navigate through towns, areas, and other popular locations
- Search filter by locations or NPC's
- Search by coordinates (both supported: PosX, PosY or X, Y, Z, Region)
- Teleport actions with NPC's included
- Show coordinates by click
- Zoom levels
- Script editor (Create, Export, Import working even with bots)
- Works on mobile devices
- Generate maps for any Silkroad Online version with only a few scripts
- Connect to an OasisBot instance with it's OpenSilkroadMap-Explorer plugin

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Python 3.10+](https://www.python.org/) with [uv](https://github.com/astral-sh/uv) (recommended) or standard pip for asset processing.

### 1. Install Dependencies

```shell
npm install
```

### 2. Run the Development Server

Start the local Vite server:

```shell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Extracting Client Files (.pk2)

To extract the necessary game assets from your Silkroad Online client, you can use the [pk2_mate tool binary](https://github.com/Egezenn/pk2/releases/tag/untagged-2ba35ece888b03e5ff9a) or build it from [source via cargo](https://github.com/Veykril/pk2).

Extract the PK2 archives into the `game_source` folder:

```shell
mkdir game_source
pk2_mate extract --archive "C:\Games\SRO\Media.pk2" --out game_source/Media
pk2_mate extract --archive "C:\Games\SRO\Data.pk2" --out game_source/Data
pk2_mate extract --archive "C:\Games\SRO\Map.pk2" --out game_source/Data
```

### 4. Processing Silkroad Assets

```shell
uv run scripts/convert_ddjs.py
uv run scripts/generate_tiles.py
uv run scripts/generate_navmesh.py
uv run scripts/generate_game_data.py
```

## API Reference

**OpenSilkroadMap.js** library contains the following methods, basic to create fully functional map.


| Method                                     |  Return   | Description                                                                   |
| :----------------------------------------- | :-------: | :---------------------------------------------------------------------------- |
| init(`TagID`)                              |     -     | Initialize the silkroad map at the specified html tag with viewpoint at Hotan |
| init(`TagID,PosX,PosY`)                    |     -     | Overload, with view at **in game** (**IG**) coords                            |
| init(`TagID,X,Y,Z,Region`)                 |     -     | Overload, with view at **internal client** (**IC**) coords                    |
| SetZoomLimit(`MinZoom,MaxZoom`)            |     -     | Limit the zoom min. and max. Values [0-9]                                     |
| SetView(`PosX,PosY`)                       |     -     | Set the view instantly using IG coords                                        |
| SetView(`X,Y,Z,Region`)                    |     -     | Overload, using IC coords                                                     |
| FlyView(`PosX,PosY`)                       |     -     | Set the view flying using IG coords                                           |
| FlyView(`X,Y,Z,Region`)                    |     -     | Overload, using IC coords                                                     |
| AddNPC(`NpcID,HTMLPopup,PosX,PosY`)        |     -     | Add NPC marker                                                                |
| AddNPC(`NpcID,HTMLPopup,X,Y,Z,Region`)     |     -     | Overload, using IC coords                                                     |
| GoToNPC(`NpcID`)                           | `Boolean` | Set the view on NPC and highlight him, return `True` if the ID exists         |
| AddTeleport(`HTMLPopup,Type,PosX,PosY`)    |     -     | Add Teleport marker, `Type` is a number (0-6) which specify the icon shown    |
| AddTeleport(`HTMLPopup,Type,X,Y,Z,Region`) |     -     | Overload, using IC coords                                                     |
| AddPlayer(`PlayerID,HTMLPopup,PosX,PosY`)  |     -     | Add Player marker                                                             |
| MovePlayer(`PlayerID,PosX,PosY`)           |     -     | Moves a player by his ID, to the IC coords even through differents areas      |
| MovePlayer(`PlayerID,X,Y,Z,Region`)        |     -     | Overload, using IC coords                                                     |
| GoToPlayer(`PlayerID`)                     | `Boolean` | Set the view on Player and highlight him, return `True` if the ID exists      |
| RemovePlayer(`PlayerID`)                   |     -     | Removes the Player marker                                                     |

## Credits

- Initial work done by [Jellybitz](https://github.com/JellyBitz) on [xSROMap](https://github.com/JellyBitz/xSROMap)
- Integrated changes made on [kis1yi](https://github.com/kis1yi)'s [fork](https://github.com/kis1yi/xSROMap)
- Adjustments, cleanup, integrations to OasisBot and scripts to further improve reproducibility by [Egezenn](https://github.com/Egezenn)

## TODO

- Deployment
- OpenSilkroadMap-Explorer Dungeon integration
  - Need to quantize heights on dungeon regions so that they don't render on top of each other
- Shard the JS files&logic, clean up
