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
//
// `editable` makes the marker draggable (and the map clickable) and reports
// the new position through `onMove`, for the office correcting a pin the
// address lookup put in the wrong place (0089). `radius` draws the geofence
// so what "too far" means is visible while it is being adjusted. `extra`
// marks other points of interest - a cleaner's proposed pin, say - without
// making them the pin.
export default function PropertyMap({
  lat, lng, address, height = 160, showDirections = true,
  editable = false, onMove, radius, extra = [],
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const circleRef = useRef(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  useEffect(() => {
    if (lat == null || lng == null || !containerRef.current) return;

    const map = L.map(containerRef.current, { zoomControl: editable, attributionControl: true }).setView([lat, lng], editable ? 17 : 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const marker = L.marker([lat, lng], { icon: defaultIcon, draggable: editable }).addTo(map);
    markerRef.current = marker;

    if (radius) {
      circleRef.current = L.circle([lat, lng], { radius, color: '#1F6FEF', weight: 1, fillOpacity: 0.08 }).addTo(map);
    }

    (extra || []).forEach((pt) => {
      if (pt.lat == null || pt.lng == null) return;
      L.circleMarker([pt.lat, pt.lng], { radius: 7, color: '#D81E34', weight: 2, fillOpacity: 0.6 })
        .addTo(map)
        .bindTooltip(pt.label || 'Proposed pin', { permanent: false });
    });

    if (editable) {
      const report = (latlng) => {
        marker.setLatLng(latlng);
        if (circleRef.current) circleRef.current.setLatLng(latlng);
        onMoveRef.current?.({ lat: latlng.lat, lng: latlng.lng });
      };
      marker.on('dragend', () => report(marker.getLatLng()));
      map.on('click', (e) => report(e.latlng));
    }

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
    // The map is built once per pin; a radius change while editing is
    // applied below without rebuilding it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, editable]);

  useEffect(() => {
    if (circleRef.current && radius) circleRef.current.setRadius(radius);
  }, [radius]);

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
