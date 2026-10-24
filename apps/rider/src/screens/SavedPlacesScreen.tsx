import React, { useState, useEffect } from 'react';
import { Alert, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { Button, Card, EmptyState, Loading, Row, Screen, SPACE } from '../ui/kit';

interface SavedPlace {
    id: string;
    label: string;
    address: string;
    latitude: number;
    longitude: number;
    icon: string;
}

export function SavedPlacesScreen({ navigation }: any) {
    const { user } = useAuth();

    const [places, setPlaces] = useState<SavedPlace[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user) fetchSavedPlaces();
        // Reload when coming back from "Add new place".
        const unsub = navigation.addListener('focus', () => { if (user) fetchSavedPlaces(); });
        return unsub;
    }, [user, navigation]);

    const fetchSavedPlaces = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('saved_places')
                .select('*')
                .eq('user_id', user?.id)
                .order('created_at', { ascending: true });

            if (data) setPlaces(data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = (id: string, label: string) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        Alert.alert(
            'Remove this place?',
            `"${label}" will be removed from your saved places.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        const { error } = await supabase.from('saved_places').delete().eq('id', id);
                        if (error) {
                            Alert.alert('Could not delete', 'Please try again.');
                            return;
                        }
                        setPlaces(prev => prev.filter(p => p.id !== id));
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    }
                }
            ]
        );
    };

    const iconFor = (label: string) => label === 'Home' ? 'home-outline' : label === 'Work' ? 'briefcase-outline' : 'bookmark-outline';

    return (
        <Screen
            title="Saved places"
            onBack={() => navigation.goBack()}
            footer={<Button title="Add a place" icon="add" onPress={() => { Haptics.selectionAsync(); navigation.navigate('DestinationSearch', { saveMode: true }); }} />}
        >
            {loading ? <Loading /> : places.length === 0 ? (
                <EmptyState icon="bookmark-outline" title="No saved places yet" body="Save Home, Work or any spot you go often, then book it in one tap." />
            ) : (
                <Card style={{ paddingVertical: SPACE.xs }}>
                    {places.map((item, i) => (
                        <Row key={item.id} icon={iconFor(item.label) as any} title={item.label} subtitle={item.address} last={i === places.length - 1}
                            right={
                                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.label}`} hitSlop={10} onPress={() => handleDelete(item.id, item.label)}>
                                    <Ionicons name="trash-outline" size={20} color="#E5484D" />
                                </Pressable>
                            }
                        />
                    ))}
                </Card>
            )}
        </Screen>
    );
}
