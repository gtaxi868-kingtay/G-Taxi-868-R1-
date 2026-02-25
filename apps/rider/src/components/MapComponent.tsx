import React from 'react';
import { StyleSheet, View, Text, ActivityIndicator } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { darkMapStyle } from '../config/mapStyle';
import { GlassView } from './GlassView';
import { theme } from '../theme';

import { Image } from 'react-native';

interface Driver {
    id: string;
    lat: number;
    lng: number;
    heading: number;
}

interface MapComponentProps {
    location: any; // Using any for LocationObject to avoid import issues
    loading: boolean;
    currentLat: number;
    currentLng: number;
    drivers?: Driver[];
}

export function MapComponent({ location, loading, currentLat, currentLng, drivers = [] }: MapComponentProps) {
    if (!location) return null;

    return (
        <View style={styles.container}>
            <MapView
                style={styles.map}
                customMapStyle={darkMapStyle}
                provider={PROVIDER_GOOGLE}
                showsUserLocation={true}
                showsCompass={false}
                showsMyLocationButton={false}
                initialRegion={{
                    latitude: currentLat,
                    longitude: currentLng,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                }}
            >
                {/* Render Ghost Drivers */}
                {drivers.map(driver => (
                    <Marker
                        key={driver.id}
                        coordinate={{ latitude: driver.lat, longitude: driver.lng }}
                        rotation={driver.heading}
                        anchor={{ x: 0.5, y: 0.5 }}
                    >
                        <View style={styles.driverMarkerContainer}>
                            <Image
                                source={require('../../assets/logo.png')}
                                style={styles.driverIcon}
                                resizeMode="contain"
                            />
                        </View>
                    </Marker>
                ))}
            </MapView>

            {loading && (
                <GlassView style={styles.loaderOverlay} intensity="light">
                    <ActivityIndicator size="large" color={theme.colors.brand.primary} />
                </GlassView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        borderRadius: theme.borderRadius.xxl,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
    },
    map: {
        width: '100%',
        height: '100%',
    },
    loaderOverlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
    },
    driverMarkerContainer: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
        // Add a subtle glow/shadow to make it pop on the dark map
        shadowColor: theme.colors.brand.primary,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 5,
    },
    driverIcon: {
        width: 32,
        height: 32,
    },
});
