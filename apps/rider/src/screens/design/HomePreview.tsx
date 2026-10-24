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
            <Ionicons name={name} size={20} color="#F5F5F7" />
        </Pressable>
    );
}

export function HomePreview() {
    const insets = useSafeAreaInsets();
    return (
        <View className="flex-1 bg-bg">
            {/* Map */}
            <Image source={{ uri: MAP_URL }} resizeMode="cover" className="absolute left-0 right-0 top-0 h-[58%]" />
            <LinearGradient
                colors={['rgba(10,10,15,0.85)', 'rgba(10,10,15,0)']}
                style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 140 }}
            />

            {/* Top bar */}
            <View className="flex-row items-center justify-between px-5" style={{ paddingTop: insets.top + 12 }}>
                <IconButton name="menu" label="Menu" />
                <View className="flex-row items-center rounded-full bg-sheet/90 px-4 py-2">
                    <View className="mr-2 h-2 w-2 rounded-full bg-safe" />
                    <Text variant="caption" className="text-ink">3 drivers nearby</Text>
                </View>
                <IconButton name="person" label="Account" />
            </View>

            {/* Pickup pin */}
            <View className="absolute left-0 right-0 items-center" style={{ top: '27%' }}>
                <View className="mb-2 rounded-full bg-sheet px-3 py-1.5">
                    <Text variant="caption" className="text-ink">Pickup · Woodford Square</Text>
                </View>
                <View className="h-7 w-7 items-center justify-center rounded-full bg-brand/30">
                    <View className="h-3.5 w-3.5 rounded-full border-2 border-ink bg-brand" />
                </View>
            </View>

            {/* Bottom sheet */}
            <View
                className="absolute bottom-0 left-0 right-0 rounded-t-sheet bg-sheet px-5 pt-3"
                style={{ paddingBottom: insets.bottom + 16, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: -6 }, elevation: 24 }}
            >
                <View className="mb-4 h-1 w-10 self-center rounded-full bg-line" />

                <Text variant="caption">Good evening</Text>
                <Text variant="display" className="mb-4 mt-0.5">Where to?</Text>

                {/* Search */}
                <Pressable
                    accessibilityRole="search"
                    onPress={() => toast('Search destination')}
                    className="h-14 flex-row items-center rounded-full bg-raised pl-5 pr-1.5 active:opacity-90"
                >
                    <Ionicons name="search" size={20} color="rgba(245,245,247,0.62)" />
                    <Text variant="body" className="ml-3 flex-1 text-dim">Search destination</Text>
                    <View className="h-11 flex-row items-center rounded-full bg-sheet px-4">
                        <Ionicons name="time-outline" size={16} color="#F5F5F7" />
                        <Text variant="body" className="ml-1.5 font-semibold">Now</Text>
                        <Ionicons name="chevron-down" size={14} color="rgba(245,245,247,0.62)" style={{ marginLeft: 4 }} />
                    </View>
                </Pressable>

                {/* Saved places */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3 -mx-5" contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
                    {SAVED.map((s) => (
                        <Pressable key={s.label} onPress={() => toast(s.label)} className="h-10 flex-row items-center rounded-full border border-line px-4 active:opacity-80">
                            <Ionicons name={s.icon} size={15} color="#F5F5F7" />
                            <Text variant="body" className="ml-2 font-semibold">{s.label}</Text>
                        </Pressable>
                    ))}
                </ScrollView>

                {/* Recent */}
                <View className="mt-4">
                    {RECENT.map((r, i) => (
                        <Pressable key={r.title} onPress={() => toast(r.title)} className={`flex-row items-center py-3 active:opacity-80 ${i > 0 ? 'border-t border-line' : ''}`}>
                            <View className="h-10 w-10 items-center justify-center rounded-full bg-raised">
                                <Ionicons name="time" size={18} color="rgba(245,245,247,0.62)" />
                            </View>
                            <View className="ml-3 flex-1">
                                <Text variant="headline">{r.title}</Text>
                                <Text variant="caption">{r.sub}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={16} color="rgba(245,245,247,0.40)" />
                        </Pressable>
                    ))}
                </View>

                {/* Services */}
                <View className="mt-3 flex-row justify-between">
                    {SERVICES.map((s, i) => (
                        <Pressable key={s.label} onPress={() => toast(s.label)} className="w-[23%] items-center active:opacity-80">
                            <View className={`h-14 w-full items-center justify-center rounded-card ${i === 0 ? 'bg-brand-soft' : 'bg-surface'}`}>
                                <Ionicons name={s.icon} size={22} color={i === 0 ? '#8B7CFF' : '#F5F5F7'} />
                            </View>
                            <Text variant="caption" className="mt-1.5 text-ink">{s.label}</Text>
                        </Pressable>
                    ))}
                </View>

                {/* Safety */}
                <View className="mt-4 flex-row items-center justify-center">
                    <Ionicons name="shield-checkmark" size={14} color="#3DDC97" />
                    <Text variant="caption" className="ml-1.5">G Guardian is on for every ride</Text>
                </View>
            </View>
        </View>
    );
}
