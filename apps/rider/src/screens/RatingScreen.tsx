import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { processTip } from '../services/api';
import { toast } from '../components/Toast';
import { BRAND_GRADIENT, Button, Chip, Field, Screen, Section, SPACE, Txt } from '../ui/kit';

const LABELS = ['', 'Poor', 'Not great', 'Okay', 'Good', 'Excellent'];

export function RatingScreen({ navigation, route }: any) {
    const { driver, rideId } = route.params || {};

    const [rating, setRating] = useState(5);
    const [comment, setComment] = useState('');
    const [selectedTip, setSelectedTip] = useState(0);
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (submitting) return;
        setSubmitting(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        try {
            const { data: { user } } = await supabase.auth.getUser();

            const [ratingRes, , tipRes] = await Promise.all([
                driver?.id
                    ? supabase.from('ratings').insert({ ride_id: rideId, driver_id: driver.id, rider_id: user?.id, rating, comment })
                    : Promise.resolve({ error: null }),
                supabase.from('rides').update({ rating }).eq('id', rideId),
                selectedTip > 0 ? processTip(rideId, selectedTip * 100) : Promise.resolve({ success: true } as any),
            ]);

            // Inserts return their error instead of throwing; say so instead of
            // pretending everything saved.
            if ((ratingRes as any)?.error) toast('Your rating could not be saved, but your trip is complete.', 'error');
            if (tipRes && (tipRes as any).success === false) toast((tipRes as any).error || 'The tip could not be sent.', 'error');
            else if (selectedTip > 0) toast(`Thanks! Your $${selectedTip} tip was sent.`, 'success');

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            // Pass only the id: the receipt loads the real row itself.
            navigation.navigate('Receipt', { rideId });
        } catch (err) {
            console.error(err);
            toast('Something went wrong. Please try again.', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Screen
            footer={
                <View>
                    <Button title="Done" onPress={handleSubmit} loading={submitting} />
                    <Button title="View receipt" variant="ghost" style={{ marginTop: SPACE.md }} onPress={() => navigation.navigate('Receipt', { rideId })} />
                </View>
            }
        >
            <View style={{ alignItems: 'center', paddingTop: SPACE.xxl }}>
                <View style={{ width: 88, height: 88, borderRadius: 44, overflow: 'hidden' }}>
                    <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                        <Txt variant="hero" tone="onBrand">{driver?.name?.charAt(0) || 'G'}</Txt>
                    </LinearGradient>
                </View>
                <Txt variant="label" tone="accent" style={{ marginTop: SPACE.lg }}>You've arrived</Txt>
                <Txt variant="hero" style={{ textAlign: 'center', marginTop: SPACE.xs }}>How was your ride{driver?.name ? ` with ${driver.name.split(' ')[0]}` : ''}?</Txt>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: SPACE.xl }}>
                {[1, 2, 3, 4, 5].map(v => (
                    <Pressable key={v} accessibilityRole="button" accessibilityLabel={`${v} star${v > 1 ? 's' : ''}`} hitSlop={6}
                        onPress={() => { Haptics.selectionAsync(); setRating(v); }} style={{ paddingHorizontal: 6 }}>
                        <Ionicons name={v <= rating ? 'star' : 'star-outline'} size={40} color={v <= rating ? '#F5A524' : '#B8B0C4'} />
                    </Pressable>
                ))}
            </View>
            <Txt variant="bodyStrong" tone="dim" style={{ textAlign: 'center', marginTop: SPACE.sm }}>{LABELS[rating]}</Txt>

            <Section title="Anything to add? (optional)">
                <Field placeholder="Tell us what went well, or what we can do better" value={comment} onChangeText={setComment} multiline />
            </Section>

            <Section title="Add a tip for your driver">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {[1, 3, 5].map(amt => (
                        <Chip key={amt} label={`$${amt}`} selected={selectedTip === amt} onPress={() => { Haptics.selectionAsync(); setSelectedTip(selectedTip === amt ? 0 : amt); }} />
                    ))}
                    <Chip label="No tip" selected={selectedTip === 0} onPress={() => setSelectedTip(0)} />
                </View>
            </Section>
        </Screen>
    );
}
