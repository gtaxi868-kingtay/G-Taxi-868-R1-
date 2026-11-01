import React from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../components/ui/text';
import { toast } from '../../components/Toast';

// DESIGN SAMPLE (2026-10-24): the rider home rebuilt on NativeWind + the
// Reusables-style components, for the founder to judge the look before the
// real screens are redone. Static map image stands in for the live map.
// Open on web at /design-preview. Not wired into navigation.

const MAPBOX = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || '';
const MAP_URL = `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/-61.5115,10.6596,14.2,0/600x760@2x?access_token=${MAPBOX}&attribution=false&logo=false`;

const SAVED = [
    { icon: 'home' as const, label: 'Home' },
    { icon: 'briefcase' as const, label: 'Work' },
    { icon: 'airplane' as const, label: 'Piarco' },
];

const RECENT = [
    { title: 'Trincity Mall', sub: 'Churchill Roosevelt Hwy, Trincity' },
    { title: 'Queen\'s Park Savannah', sub: 'Port of Spain' },
];

const SERVICES = [
    { icon: 'car-sport' as const, label: 'Ride' },
    { icon: 'basket' as const, label: 'Groceries' },
    { icon: 'shirt' as const, label: 'Laundry' },
    { icon: 'airplane' as const, label: 'Escape' },
];

function IconButton({ name, label }: { name: keyof typeof Ionicons.glyphMap; label: string }) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => toast(label)}
            className="h-11 w-11 items-center justify-center rounded-full bg-sheet/90 active:opacity-80"
        >
            <Ionicons name={name} size={20} color="#F7F2EC" />
        </Pressable>
    );
}

export function HomePreview() {
    const insets = useSafeAreaInsets();
    return (
        <View className="flex-1 bg-bg">
            {/* Map */}
            <Image source={{ uri: MAP_URL }} resizeMode="cover" className="absolute left-0 right-0 top-0 h-[58%]" />
            {/* Warm the cold map: a soft plum wash, darker at the top and bottom */}
            <View className="absolute left-0 right-0 top-0 h-[58%]" style={{ backgroundColor: 'rgba(70,36,90,0.22)' }} />
            <LinearGradient
                colors={['rgba(13,11,17,0.9)', 'rgba(13,11,17,0)']}
                style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 150 }}
            />

            {/* Top bar */}
            <View className="flex-row items-center justify-between px-5" style={{ paddingTop: insets.top + 12 }}>
                <IconButton name="menu" label="Menu" />
                <View className="flex-row items-center rounded-full bg-sheet/90 px-4 py-2">
                    <View className="mr-2 h-2 w-2 rounded-full bg-safe" />
                    <Text variant="caption" className="text-ink">3 G drivers nearby</Text>
                </View>
                <IconButton name="person" label="Account" />
            </View>

            {/* Pickup pin */}
            <View className="absolute left-0 right-0 items-center" style={{ top: '10%' }}>
                <View className="mb-2 rounded-full bg-sheet px-3 py-1.5">
                    <Text variant="caption" className="text-ink">Pickup · Woodford Square</Text>
                </View>
                <View className="h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: 'rgba(139,124,255,0.18)' }}>
                    <LinearGradient colors={['#8B7CFF', '#3FD9E8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                        style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2.5, borderColor: '#F7F2EC',
                            shadowColor: '#8B7CFF', shadowOpacity: 0.9, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } }} />
                </View>
            </View>

            {/* Bottom sheet */}
            <View
                className="absolute bottom-0 left-0 right-0 rounded-t-sheet bg-sheet px-5 pt-3"
                style={{ paddingBottom: insets.bottom + 16, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: -6 }, elevation: 24 }}
            >
                <View className="mb-4 h-1 w-10 self-center rounded-full bg-line" />

                <Text variant="greeting">Good evening, Gershwane</Text>
                <Text variant="body" className="mb-4 mt-1 text-dim">Where can we take you tonight?</Text>

                {/* Search */}
                <Pressable
                    accessibilityRole="search"
                    onPress={() => toast('Search destination')}
                    className="h-14 flex-row items-center rounded-full bg-raised pl-5 pr-1.5 active:opacity-90"
                >
                    <Ionicons name="search" size={20} color="#B9AEFF" />
                    <Text variant="headline" className="ml-3 flex-1 text-ink">Where to?</Text>
                    <View className="h-11 flex-row items-center rounded-full bg-sheet px-4">
                        <Ionicons name="time-outline" size={16} color="#F7F2EC" />
                        <Text variant="body" className="ml-1.5 font-semibold">Now</Text>
                        <Ionicons name="chevron-down" size={14} color="rgba(247,242,236,0.66)" style={{ marginLeft: 4 }} />
                    </View>
                </Pressable>

                {/* Saved places */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3 -mx-5" contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
                    {SAVED.map((s) => (
                        <Pressable key={s.label} onPress={() => toast(s.label)} className="h-10 flex-row items-center rounded-full border border-line px-4 active:opacity-80">
                            <Ionicons name={s.icon} size={15} color="#F7F2EC" />
                            <Text variant="body" className="ml-2 font-semibold">{s.label}</Text>
                        </Pressable>
                    ))}
                </ScrollView>

                {/* Recent */}
                <View className="mt-4">
                    {RECENT.map((r, i) => (
                        <Pressable key={r.title} onPress={() => toast(r.title)} className={`flex-row items-center py-3 active:opacity-80 ${i > 0 ? 'border-t border-line' : ''}`}>
                            <View className="h-10 w-10 items-center justify-center rounded-full bg-raised">
                                <Ionicons name="time" size={18} color="rgba(247,242,236,0.66)" />
                            </View>
                            <View className="ml-3 flex-1">
                                <Text variant="headline">{r.title}</Text>
                                <Text variant="caption">{r.sub}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={16} color="rgba(247,242,236,0.42)" />
                        </Pressable>
                    ))}
                </View>

                {/* Services */}
                <View className="mt-3 flex-row justify-between">
                    {SERVICES.map((s, i) => (
                        <Pressable key={s.label} onPress={() => toast(s.label)} className="w-[23%] items-center active:opacity-80">
                            {i === 0 ? (
                                <LinearGradient colors={['#8B7CFF', '#3FD9E8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                                    style={{ height: 56, width: '100%', borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
                                    <Ionicons name={s.icon} size={22} color="#F7F2EC" />
                                </LinearGradient>
                            ) : (
                                <View className="h-14 w-full items-center justify-center rounded-card bg-surface">
                                    <Ionicons name={s.icon} size={22} color="#F7F2EC" />
                                </View>
                            )}
                            <Text variant="caption" className="mt-1.5 text-ink">{s.label}</Text>
                        </Pressable>
                    ))}
                </View>

                {/* Safety */}
                <View className="mt-4 flex-row items-center rounded-card border border-line bg-surface px-4 py-3">
                    <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: 'rgba(91,216,160,0.14)' }}>
                        <Ionicons name="shield-checkmark" size={18} color="#5BD8A0" />
                    </View>
                    <View className="ml-3 flex-1">
                        <Text variant="body" className="font-semibold">Verified drivers, every ride</Text>
                        <Text variant="caption">G Guardian watches over you, day and night</Text>
                    </View>
                    <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: 'rgba(91,216,160,0.14)' }}>
                        <Text className="font-bold text-[11px] text-safe">24/7</Text>
                    </View>
                </View>
            </View>
        </View>
    );
}
