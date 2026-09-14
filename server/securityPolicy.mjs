export function contentSecurityPolicy(cardsEnabled=false) {
 const cardScripts=cardsEnabled?' https://js.evervault.com https://assets.duffel.com':'';
 const cardConnections=cardsEnabled?' https://api.duffel.com https://api.duffel.cards https://keys.evervault.com https://api.evervault.com https://assets.duffel.com':'';
 return "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'"+cardScripts+"; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org"+(cardsEnabled?' https://assets.duffel.com':'')+"; connect-src 'self' https://demotiles.maplibre.org https://tile.openstreetmap.org https://tessdata.projectnaptha.com"+cardConnections+"; font-src 'self'"+(cardsEnabled?' https://assets.duffel.com':'')+"; frame-src "+(cardsEnabled?"https://ui-components.evervault.com":"'none'")+"; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
}
