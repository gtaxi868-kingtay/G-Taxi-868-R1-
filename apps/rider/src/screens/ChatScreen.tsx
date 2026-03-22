import React, { useState, useEffect, useRef } from 'react';
import {
    View, StyleSheet, TouchableOpacity, TextInput,
    FlatList, KeyboardAvoidingView, Platform, Dimensions,
    Image, Alert
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

const { width } = Dimensions.get('window');

// ── Rider Design Tokens ──────────────────────────────────────────────────────
const R = {
    bg: '#07050F',
    surface: '#110E22',
    surface2: '#16112A',
    border: 'rgba(124,58,237,0.12)',
    purple: '#7C3AED',
    purpleLight: '#A78BFA',
    gold: '#F59E0B',
    white: '#FFFFFF',
    muted: 'rgba(255,255,255,0.4)',
};

interface Message {
    id: string;
    ride_id: string;
    sender_id: string;
    content: string;
    type: 'text' | 'location' | 'system';
    created_at: string;
}

export function ChatScreen({ route, navigation }: any) {
    const { rideId, driver } = route.params;
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

    const quickReplies = ["I'm outside 👋", "On my way down", "Running 2 min late", "Which entrance?", "👍 Got it"];

    const renderMessage = ({ item }: { item: Message }) => {
        const isSelf = item.sender_id === user?.id;
        return (
            <View style={[s.msgRow, isSelf ? s.msgSelf : s.msgOther]}>
                {!isSelf && <View style={s.msgAvatar}><Txt style={{ fontSize: 10, color: '#FFF' }}>DR</Txt></View>}
                <View style={[s.bubble, isSelf ? s.bubbleSelf : s.bubbleOther]}>
                    {isSelf && <LinearGradient colors={[R.purple, '#4C1D95']} style={StyleSheet.absoluteFill} />}
                    <Txt variant="bodyReg" color="#FFF">{item.content}</Txt>
                </View>
            </View>
        );
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            {/* Header */}
            <BlurView tint="dark" intensity={80} style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.headerBtn}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <View style={s.headerTitle}>
                    <Txt variant="bodyBold" color="#FFF">{driver?.name || 'Driver'}</Txt>
                    <View style={s.statusRow}>
                        <View style={s.statusDot} />
                        <Txt variant="caption" color={R.muted}>Online</Txt>
                    </View>
                </View>
                <TouchableOpacity style={s.headerBtn}>
                    <Ionicons name="call" size={20} color="#FFF" />
                </TouchableOpacity>
            </BlurView>

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={{ flex: 1 }}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
            >
                <FlatList
                    ref={flatListRef}
                    data={messages}
                    keyExtractor={item => item.id}
                    renderItem={renderMessage}
                    contentContainerStyle={s.list}
                    onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
                />

                {/* Quick Replies */}
                <View style={s.quickReplies}>
                    <FlatList
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        data={quickReplies}
                        keyExtractor={item => item}
                        renderItem={({ item }) => (
                            <TouchableOpacity style={s.chip} onPress={() => handleSend(item)}>
                                <Txt variant="small" color="#FFF">{item}</Txt>
                            </TouchableOpacity>
                        )}
                        contentContainerStyle={{ paddingHorizontal: 16 }}
                    />
                </View>

                {/* Input */}
                <View style={[s.inputArea, { paddingBottom: Math.max(insets.bottom, 16) }]}>
                    <View style={s.inputWrap}>
                        <TextInput
                            style={s.input}
                            placeholder="Message driver..."
                            placeholderTextColor={R.muted}
                            value={inputText}
                            onChangeText={setInputText}
                            multiline
                        />
                        <TouchableOpacity style={s.sendBtn} onPress={() => handleSend()}>
                            <LinearGradient colors={[R.purple, '#4C1D95']} style={s.sendGrad}>
                                <Ionicons name="send" size={18} color="#FFF" />
                            </LinearGradient>
                        </TouchableOpacity>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderColor: R.border },
    headerBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: R.surface, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, marginLeft: 16 },
    statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
    statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#10B981', marginRight: 6 },

    list: { padding: 16, gap: 12 },
    msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
    msgSelf: { justifyContent: 'flex-end' },
    msgOther: { justifyContent: 'flex-start' },
    msgAvatar: { width: 24, height: 24, borderRadius: 12, backgroundColor: R.purple, alignItems: 'center', justifyContent: 'center' },
    bubble: { maxWidth: '80%', padding: 12, borderRadius: 20, overflow: 'hidden' },
    bubbleSelf: { borderBottomRightRadius: 4 },
    bubbleOther: { backgroundColor: R.surface2, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: R.border },

    quickReplies: { paddingVertical: 12 },
    chip: { backgroundColor: R.surface2, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginRight: 8, borderWidth: 1, borderColor: R.border },

    inputArea: { paddingHorizontal: 16, paddingTop: 8 },
    inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: R.surface2, borderRadius: 30, paddingLeft: 20, paddingRight: 6, paddingVertical: 6, borderWidth: 1, borderColor: R.border },
    input: { flex: 1, color: '#FFF', fontSize: 16, maxHeight: 100, paddingVertical: 8 },
    sendBtn: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden' },
    sendGrad: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
