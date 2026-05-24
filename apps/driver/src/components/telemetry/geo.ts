export function decodePolyline(encoded: string) {
  if (!encoded) return [];
  const points: { latitude: number; longitude: number }[] = [];
  let idx = 0, lat = 0, lng = 0;
  while (idx < encoded.length) {
    let b, shift = 0, res = 0;
    do { b = encoded.charCodeAt(idx++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += ((res & 1) ? ~(res >> 1) : (res >> 1));
    shift = 0; res = 0;
    do { b = encoded.charCodeAt(idx++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += ((res & 1) ? ~(res >> 1) : (res >> 1));
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

export function haversineKm(coords: { latitude: number; longitude: number }[]) {
  if (coords.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i];
    const dLat = (b.latitude - a.latitude) * Math.PI / 180;
    const dLng = (b.longitude - a.longitude) * Math.PI / 180;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    total += 2 * 6371000 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }
  return total / 1000;
}

export function riderDisplayName(rider: { name?: string; full_name?: string; raw_user_meta_data?: { name?: string } } | null | undefined): string {
  return rider?.name || rider?.raw_user_meta_data?.name || rider?.full_name || 'Rider';
}

export function etaMinutes(speedKmh: number, distanceKm: number): number {
  return speedKmh > 1 ? Math.round(distanceKm / speedKmh * 60) : distanceKm < 1 ? 1 : 5;
}
