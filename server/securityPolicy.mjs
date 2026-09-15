// Optional vector map style (ROADMAP G11.5): MAP_STYLE_URL and MAP_TILE_ORIGINS add HTTPS origins
// for the style, tiles, glyphs and sprites. Unset, the policy allows only the OpenStreetMap tiles.
export function mapStyleUrl(env = process.env) {
  try {
    const url = new URL(env.MAP_STYLE_URL ?? "");
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
export function mapOrigins(env = process.env) {
  const origins = new Set();
  for (const value of [env.MAP_STYLE_URL, ...(env.MAP_TILE_ORIGINS ?? "").split(",")]) {
    try {
      const url = new URL((value ?? "").trim());
      if (url.protocol === "https:" && !url.username && !url.password) origins.add(url.origin);
    } catch {
      // Ignore empty or malformed entries rather than widening the policy.
    }
  }
  return [...origins];
}
export function contentSecurityPolicy(cardsEnabled=false, env=process.env) {
 const cardScripts=cardsEnabled?' https://js.evervault.com https://assets.duffel.com':'';
 const cardConnections=cardsEnabled?' https://api.duffel.com https://api.duffel.cards https://keys.evervault.com https://api.evervault.com https://assets.duffel.com':'';
 const mapHosts=mapOrigins(env).map(origin=>' '+origin).join('');
 return "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'"+cardScripts+"; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org"+(cardsEnabled?' https://assets.duffel.com':'')+mapHosts+"; connect-src 'self' https://demotiles.maplibre.org https://tile.openstreetmap.org https://tessdata.projectnaptha.com"+cardConnections+mapHosts+"; font-src 'self'"+(cardsEnabled?' https://assets.duffel.com':'')+"; frame-src "+(cardsEnabled?"https://ui-components.evervault.com":"'none'")+"; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
}
