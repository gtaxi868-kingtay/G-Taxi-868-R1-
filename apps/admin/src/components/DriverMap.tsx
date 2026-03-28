import { useEffect, useState } from 'react';
import Map, { Marker } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '../lib/supabase';
import { Navigation } from 'lucide-react';

interface DriverLocation {
    driver_id: string;
    latitude: number;
    longitude: number;
    heading?: number;
    updated_at: string;
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '';

export function DriverMap() {
    const [locations, setLocations] = useState<DriverLocation[]>([]);

    useEffect(() => {
        // Initial fetch
        const fetchLocations = async () => {
            const { data } = await supabase
                .from('driver_locations')
                .select('*');
            if (data) setLocations(data);
        };
        fetchLocations();

        // Subscribe to real-time updates
        const channel = supabase.channel('driver-locations')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'driver_locations' },
                (payload: any) => {
                    const newLoc = payload.new as DriverLocation;
                    setLocations(prev => {
                        const existing = prev.findIndex(l => l.driver_id === newLoc.driver_id);
                        if (existing >= 0) {
                            const updated = [...prev];
                            updated[existing] = newLoc;
                            return updated;
                        }
                        return [...prev, newLoc];
                    });
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    if (!MAPBOX_TOKEN) {
        return (
            <div style={{ 
                height: '500px', 
                display: 'flex', 
                flexDirection: 'column',
                alignItems: 'center', 
                justifyContent: 'center', 
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                borderRadius: '1.5rem',
                border: '1px dashed rgba(255, 255, 255, 0.1)',
                gap: '1rem'
            }}>
                <div style={{ color: '#f87171', fontSize: '11px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', fontFamily: "'Orbitron', sans-serif" }}>Geospatial Link Offline</div>
                <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '9px', fontWeight: 700 }}>VERIFY_MAPBOX_TOKEN_IN_ENV</div>
            </div>
        );
    }

    return (
        <div style={{ height: '500px', width: '100%', borderRadius: '1.5rem', overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.05)', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
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
                        longitude={loc.longitude}
                        latitude={loc.latitude}
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
        </div>
    );
}
