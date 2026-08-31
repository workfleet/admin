'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// Leaflet's default marker image paths don't resolve correctly through
// bundlers unless pointed at the bundled asset URLs explicitly.
const defaultIcon = L.icon({ iconUrl: markerIcon.src || markerIcon, shadowUrl: markerShadow.src || markerShadow, iconAnchor: [12, 41] });

// Loaded via next/dynamic({ ssr: false }) wherever it's used — Leaflet
// touches `window` at load time and can't run during server rendering.
// `height` and `showDirections` let the cleaner's job screen use the map as a
// 132px band with its own Directions chip laid over it, while the emergency
// location page keeps the taller map and the button underneath.
export default function PropertyMap({ lat, lng, address, height = 160, showDirections = true }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (lat == null || lng == null || !containerRef.current) return;

    const map = L.map(containerRef.current, { zoomControl: false, attributionControl: true }).setView([lat, lng], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    L.marker([lat, lng], { icon: defaultIcon }).addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lng]);

  if (lat == null || lng == null) return null;

  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

  return (
    <div style={{ height: showDirections ? undefined : '100%' }}>
      <div
        ref={containerRef}
        style={{
          height: showDirections ? height : '100%',
          borderRadius: showDirections ? 10 : 0,
          overflow: 'hidden',
          marginBottom: showDirections ? 10 : 0,
        }}
      />
      {showDirections && (
        <a href={directionsUrl} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
          <button type="button" style={{ width: '100%' }}>Get Directions</button>
        </a>
      )}
    </div>
  );
}
