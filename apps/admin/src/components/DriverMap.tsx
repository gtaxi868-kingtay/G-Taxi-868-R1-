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
            <div className="w-full h-96 bg-slate-100 rounded-xl flex items-center justify-center border border-slate-200">
                <p className="text-slate-500 font-medium">Mapbox token not found in environment.</p>
            </div>
        );
    }

    return (
        <div className="w-full h-96 rounded-xl overflow-hidden shadow-inner border border-slate-200">
            <Map
                mapboxAccessToken={MAPBOX_TOKEN}
                initialViewState={{
                    longitude: -61.2225, // Port of Spain default
                    latitude: 10.6500,
                    zoom: 11
                }}
                mapStyle="mapbox://styles/mapbox/dark-v11"
            >
                {locations.map(loc => (
                    <Marker
                        key={loc.driver_id}
                        longitude={loc.longitude}
                        latitude={loc.latitude}
                    >
                        <div
                            className="bg-indigo-500 rounded-full p-2 shadow-lg border-2 border-white"
                            style={{ transform: `rotate(${loc.heading || 0}deg)` }}
                        >
                            <Navigation className="w-4 h-4 text-white" />
                        </div>
                    </Marker>
                ))}
            </Map>
        </div>
    );
}
