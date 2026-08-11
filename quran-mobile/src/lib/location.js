// Resolve device coordinates for prayer times / Qibla. Falls back to a sensible
// default (Kuala Lumpur) if permission is denied or location is unavailable, so
// the prayer-times screen always has something to show.
import * as Location from 'expo-location';

export const FALLBACK = {
  name: 'Kuala Lumpur',
  latitude: 3.139,
  longitude: 101.6869,
};

export async function getCoordinates() {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return { ...FALLBACK, approximate: true };

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const { latitude, longitude } = pos.coords;

    // Best-effort reverse geocode for a friendly label; ignore failures.
    let name = 'Current location';
    try {
      const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (place) name = place.city || place.subregion || place.region || name;
    } catch {
      /* keep generic label */
    }
    return { name, latitude, longitude, approximate: false };
  } catch {
    return { ...FALLBACK, approximate: true };
  }
}
