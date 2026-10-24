import React, { useState, useEffect, useRef } from 'react';
import { View, TextInput, Pressable, FlatList, KeyboardAvoidingView, Platform, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { toast } from '../components/Toast';
import { BRAND_GRADIENT, BrandBadge, Chip, EmptyState, FONT, GUTTER, Header, IconButton, Loading, SPACE, Txt, useTheme } from '../ui/kit';

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
    const flatListRef = useRef<FlatList<Message>>(null);

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
                setMessages(prev => prev.some(m => m.id === newMessage.id) ? prev : [...prev, newMessage]);
            })
            // Re-load once connected: messages sent in the channel's first
            // seconds (or while it was down) would otherwise never show.
            .subscribe((status) => { if (status === 'SUBSCRIBED') fetchMessages(); });
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

        if (error) { toast('Message not sent. Please try again.', 'error'); setInputText(text); }
    };

    const m = useTheme();
    const quickReplies = ["I'm outside 👋", 'On my way down', 'Running 2 min late', 'Which entrance?', '👍 Got it'];
    const phone = driver?.phone_number || driver?.phone;

    const renderMessage = ({ item }: { item: Message }) => {
        const isSelf = item.sender_id === user?.id;
        return (
            <View style={{ flexDirection: 'row', justifyContent: isSelf ? 'flex-end' : 'flex-start', marginBottom: SPACE.sm }}>
                <View style={{ maxWidth: '80%', borderRadius: 20, borderBottomRightRadius: isSelf ? 6 : 20, borderBottomLeftRadius: isSelf ? 20 : 6, overflow: 'hidden',
                    backgroundColor: isSelf ? undefined : m.field }}>
                    {isSelf ? (
                        <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md }}>
                            <Txt variant="body" tone="onBrand">{item.content}</Txt>
                        </LinearGradient>
                    ) : (
                        <View style={{ paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md }}>
                            <Txt variant="body">{item.content}</Txt>
                        </View>
                    )}
                </View>
            </View>
        );
    };

    return (
        <View style={{ flex: 1, backgroundColor: m.page }}>
            <StatusBar style={m.statusBar} />
            <Header
                title={driver?.name || 'Your driver'}
                onBack={() => navigation.goBack()}
                right={phone ? <IconButton icon="call-outline" label="Call your driver" onPress={() => Linking.openURL(`tel:${phone}`)} /> : undefined}
            />

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
                <FlatList<Message>
                    ref={flatListRef}
                    data={messages}
                    keyExtractor={item => item.id}
                    renderItem={renderMessage}
                    contentContainerStyle={{ padding: GUTTER, flexGrow: 1 }}
                    onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
                    ListEmptyComponent={loading ? <Loading /> : <EmptyState icon="chatbubbles-outline" title="Say hello" body="Messages with your driver show up here." />}
                />

                <FlatList<string>
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    data={quickReplies}
                    keyExtractor={item => item}
                    renderItem={({ item }) => <Chip label={item} onPress={() => handleSend(item)} />}
                    contentContainerStyle={{ paddingHorizontal: GUTTER }}
                    style={{ flexGrow: 0 }}
                />

                <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: GUTTER, paddingTop: SPACE.sm, paddingBottom: Math.max(insets.bottom, SPACE.lg), borderTopWidth: 1, borderTopColor: m.chipBorder }}>
                    <TextInput
                        style={{ flex: 1, minHeight: 48, maxHeight: 120, borderRadius: 24, paddingHorizontal: SPACE.lg, paddingTop: 13, paddingBottom: 13,
                            backgroundColor: m.field, color: m.ink, fontFamily: FONT.medium, fontSize: 16 }}
                        placeholder="Message your driver"
                        placeholderTextColor={m.faint}
                        value={inputText}
                        onChangeText={setInputText}
                        multiline
                    />
                    <Pressable accessibilityRole="button" accessibilityLabel="Send" onPress={() => handleSend()} style={{ marginLeft: SPACE.sm }}>
                        <BrandBadge icon="send" size={48} round />
                    </Pressable>
                </View>
            </KeyboardAvoidingView>
        </View>
    );
}
