import { useEffect, useRef, useState } from 'react';
import { stations, type Trip } from './model';
import { Icon } from '../components/ui';
import 'maplibre-gl/dist/maplibre-gl.css';

export default function RouteMap({ trip, large = false }: { trip: Trip; large?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('maplibre-gl').Map | null>(null);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [terrain, setTerrain] = useState(false);
  const from = stations[trip.from], to = stations[trip.to];
  useEffect(() => {
    let stopped = false;
    setLoaded(false); setError('');
    void import('maplibre-gl').then(lib => {
      if (stopped || !host.current) return;
      const map = new lib.Map({ container: host.current, style: { version: 8, sources: { base: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors' } }, layers: [{ id: 'base', source: 'base', type: 'raster', paint: { 'raster-saturation': -0.85, 'raster-opacity': 0.78 } }] }, center: from.coords, zoom: 6, attributionControl: { compact: true } });
      mapRef.current = map;
      map.addControl(new lib.NavigationControl({ showCompass: false }), 'bottom-right');
      map.addControl(new lib.FullscreenControl(), 'bottom-right');
      map.on('error', () => setError('Map tiles unavailable. Your station details are still here.'));
      map.on('load', () => {
        if (stopped) return;
        setLoaded(true);
        const points = [from.coords, to.coords];
        map.addSource('journey', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points } } });
        map.addLayer({ id: 'journey-outline', type: 'line', source: 'journey', paint: { 'line-color': '#ffffff', 'line-width': 7 } });
        map.addLayer({ id: 'journey-line', type: 'line', source: 'journey', paint: { 'line-color': '#244f45', 'line-width': 3, 'line-dasharray': [2, 1] } });
        ([trip.from, trip.to] as const).forEach((code, i) => {
          const el = document.createElement('button'); el.type = 'button'; el.className = 'wl-map-marker'; el.textContent = code; el.setAttribute('aria-label', `${stations[code].city}: ${stations[code].name}`);
          const content = document.createElement('div'); const title = document.createElement('strong'); title.textContent = stations[code].city; const info = document.createElement('p'); info.textContent = stations[code].name; const direction = document.createElement('a'); direction.textContent = 'Open station directions ↗'; direction.target = '_blank'; direction.rel = 'noreferrer'; direction.href = `https://www.openstreetmap.org/directions?to=${stations[code].coords[1]}%2C${stations[code].coords[0]}`; content.append(title, info, direction);
          const popup = new lib.Popup({ offset: 22 }).setDOMContent(content);
          const marker = new lib.Marker({ element: el }).setLngLat(stations[code].coords).setPopup(popup).addTo(map);
          el.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); marker.togglePopup(); } });
          if (i === 0) el.classList.add('origin');
        });
        map.fitBounds(points as [[number, number], [number, number]], { padding: large ? 100 : 68, maxZoom: 10, duration: 0 });
      });
    }).catch(() => setError('Interactive map unavailable. Use the station directions below.'));
    return () => { stopped = true; mapRef.current?.remove(); mapRef.current = null; };
  }, [trip.from, trip.to, from, to, large]);
  function fit() { mapRef.current?.fitBounds([from.coords, to.coords], { padding: 68, maxZoom: 10 }); }
  return <div className={`wl-map ${large ? 'large' : ''}`}>
    <div className="wl-map-top"><span><Icon name="globe" size={15}/> Route explorer</span><button title="Fit entire journey" onClick={fit}><Icon name="route" size={16}/></button></div>
    <div className="wl-map-host" ref={host} aria-label={`Interactive map from ${from.city} to ${to.city}`}/>
    {!loaded && !error && <div className="wl-map-loading">Loading your map…</div>}
    {error && <div className="wl-map-error" role="status">{error}</div>}
    <div className="wl-map-bottom"><button onClick={() => { const next = !terrain; setTerrain(next); mapRef.current?.easeTo({ pitch: next ? 48 : 0, bearing: next ? -12 : 0 }); }}>{terrain ? '2D view' : 'Tilt map'} <Icon name="globe" size={14}/></button><span>Indicative connection · not track geometry</span></div>
  </div>;
}
