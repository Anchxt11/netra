// Globe data: dotted land from world-atlas, and the illustrative attack arcs.
// Locations are illustrative only (the generator has no geolocation) and are never labelled.
import { geoEquirectangular, geoInterpolate, geoOrthographic, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryObject } from "topojson-specification";
import landTopo from "world-atlas/land-110m.json";

export type LonLat = [number, number];

/** "YOUR NETWORK": where the arcs land. */
export const TARGET: LonLat = [77.2, 28.6];

/** The globe's resting rotation: [longitude, tilt]. */
export const HOME_ROTATION: [number, number] = [-62, -18];

/** Where the target sits on the stage at rest, as a share of the stage (0 to 1): the dive zooms here. */
export function targetOnStage(): { x: number; y: number } {
  const proj = geoOrthographic().scale(292).translate([380, 380]).rotate(HOME_ROTATION);
  const p = proj(TARGET) ?? [380, 380];
  return { x: p[0] / 760, y: p[1] / 760 };
}

const SOURCES: LonLat[] = [
  [4.9, 52.4], [8.7, 50.1], [37.6, 55.8], [3.4, 6.5], [28.0, -26.2],
  [55.3, 25.3], [103.8, 1.35], [106.8, -6.2], [121.5, 25.0], [30.5, 50.4],
];

const ARC_SAMPLES = 50;

/** Each arc as 51 points along the great circle from a source to the target. */
export const ARCS: LonLat[][] = SOURCES.map((s) => {
  const ip = geoInterpolate(s, TARGET);
  return Array.from({ length: ARC_SAMPLES + 1 }, (_, i) => ip(i / ARC_SAMPLES) as LonLat);
});

/**
 * Land dots on a 1.9° grid (about 2,000). Instead of testing every point against the land
 * polygons (slow), the land is drawn once on a small hidden map and each point reads its pixel.
 */
export function buildLandDots(): LonLat[] {
  const topo = landTopo as unknown as Topology<{ land: GeometryObject }>;
  const land = feature(topo, topo.objects.land);
  const W = 720;
  const H = 360;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  const proj = geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]);
  ctx.beginPath();
  geoPath(proj, ctx)(land);
  ctx.fillStyle = "#000";
  ctx.fill();
  const data = ctx.getImageData(0, 0, W, H).data;
  const isLand = (lon: number, lat: number) => {
    const x = Math.min(W - 1, Math.floor(((lon + 180) / 360) * W));
    const y = Math.min(H - 1, Math.floor(((90 - lat) / 180) * H));
    return data[(y * W + x) * 4 + 3] > 128;
  };

  const dots: LonLat[] = [];
  const step = 1.9;
  for (let lat = -78; lat <= 84; lat += step) {
    const lonStep = step / Math.max(Math.cos((lat * Math.PI) / 180), 0.25);
    for (let lon = -180; lon < 180; lon += lonStep) {
      if (isLand(lon, lat)) dots.push([lon, lat]);
    }
  }
  return dots;
}
