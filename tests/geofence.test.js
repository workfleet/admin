import { describe, it, expect } from 'vitest';
import { geofenceRadiusFor, GEOFENCE_RADIUS_METERS } from '../lib/geo';

// The radius decides whether somebody standing at the door is allowed to
// start their shift. A property's own value has to win, and anything that
// is not a real value has to fall back rather than shrink the fence to 0.

describe('geofenceRadiusFor', () => {
  it('uses the default when a property has no radius of its own', () => {
    expect(geofenceRadiusFor({ lat: 1, lng: 2 })).toBe(GEOFENCE_RADIUS_METERS);
    expect(geofenceRadiusFor({ geofence_radius_m: null })).toBe(GEOFENCE_RADIUS_METERS);
    expect(geofenceRadiusFor(null)).toBe(GEOFENCE_RADIUS_METERS);
  });

  it('uses the property radius when set', () => {
    expect(geofenceRadiusFor({ geofence_radius_m: 300 })).toBe(300);
    expect(geofenceRadiusFor({ geofence_radius_m: '120' })).toBe(120);
  });

  it('never returns a fence of zero or less', () => {
    expect(geofenceRadiusFor({ geofence_radius_m: 0 })).toBe(GEOFENCE_RADIUS_METERS);
    expect(geofenceRadiusFor({ geofence_radius_m: -5 })).toBe(GEOFENCE_RADIUS_METERS);
    expect(geofenceRadiusFor({ geofence_radius_m: 'wide' })).toBe(GEOFENCE_RADIUS_METERS);
  });
});
