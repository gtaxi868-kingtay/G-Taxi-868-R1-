import React, { useState, useEffect } from 'react';
import {
    View,
    StyleSheet,
    TouchableOpacity,
    SafeAreaView,
    FlatList,
    Alert,
    Dimensions,
    ActivityIndicator,
    Platform
} from 'react-native';
import { supabase } from '../../../../shared/supabase';
import { useAuth } from '../context/AuthContext';
import { theme } from '../theme';
import { Surface, Txt, Card, Btn } from '../design-system/primitives';
import { tokens } from '../design-system/tokens';

const { width } = Dimensions.get('window');

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
        if (user) {
            fetchSavedPlaces();
        }
    }, [user]);

    const fetchSavedPlaces = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('saved_places')
                .select('*')
                .eq('user_id', user?.id)
                .order('created_at', { ascending: true });

            if (error) throw error;
            setPlaces(data || []);
        } catch (error: any) {
            console.error('Error fetching saved places:', error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDeletePlace = async (id: string, label: string) => {
        Alert.alert(
            'Delete Saved Place',
            `Are you sure you want to remove "${label}"?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        const { error } = await supabase
                            .from('saved_places')
                            .delete()
                            .eq('id', id);

                        if (error) {
                            Alert.alert('Error', 'Could not delete place');
                        } else {
                            setPlaces(prev => prev.filter(p => p.id !== id));
                        }
                    }
                }
            ]
        );
    };

    const renderItem = ({ item }: { item: SavedPlace }) => (
        <Card style={styles.placeCard} padding="md" radius="l">
            <View style={styles.placeContent}>
                <Surface style={styles.iconCircle} intensity={15}>
                    <Txt style={{ fontSize: 20 }}>{item.icon || '📍'}</Txt>
                </Surface>
                <View style={styles.placeInfo}>
                    <Txt variant="bodyBold">{item.label}</Txt>
                    <Txt variant="small" color={tokens.colors.text.secondary} numberOfLines={1}>
                        {item.address}
                    </Txt>
                </View>
            </View>
            <TouchableOpacity
                onPress={() => handleDeletePlace(item.id, item.label)}
                style={styles.deleteBtn}
            >
                <Txt style={{ color: tokens.colors.status.error, fontSize: 18 }}>✕</Txt>
            </TouchableOpacity>
        </Card>
    );

    return (
        <View style={styles.container}>
            <SafeAreaView style={{ flex: 1 }}>
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                        <Surface style={styles.backSurf} intensity={20}>
                            <Txt variant="headingM">←</Txt>
                        </Surface>
                    </TouchableOpacity>
                    <Txt variant="headingL" weight="bold">Saved Places</Txt>
                </View>

                {loading ? (
                    <View style={styles.center}>
                        <ActivityIndicator color={tokens.colors.primary.purple} size="large" />
                    </View>
                ) : (
                    <FlatList
                        data={places}
                        keyExtractor={item => item.id}
                        renderItem={renderItem}
                        contentContainerStyle={styles.list}
                        ListEmptyComponent={
                            <View style={[styles.center, { marginTop: 60 }]}>
                                <Txt variant="bodyReg" color={tokens.colors.text.secondary} center>
                                    You haven't saved any places yet.{"\n"}Save Home or Work for faster booking.
                                </Txt>
                            </View>
                        }
                    />
                )}

                {/* Add New Button */}
                <View style={styles.footer}>
                    <Btn
                        title="+ Add Saved Place"
                        onPress={() => navigation.navigate('DestinationSearch', { mode: 'save' })}
                        variant="primary"
                        fullWidth
                    />
                </View>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: tokens.colors.background.base,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 20,
    },
    backBtn: {
        marginRight: 16,
    },
    backSurf: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    list: {
        padding: 20,
    },
    placeCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    placeContent: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    iconCircle: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    placeInfo: {
        flex: 1,
    },
    deleteBtn: {
        padding: 8,
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    footer: {
        padding: 24,
        paddingBottom: Platform.OS === 'ios' ? 0 : 24,
    }
});
