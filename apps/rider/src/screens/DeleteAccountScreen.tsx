import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from 'shared/supabase';
import { BlurView } from 'expo-blur';

export function DeleteAccountScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();
    const [loading, setLoading] = useState(false);
    const [confirmed, setConfirmed] = useState(false);

    const handleDeleteAccount = async () => {
        if (!confirmed) {
            Alert.alert("Final Warning", "This will permanently erase your ride history, wallet balance, and profile data. This cannot be undone.");
            return;
        }

        setLoading(true);
        try {
            // Call the GDPR deletion Edge Function
            const { error } = await supabase.functions.invoke('delete_account');
            
            if (error) throw error;

            // Sign out locally
            await supabase.auth.signOut();
            
            Alert.alert("Account Deleted", "Your data has been scheduled for deletion. We're sorry to see you go.");
            navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        } catch (err: any) {
            console.error(err);
            Alert.alert("Error", "Could not complete deletion request. Please contact support@gtaxi.com");
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={s.root}>
            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="arrow-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Text style={s.headerTitle}>Account Security</Text>
            </View>

            <ScrollView contentContainerStyle={s.content}>
                <View style={s.warningCard}>
                    <Ionicons name="warning" size={48} color="#FF4D6D" />
                    <Text style={s.warningTitle}>Delete Account?</Text>
                    <Text style={s.warningText}>
                        Under GDPR and Data Privacy laws, you have the right to be forgotten. 
                        Deleting your account will result in:
                    </Text>
                    <View style={s.bulletPoints}>
                        <Text style={s.bullet}>• Immediate loss of all wallet credits.</Text>
                        <Text style={s.bullet}>• Removal of your driver ratings and history.</Text>
                        <Text style={s.bullet}>• Erasure of saved home/work addresses.</Text>
                    </View>
                </View>

                <TouchableOpacity 
                    style={[s.confirmRow, confirmed && s.confirmRowActive]} 
                    onPress={() => setConfirmed(!confirmed)}
                >
                    <Ionicons 
                        name={confirmed ? "checkbox" : "square-outline"} 
                        size={24} 
                        color={confirmed ? "#00FF94" : "rgba(255,255,255,0.4)"} 
                    />
                    <Text style={s.confirmText}>I understand that this action is permanent.</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                    style={[s.deleteBtn, !confirmed && s.deleteBtnDisabled]} 
                    onPress={handleDeleteAccount}
                    disabled={loading || !confirmed}
                >
                    {loading ? (
                        <ActivityIndicator color="#FFF" />
                    ) : (
                        <Text style={s.deleteBtnText}>PERMANENTLY DELETE ACCOUNT</Text>
                    )}
                </TouchableOpacity>

                <Text style={s.legalNote}>
                    G-Taxi complies with international data standards. Certain transaction records 
                    may be retained for tax and anti-fraud purposes as required by law.
                </Text>
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0D0B1E' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 20 },
    backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: 20, fontWeight: '800', color: '#FFF', marginLeft: 16 },
    content: { padding: 24 },
    warningCard: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 24, padding: 24, alignItems: 'center', marginBottom: 32 },
    warningTitle: { fontSize: 24, fontWeight: '900', color: '#FF4D6D', marginTop: 16, marginBottom: 8 },
    warningText: { fontSize: 16, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 22 },
    bulletPoints: { alignSelf: 'flex-start', marginTop: 24 },
    bullet: { fontSize: 14, color: 'rgba(255,255,255,0.5)', marginBottom: 8 },
    confirmRow: { flexDirection: 'row', alignItems: 'center', padding: 20, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.03)', marginBottom: 32 },
    confirmRowActive: { backgroundColor: 'rgba(0,255,148,0.05)', borderColor: '#00FF94', borderWidth: 1 },
    confirmText: { flex: 1, marginLeft: 12, color: '#FFF', fontSize: 14 },
    deleteBtn: { height: 64, borderRadius: 20, backgroundColor: '#FF4D6D', alignItems: 'center', justifyContent: 'center' },
    deleteBtnDisabled: { opacity: 0.3 },
    deleteBtnText: { color: '#FFF', fontWeight: '900', fontSize: 14, letterSpacing: 1 },
    legalNote: { marginTop: 32, fontSize: 12, color: 'rgba(255,255,255,0.3)', textAlign: 'center', lineHeight: 18 }
});
