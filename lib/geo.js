// Straight-line distance between two lat/lng points, via the haversine
// formula. Good enough for a geofence check at this radius — no need for
// road-distance accuracy.
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const GEOFENCE_RADIUS_METERS = 75;

// The radius that applies to one property: its own, if the office has set
// one (properties.geofence_radius_m, 0089 - a school, a farm, an industrial
// unit with the gate a long way from the door), otherwise the default.
export function geofenceRadiusFor(property) {
  const own = Number(property?.geofence_radius_m);
  return Number.isFinite(own) && own > 0 ? own : GEOFENCE_RADIUS_METERS;
}
