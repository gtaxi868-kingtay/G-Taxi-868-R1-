import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, SafeAreaView, TextInput, Alert, KeyboardAvoidingView, Platform, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Surface, Txt } from '../design-system/primitives';
import { tokens } from '../design-system/tokens';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../../../../shared/supabase';
import { decode } from 'base64-arraybuffer';

export function EditProfileScreen({ navigation }: any) {
    const { profile, refreshProfile, user } = useAuth();

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
                const base64 = result.assets[0].base64;
                const filePath = `${user.id}/${Date.now()}.png`;

                // Upload to Supabase Storage
                const { data, error: uploadError } = await supabase.storage
                    .from('avatars')
                    .upload(filePath, decode(base64), {
                        contentType: 'image/png',
                        upsert: true
                    });

                if (uploadError) throw uploadError;

                // Get Public URL
                const { data: { publicUrl } } = supabase.storage
                    .from('avatars')
                    .getPublicUrl(filePath);

                setAvatarUrl(publicUrl);
                Alert.alert('Success', 'Profile photo uploaded!');
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

        const { error } = await supabase
            .from('profiles')
            .update({
                full_name: fullName,
                phone: phone,
                avatar_url: avatarUrl,
            })
            .eq('id', user.id);

        if (error) {
            Alert.alert('Error', error.message);
        } else {
            await refreshProfile(); // Refresh context
            navigation.goBack();
        }
        setSaving(false);
    };

    return (
        <View style={styles.container}>
            <SafeAreaView style={{ flex: 1 }}>

                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()}>
                        <Txt variant="headingM" style={{ color: tokens.colors.primary.purple }}>Cancel</Txt>
                    </TouchableOpacity>
                    <Txt variant="headingM" weight="bold">Edit Profile</Txt>
                    <TouchableOpacity onPress={handleSave} disabled={saving}>
                        <Txt variant="headingM" weight="bold" style={{ color: saving ? 'gray' : tokens.colors.primary.purple }}>
                            {saving ? 'Saving...' : 'Done'}
                        </Txt>
                    </TouchableOpacity>
                </View>

                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
                    <View style={styles.form}>
                        {/* Profile Photo - Now Functional! */}
                        <TouchableOpacity style={styles.photoContainer} onPress={pickImage} disabled={uploading}>
                            <View style={styles.avatar}>
                                {uploading ? (
                                    <View style={styles.uploadingOverlay}>
                                        <Txt variant="small" color="white">...</Txt>
                                    </View>
                                ) : avatarUrl ? (
                                    <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
                                ) : (
                                    <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,200,150,0.15)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: tokens.colors.primary.purple }}>
                                        <Txt variant="headingM" weight="bold" color={tokens.colors.primary.purple}>
                                            {user?.name?.charAt(0)?.toUpperCase() || 'R'}
                                        </Txt>
                                    </View>
                                )}
                            </View>
                            <Txt variant="caption" color={tokens.colors.primary.purple} style={{ marginTop: 12 }}>
                                {uploading ? 'Uploading...' : 'Change Photo'}
                            </Txt>
                        </TouchableOpacity>

                        {/* Fields */}
                        <View style={styles.fieldGroup}>
                            <Txt variant="caption" color={tokens.colors.text.secondary} style={styles.label}>FULL NAME</Txt>
                            <TextInput
                                style={styles.input}
                                value={fullName}
                                onChangeText={setFullName}
                                placeholderTextColor="#666"
                                placeholder="Enter full name"
                            />
                        </View>

                        <View style={styles.fieldGroup}>
                            <Txt variant="caption" color={tokens.colors.text.secondary} style={styles.label}>PHONE NUMBER</Txt>
                            <TextInput
                                style={styles.input}
                                value={phone}
                                onChangeText={setPhone}
                                placeholderTextColor="#666"
                                placeholder="+1 868..."
                                keyboardType="phone-pad"
                            />
                            <Txt variant="small" color={tokens.colors.text.tertiary} style={{ marginTop: 8 }}>
                                Required for drivers to contact you. Use T&T format (e.g., 868-555-0199).
                            </Txt>
                        </View>
                    </View>
                </KeyboardAvoidingView>

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
        justifyContent: 'space-between',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.05)',
    },
    form: {
        padding: 24,
    },
    photoContainer: {
        alignItems: 'center',
        marginBottom: 40,
    },
    avatar: {
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: 'rgba(255,255,255,0.1)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarImage: {
        width: 100,
        height: 100,
        borderRadius: 50,
    },
    uploadingOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.5)',
        borderRadius: 50,
        alignItems: 'center',
        justifyContent: 'center',
    },
    fieldGroup: {
        marginBottom: 24,
    },
    label: {
        marginBottom: 8,
        letterSpacing: 1,
    },
    input: {
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: 8,
        padding: 16,
        color: 'white',
        fontSize: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
    },
});
