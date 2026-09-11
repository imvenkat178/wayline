import type { Journey, Leg } from "./types";
export function decodePolyline(encoded: string): [number, number][] {
  let index = 0,
    lat = 0,
    lon = 0;
  const points: [number, number][] = [];
  const read = () => {
    let value = 0,
      shift = 0,
      byte: number;
    do {
      if (index >= encoded.length || shift > 30) throw Error("Invalid geometry");
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw Error("Invalid geometry");
      value |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    return value & 1 ? ~(value >> 1) : value >> 1;
  };
  try {
    while (index < encoded.length && points.length < 50000) {
      lat += read();
      lon += read();
      if (Math.abs(lat) > 9000000 || Math.abs(lon) > 18000000) return [];
      points.push([lon / 1e5, lat / 1e5]);
    }
    return points;
  } catch {
    return [];
  }
}
export function legGeometry(leg: Leg, j: Journey): [number, number][] {
  const real = leg.geometry ? decodePolyline(leg.geometry) : [];
  return real.length > 1 ? real : [leg.fromCoords ?? j.fromCoords, leg.toCoords ?? j.toCoords];
}
export function journeyBounds(j: Journey): [[number, number], [number, number]] {
  const p = j.legs.flatMap((l) => legGeometry(l, j));
  return [
    [Math.min(...p.map((x) => x[0])), Math.min(...p.map((x) => x[1]))],
    [Math.max(...p.map((x) => x[0])), Math.max(...p.map((x) => x[1]))],
  ];
}
