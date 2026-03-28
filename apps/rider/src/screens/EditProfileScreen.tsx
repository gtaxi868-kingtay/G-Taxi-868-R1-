import React, { useState } from 'react';
import {
    View, StyleSheet, TouchableOpacity, TextInput,
    Alert, KeyboardAvoidingView, Platform, Image,
    ScrollView, ActivityIndicator, Dimensions
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '../design-system/primitives';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../../../../shared/supabase';
import { decode } from 'base64-arraybuffer';

import { tokens } from '../design-system/tokens';

const { width } = Dimensions.get('window');

// --- Rider Design Tokens (Deprecated local, using tokens) ---
const R = {
    bg: tokens.colors.background.base,
    surface: tokens.colors.background.surface,
    border: tokens.colors.glass.stroke,
    purple: tokens.colors.primary.purple,
    purpleLight: tokens.colors.primary.cyan,
    white: tokens.colors.text.primary,
    muted: tokens.colors.text.secondary,
};

export function EditProfileScreen({ navigation }: any) {
    const { profile, refreshProfile, user } = useAuth();
    const insets = useSafeAreaInsets();

    const [fullName, setFullName] = useState(profile?.full_name || '');
    const [phone, setPhone] = useState(profile?.phone || '');
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

        if (!result.canceled && result.assets[0].base64 && user) {
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
                Alert.alert('Upload Error', error.message);
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
            .update({ full_name: fullName, phone: phone, avatar_url: avatarUrl })
            .eq('id', user.id);

        if (error) {
            Alert.alert('Error', error.message);
        } else {
            await refreshProfile();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            navigation.goBack();
        }
        setSaving(false);
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <View style={[s.header, { marginTop: insets.top }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#FFF" style={{ marginLeft: 16 }}>Edit Profile</Txt>
            </View>

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
                <ScrollView contentContainerStyle={s.scroll}>

                    <TouchableOpacity style={s.photoGroup} onPress={pickImage} disabled={uploading}>
                        <LinearGradient colors={[R.purple, '#4C1D95']} style={s.avatarBorder}>
                            <View style={s.avatarInner}>
                                {avatarUrl ? (
                                    <Image source={{ uri: avatarUrl }} style={s.image} />
                                ) : (
                                    <Txt variant="headingL" weight="heavy" color="#FFF">{fullName.charAt(0) || '?'}</Txt>
                                )}
                                {uploading && <View style={s.overlay}><ActivityIndicator color="#FFF" /></View>}
                            </View>
                        </LinearGradient>
                        <Txt variant="caption" weight="heavy" color={R.purpleLight} style={{ marginTop: 16 }}>CHANGE PHOTO</Txt>
                    </TouchableOpacity>

                    <View style={s.form}>
                        <View style={s.inputWrapper}>
                            <Txt variant="caption" weight="heavy" color={R.muted} style={s.label}>FULL NAME</Txt>
                            <TextInput
                                style={s.input}
                                value={fullName}
                                onChangeText={setFullName}
                                placeholder="Enter your full name"
                                placeholderTextColor="rgba(255,255,255,0.2)"
                            />
                        </View>

                        <View style={s.inputWrapper}>
                            <Txt variant="caption" weight="heavy" color={R.muted} style={s.label}>PHONE NUMBER</Txt>
                            <TextInput
                                style={s.input}
                                value={phone}
                                onChangeText={setPhone}
                                placeholder="868-000-0000"
                                placeholderTextColor="rgba(255,255,255,0.2)"
                                keyboardType="phone-pad"
                            />
                        </View>

                        {/* Save Button */}
                        <TouchableOpacity style={s.saveBtn} onPress={handleSave} disabled={saving}>
                            <LinearGradient 
                                colors={[tokens.colors.primary.purple, tokens.colors.primary.cyan]} 
                                start={{x: 0, y: 0}} 
                                end={{x: 1, y: 0}}
                                style={s.btnGradient}
                            >
                                {saving ? <ActivityIndicator color="#FFF" /> : (
                                    <Txt variant="bodyBold" color="#FFF">SAVE CHANGES</Txt>
                                )}
                            </LinearGradient>
                        </TouchableOpacity>
                    </View>

                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 32 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },

    scroll: { paddingBottom: 48 },
    photoGroup: { alignItems: 'center', marginBottom: 40 },
    avatarBorder: { width: 110, height: 110, borderRadius: 55, padding: 3, alignItems: 'center', justifyContent: 'center' },
    avatarInner: { width: 104, height: 104, borderRadius: 52, backgroundColor: R.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    image: { width: '100%', height: '100%' },
    overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },

    form: { paddingHorizontal: 20 },
    inputWrapper: { marginBottom: 24, gap: 10 },
    label: { marginLeft: 8, opacity: 0.8 },
    input: { height: 60, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 20, paddingHorizontal: 24, color: '#FFF', fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },

    saveBtn: { height: 64, borderRadius: 24, overflow: 'hidden', marginTop: 32, shadowColor: '#00FFFF', shadowRadius: 15, shadowOpacity: 0.3 },
    btnGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
