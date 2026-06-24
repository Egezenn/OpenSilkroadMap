import Projection from 'ol/proj/Projection';
import TileGrid from 'ol/tilegrid/TileGrid';

export const SRO_ORIGIN = [0, 0];
export const SRO_EXTENT = [0, 0, 256, 256];

export const sroProjection = new Projection({
  code: 'SRO',
  units: 'pixels',
  extent: SRO_EXTENT,
});

export const resolutions = [
  1 / Math.pow(2, 3),
  1 / Math.pow(2, 6),
  1 / Math.pow(2, 9),
];

export const tileGrid = new TileGrid({
  origin: [SRO_ORIGIN[0], SRO_ORIGIN[1]],
  resolutions: resolutions,
  tileSize: 256,
});

export function convertMapToSRO(secX: number, secY: number, layerKey: string) {
  const isDungeon = layerKey !== 'world';
  if (isDungeon) {
    const region = parseInt(layerKey.split('_')[0], 10);
    return {
      x: Math.round((secX - 128) * 1920),
      y: Math.round((secY - 127) * 1920),
      region: region,
    };
  } else {
    const posX = Math.round((secX - 135) * 192);
    const posY = Math.round((secY - 91) * 192);
    const xSector = Math.floor(secX);
    const ySector = Math.floor(secY) + 1;
    const region = (ySector << 8) | xSector;
    return {
      x: posX,
      y: posY,
      region: region,
    };
  }
}

export function convertSROToMap(x: number, y: number, region: number): number[] {
  const isDungeon = region > 32767;
  if (isDungeon) {
    const secX = 128 + x / 1920;
    const secY = 127 + y / 1920;
    return [secX, secY];
  } else {
    if (x < 0 || x > 1920 || y < 0 || y > 1920) {
      const secX = x / 192 + 135;
      const secY = y / 192 + 91;
      return [secX, secY];
    } else {
      const xSector = region & 0xff;
      const ySector = region >> 8;
      const secX = xSector + x / 1920;
      const secY = ySector + y / 1920 - 1;
      return [secX, secY];
    }
  }
}
