import React, { useState, useEffect, useRef } from 'react';
import {
    View, StyleSheet, TouchableOpacity, TextInput,
    FlatList, KeyboardAvoidingView, Platform, Dimensions,
    Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../shared/supabase';
import { useAuth } from '../context/AuthContext';
import { Txt } from '../design-system/primitives';

import { GlassCard, BRAND, VOICES, SEMANTIC, RADIUS, GRADIENTS } from '../design-system';

const { width } = Dimensions.get('window');

interface Message {
    id: string;
    ride_id: string;
    sender_id: string;
    content: string;
    type: 'text' | 'location' | 'system';
    created_at: string;
}

export function ChatScreen({ route, navigation }: any) {
    const { rideId, rider } = route.params;
    const { user } = useAuth();
    const insets = useSafeAreaInsets();
    const flatListRef = useRef<FlatList>(null);

    const [messages, setMessages] = useState<Message[]>([]);
    const [inputText, setInputText] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchMessages();
        const subscription = subscribeToMessages();
        return () => {
            subscription.unsubscribe();
        };
    }, []);

    const fetchMessages = async () => {
        const { data, error } = await supabase
            .from('ride_messages')
            .select('*')
            .eq('ride_id', rideId)
            .order('created_at', { ascending: true });

        if (data) setMessages(data);
        setLoading(false);
    };

    const subscribeToMessages = () => {
        return supabase
            .channel(`ride_chat:${rideId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'ride_messages',
                filter: `ride_id=eq.${rideId}`
            }, (payload) => {
                const newMessage = payload.new as Message;
                setMessages(prev => [...prev, newMessage]);
                if (newMessage.sender_id !== user?.id) {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
            })
            .subscribe();
    };

    const handleSend = async (text: string = inputText) => {
        if (!text.trim()) return;
        setInputText('');
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

        const { error } = await supabase.from('ride_messages').insert({
            ride_id: rideId,
            sender_id: user?.id,
            content: text,
            type: 'text'
        });

        if (error) Alert.alert('Error', 'Failed to send message');
    };

    const quickReplies = ["I'm arriving now 🚗", "Traffic is slow", "I'm at the entrance", "Ok, got it! 👍", "Almost there"];

    const renderMessage = ({ item }: { item: Message }) => {
        const isSelf = item.sender_id === user?.id;
        return (
            <View style={[s.msgRow, isSelf ? s.msgSelf : s.msgOther]}>
                {!isSelf && (
                    <View style={s.msgAvatar}>
                        <Txt weight="heavy" style={{ fontSize: 10, color: BRAND.cyan }}>RI</Txt>
                    </View>
                )}
                <View style={[s.bubble, isSelf ? s.bubbleSelf : s.bubbleOther]}>
                    <Txt style={[s.msgText, { color: isSelf ? '#0A0718' : '#FFF' }]}>{item.content}</Txt>
                </View>
            </View>
        );
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <BlurView tint="dark" intensity={90} style={[s.header, { paddingTop: insets.top }]}>
                <View style={s.headerInner}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={s.headerBtn}>
                        <Ionicons name="chevron-back" size={24} color="#FFF" />
                    </TouchableOpacity>
                    <View style={s.headerTitle}>
                        <Txt variant="bodyBold" weight="heavy" color="#FFF">{rider?.name?.toUpperCase() || 'RIDER'}</Txt>
                        <View style={s.statusRow}>
                            <View style={s.statusDot} />
                            <Txt variant="caption" weight="heavy" color={VOICES.driver.textMuted}>LIVE TELEMETRY</Txt>
                        </View>
                    </View>
                    <TouchableOpacity style={s.headerBtn}>
                        <Ionicons name="call" size={20} color={BRAND.cyan} />
                    </TouchableOpacity>
                </View>
            </BlurView>

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={{ flex: 1 }}
                keyboardVerticalOffset={0}
            >
                <FlatList
                    ref={flatListRef}
                    data={messages}
                    keyExtractor={item => item.id}
                    renderItem={renderMessage}
                    contentContainerStyle={s.list}
                    onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
                />

                <View style={s.quickReplies}>
                    <FlatList
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        data={quickReplies}
                        keyExtractor={item => item}
                        renderItem={({ item }) => (
                            <TouchableOpacity style={s.chip} onPress={() => handleSend(item)}>
                                <Txt variant="small" weight="heavy" color="#FFF">{item.toUpperCase()}</Txt>
                            </TouchableOpacity>
                        )}
                        contentContainerStyle={{ paddingHorizontal: 16 }}
                    />
                </View>

                <View style={[s.inputArea, { paddingBottom: Math.max(insets.bottom, 16) }]}>
                    <View style={s.inputWrap}>
                        <TextInput
                            style={s.input}
                            placeholder="TRANSMIT TO RIDER..."
                            placeholderTextColor="rgba(255,255,255,0.2)"
                            value={inputText}
                            onChangeText={setInputText}
                            multiline
                        />
                        <TouchableOpacity style={s.sendBtn} onPress={() => handleSend()}>
                            <LinearGradient colors={[BRAND.cyan, '#00A881']} style={s.sendGrad}>
                                <Ionicons name="send" size={18} color="#0A0718" />
                            </LinearGradient>
                        </TouchableOpacity>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0A0718' },
    header: { zIndex: 20, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    headerInner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16 },
    headerBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, marginLeft: 16 },
    statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
    statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: BRAND.cyan, marginRight: 6 },

    list: { padding: 16, gap: 16 },
    msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
    msgSelf: { justifyContent: 'flex-end' },
    msgOther: { justifyContent: 'flex-start' },
    msgAvatar: { width: 28, height: 28, borderRadius: 10, backgroundColor: 'rgba(0,255,194,0.05)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,255,194,0.1)' },
    bubble: { maxWidth: '80%', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20 },
    bubbleSelf: { backgroundColor: BRAND.cyan, borderBottomRightRadius: 4 },
    bubbleOther: { backgroundColor: 'rgba(255,255,255,0.03)', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    msgText: { fontSize: 15, fontWeight: '600' },

    quickReplies: { paddingVertical: 12 },
    chip: { backgroundColor: 'rgba(255,255,255,0.03)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, marginRight: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },

    inputArea: { paddingHorizontal: 16, paddingTop: 8 },
    inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 30, paddingLeft: 20, paddingRight: 6, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    input: { flex: 1, color: '#FFF', fontSize: 16, maxHeight: 100, paddingVertical: 8, fontWeight: '600' },
    sendBtn: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden' },
    sendGrad: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
