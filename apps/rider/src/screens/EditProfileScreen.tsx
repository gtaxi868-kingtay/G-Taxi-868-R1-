import React, { useState } from 'react';
import { View, Pressable, Image, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { supabase } from '@gtaxi/core';
import { decode } from 'base64-arraybuffer';
import { toast } from '../components/Toast';
import { BRAND_GRADIENT, Button, Field, Screen, SPACE, Txt, useTheme } from '../ui/kit';

export function EditProfileScreen({ navigation }: any) {
    const { profile, refreshProfile, user } = useAuth();

    const [fullName, setFullName] = useState(profile?.full_name || '');
    const [phone, setPhone] = useState(profile?.phone_number || '');
    const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || '');
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);

    const pickImage = async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.5,
            base64: true,
        });

        if (!result.canceled && result.assets?.[0]?.base64 && user) {
            try {
                setUploading(true);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                const base64 = result.assets[0].base64;
                const filePath = `${user.id}/${Date.now()}.png`;

                const { error: uploadError } = await supabase.storage
                    .from('avatars')
                    .upload(filePath, decode(base64), { contentType: 'image/png', upsert: true });

                if (uploadError) throw uploadError;

                const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath);
                setAvatarUrl(publicUrl);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (error: any) {
                toast('Photo upload failed: ' + error.message, 'error');
            } finally {
                setUploading(false);
            }
        }
    };

    const handleSave = async () => {
        if (!user) return;
        setSaving(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

        const { error } = await supabase
            .from('profiles')
            .update({ full_name: fullName, phone_number: phone, avatar_url: avatarUrl })
            .eq('id', user.id);

        if (error) {
            toast('Could not save: ' + error.message, 'error');
        } else {
            await refreshProfile();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            toast('Profile saved', 'success');
            navigation.goBack();
        }
        setSaving(false);
    };

    const m = useTheme();
    return (
        <Screen title="Edit profile" onBack={() => navigation.goBack()} footer={<Button title="Save changes" onPress={handleSave} loading={saving} />}>
            <Pressable accessibilityRole="button" accessibilityLabel="Change photo" onPress={pickImage} disabled={uploading} style={{ alignItems: 'center', marginTop: SPACE.sm, marginBottom: SPACE.xl }}>
                <View style={{ width: 96, height: 96, borderRadius: 48, overflow: 'hidden' }}>
                    {avatarUrl ? (
                        <Image source={{ uri: avatarUrl }} style={{ width: 96, height: 96 }} />
                    ) : (
                        <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                            <Txt variant="hero" tone="onBrand">{fullName.charAt(0).toUpperCase() || 'G'}</Txt>
                        </LinearGradient>
                    )}
                    {uploading && <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#FFFFFF" /></View>}
                </View>
                <Txt variant="bodyStrong" tone="accent" style={{ marginTop: SPACE.md }}>Change photo</Txt>
            </Pressable>

            <Field label="Full name" value={fullName} onChangeText={setFullName} placeholder="Your full name" autoCapitalize="words" textContentType="name" />
            <Field label="Phone number" value={phone} onChangeText={setPhone} placeholder="868 000 0000" keyboardType="phone-pad" textContentType="telephoneNumber"
                hint="Your driver uses this to reach you during a ride." />
        </Screen>
    );
}
