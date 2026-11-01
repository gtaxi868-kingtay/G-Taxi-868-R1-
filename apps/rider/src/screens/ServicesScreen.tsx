import React from 'react';
import { View } from 'react-native';
import { KeyTile } from '../components/KeyTile';
import { toast } from '../components/Toast';
import { SERVICE_COLORS, SERVICE_ROUTES, useServices } from '../hooks/useServices';
import type { TabScreenProps } from '../navigation/types';
import { Loading, Pop, Progress, Screen, Section, SPACE, Txt, useTheme } from '../ui/kit';

// Everything G 868 can do for this rider, as big keys. Same unlock rules as the
// Home sheet (useServices), so a service never shows here but not there.
export function ServicesScreen({ navigation }: TabScreenProps<'Services'>) {
    const m = useTheme();
    const { layers, loading } = useServices('Get a taxi anywhere');
    const open = layers.filter(l => !l.locked);
    const locked = layers.find(l => l.locked);

    const go = (id: string) => {
        // Booking a ride starts on the map, where pickup and "Where to?" live.
        if (id === 'ride') { navigation.navigate('Map'); return; }
        const route = SERVICE_ROUTES[id];
        if (route) (navigation.navigate as any)(route);
    };

    return (
        <Screen title="Services">
            <Txt variant="hero">What do you need?</Txt>
            <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs }}>Rides, food, groceries and more, all on one island app.</Txt>

            {loading && open.length <= 1 ? <View style={{ height: 160 }}><Loading /></View> : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: SPACE.xl, marginHorizontal: -SPACE.xs }}>
                    {open.map((l, i) => (
                        <Pop key={l.id} delay={i * 45} style={{ width: '50%', paddingHorizontal: SPACE.xs, marginBottom: SPACE.md }}>
                            <KeyTile
                                size="wide"
                                title={l.name}
                                subtitle={l.sub}
                                icon={(l.id === 'ride' ? 'car-sport' : (l.icon || 'apps').replace('-sharp', '')) as any}
                                color={SERVICE_COLORS[l.id] || '#8B7CFF'}
                                onPress={() => go(l.id)}
                            />
                        </Pop>
                    ))}
                </View>
            )}

            {locked ? (
                <Section title="Coming up next">
                    <Pop delay={200}>
                        <KeyTile
                            size="wide"
                            locked
                            title={locked.name}
                            subtitle={locked.label || `Keep riding to unlock ${locked.name}`}
                            icon="lock-closed"
                            color={m.key === 'night' ? '#4A4058' : '#B9AFC9'}
                            onPress={() => toast(locked.label || `Keep riding to unlock ${locked.name}`)}
                        />
                        <View style={{ marginTop: SPACE.sm }}>
                            <Progress value={(locked.progress ?? 0) / Math.max(1, locked.need ?? 1)} color="#FFB020" />
                        </View>
                    </Pop>
                </Section>
            ) : null}
        </Screen>
    );
}
