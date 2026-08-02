import { useEffect, useState } from 'react';
import Map, { Marker } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { adminFetch } from '../lib/supabase';
import { Navigation } from 'lucide-react';

export interface DriverLocation {
    driver_id: string;
    lat: number;
    lng: number;
    heading?: number;
    created_at: string;
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '';
const POLL_MS = 8000;

export function DriverMap({ onLocationsChange }: { onLocationsChange?: (locations: DriverLocation[]) => void }) {
    const [locations, setLocations] = useState<DriverLocation[]>([]);

    useEffect(() => {
        // driver_locations has no admin RLS policy (only a driver reading
        // their own row, or a rider reading their active driver's row) —
        // Realtime subscriptions respect RLS too, so a direct client
        // subscription would silently see nothing. Relay through the admin
        // edge function (service role) and poll instead.
        let cancelled = false;
        const fetchLocations = async () => {
            try {
                const { locations } = await adminFetch('admin', { action: 'list_driver_locations' });
                if (!cancelled) {
                    setLocations(locations || []);
                    onLocationsChange?.(locations || []);
                }
            } catch (err) {
                console.error('[DriverMap] fetch error:', err);
            }
        };
        fetchLocations();
        const interval = setInterval(fetchLocations, POLL_MS);
        return () => { cancelled = true; clearInterval(interval); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!MAPBOX_TOKEN) {
        return (
            <div style={{
                height: '100%',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#0B0E12',
                gap: '1rem'
            }}>
                <div style={{ color: '#f87171', fontSize: '11px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em' }}>Geospatial Link Offline</div>
                <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '9px', fontWeight: 700 }}>VERIFY_MAPBOX_TOKEN_IN_ENV</div>
            </div>
        );
    }

    return (
        <Map
            mapboxAccessToken={MAPBOX_TOKEN}
            initialViewState={{
                longitude: -61.39, // Better default for TT
                latitude: 10.65,
                zoom: 10
            }}
            style={{ width: '100%', height: '100%' }}
            mapStyle="mapbox://styles/mapbox/dark-v11"
        >
            {locations.map(loc => (
                <Marker
                    key={loc.driver_id}
                    longitude={loc.lng}
                    latitude={loc.lat}
                >
                    <div
                        style={{
                            background: 'linear-gradient(135deg, #A78BFA, #7DD3FC)',
                            borderRadius: '50%',
                            padding: '8px',
                            boxShadow: '0 0 20px rgba(167, 139, 250, 0.5)',
                            border: '2px solid #fff',
                            transform: `rotate(${(loc.heading || 0) - 45}deg)`,
                            transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
                        }}
                    >
                        <Navigation style={{ width: '16px', height: '16px', color: '#07050f' }} />
                    </div>
                </Marker>
            ))}
        </Map>
    );
}
