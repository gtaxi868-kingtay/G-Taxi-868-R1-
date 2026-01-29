import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { theme } from '../theme';

interface Driver {
    id: string;
    lat: number;
    lng: number;
    heading: number;
}

interface MapComponentProps {
    location: any;
    loading: boolean;
    currentLat: number;
    currentLng: number;
    drivers?: Driver[];
}

const LEAFLET_HTML = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        body { margin: 0; padding: 0; background: #000; }
        #map { width: 100vw; height: 100vh; }
        .leaflet-control-attribution { opacity: 0.5; background: transparent !important; color: #888; }
        
        .driver-icon {
            font-size: 24px;
            text-align: center;
            line-height: 24px;
            filter: drop-shadow(0 0 5px #00BFA5);
            transition: all 0.5s linear;
        }
    </style>
</head>
<body>
    <div id="map"></div>
    <script>
        // Init Map
        const map = L.map('map', { zoomControl: false }).setView([__LAT__, __LNG__], 15);

        // CartoDB Dark Matter Tiles (Cyberpunk Style)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap &copy; CARTO',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(map);

        // Custom Blue Dot Marker (User)
        const userIcon = L.divIcon({
            className: 'custom-div-icon',
            html: "<div style='background-color:#00BFA5;width:12px;height:12px;border-radius:50%;box-shadow:0 0 10px #00BFA5;border:2px solid #fff;'></div>",
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });

        L.marker([__LAT__, __LNG__], { icon: userIcon }).addTo(map);

        // Ghost Drivers
        const drivers = __DRIVERS__;
        
        const driverIcon = L.divIcon({
            className: 'driver-div-icon',
            html: "<div class='driver-icon'>🚗</div>",
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });

        drivers.forEach(driver => {
            // Create rotated marker using CSS transform in the icon html if needed, 
            // but for emoji simple rotation is enough or just static
            L.marker([driver.lat, driver.lng], { icon: driverIcon }).addTo(map);
        });
    </script>
</body>
</html>
`;

export function MapComponent({ currentLat, currentLng, drivers = [] }: MapComponentProps) {
    // Inject current coordinates and drivers into the HTML
    const htmlContent = LEAFLET_HTML
        .replace(/__LAT__/g, currentLat.toString())
        .replace(/__LNG__/g, currentLng.toString())
        .replace('__DRIVERS__', JSON.stringify(drivers));

    return (
        <View style={styles.container}>
            <iframe
                srcDoc={htmlContent}
                style={{ width: '100%', height: '100%', border: 'none' }}
                title="G-Taxi Map"
            />
            {/* Overlay hint for interactivity if needed */}
            <View style={{ position: 'absolute', bottom: 10, right: 10, pointerEvents: 'none' }}>
                <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>G-TAXI WEB MAP</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
        borderRadius: theme.borderRadius.xxl,
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
        overflow: 'hidden', // Essential for iframe
    },
});
