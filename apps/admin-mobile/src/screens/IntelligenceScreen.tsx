import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { VOICES } from '@gtaxi/design-system';

const BG = VOICES.admin.bg;
const ACCENT = VOICES.admin.accent;

// G's conversational chief. Talks to g_chat (admin-JWT edge fn), which is grounded
// in the live briefing and reasons through the council lenses. G can FILE
// suggestions into the approvals inbox but never executes anything itself.
type ChatMsg = { role: 'user' | 'assistant'; content: string };
type Filed = { id: string; title: string };

const GREETING =
  "I'm G. Ask me anything about the business — money, dispatch, the grid, G-Escape. " +
  "I read the same live numbers as your briefing. If something's worth doing, I'll file it to your approvals inbox for you to decide.";

export function IntelligenceScreen() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [filed, setFiled] = useState<Filed[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const next: ChatMsg[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setError(null);
    setLoading(true);
    // g_chat clamps to the last 8 turns server-side; we send full local history.
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('g_chat', {
        body: { messages: next },
      });
      if (fnErr) throw new Error(fnErr.message || 'Request failed');
      const reply: string = data?.reply || "I didn't catch that — try again?";
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
      const newlyFiled: Filed[] = Array.isArray(data?.proposals_filed) ? data.proposals_filed : [];
      if (newlyFiled.length) setFiled((f) => [...f, ...newlyFiled]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong reaching G.');
    } finally {
      setLoading(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Talk to G</Text>
        <Text style={styles.subtitle}>Chief of staff · reads your live numbers</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.thread}
        contentContainerStyle={styles.threadContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {/* Greeting bubble */}
        <View style={[styles.bubble, styles.gBubble]}>
          <Text style={styles.gText}>{GREETING}</Text>
        </View>

        {messages.map((m, i) => (
          <View
            key={i}
            style={[styles.bubble, m.role === 'user' ? styles.userBubble : styles.gBubble]}
          >
            <Text style={m.role === 'user' ? styles.userText : styles.gText}>{m.content}</Text>
          </View>
        ))}

        {loading && (
          <View style={[styles.bubble, styles.gBubble, styles.thinking]}>
            <ActivityIndicator size="small" color={ACCENT} />
            <Text style={styles.thinkingText}>G is thinking…</Text>
          </View>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={14} color="#FF6B6B" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {filed.length > 0 && (
          <View style={styles.filedPanel}>
            <Text style={styles.filedTitle}>
              <Ionicons name="file-tray-full-outline" size={13} color={ACCENT} />{' '}
              Filed to your approvals ({filed.length})
            </Text>
            {filed.map((f) => (
              <Text key={f.id} style={styles.filedItem}>• {f.title}</Text>
            ))}
            <Text style={styles.filedHint}>Open Approvals to accept or reject — nothing runs until you do.</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Ask G…"
          placeholderTextColor="rgba(255,255,255,0.35)"
          value={input}
          onChangeText={setInput}
          multiline
          onSubmitEditing={send}
          editable={!loading}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
          onPress={send}
          disabled={!input.trim() || loading}
          accessibilityLabel="Send message to G"
          accessibilityRole="button"
        >
          <Ionicons name="arrow-up" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { paddingHorizontal: 16, paddingTop: 48, paddingBottom: 12 },
  title: { fontSize: 24, fontWeight: '800', color: '#fff' },
  subtitle: { fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 2 },

  thread: { flex: 1 },
  threadContent: { padding: 16, gap: 10, paddingBottom: 24 },
  bubble: { maxWidth: '88%', borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14 },
  gBubble: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  userBubble: { alignSelf: 'flex-end', backgroundColor: ACCENT },
  gText: { color: '#F1F5F9', fontSize: 15, lineHeight: 21 },
  userText: { color: '#fff', fontSize: 15, lineHeight: 21, fontWeight: '500' },

  thinking: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  thinkingText: { color: 'rgba(255,255,255,0.5)', fontSize: 13 },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,77,77,0.08)', borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: 'rgba(255,77,77,0.15)',
  },
  errorText: { color: '#FF6B6B', fontSize: 12, flex: 1 },

  filedPanel: {
    marginTop: 4, backgroundColor: `${ACCENT}14`, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: `${ACCENT}30`,
  },
  filedTitle: { color: ACCENT, fontSize: 13, fontWeight: '700', marginBottom: 6 },
  filedItem: { color: '#E7E1FB', fontSize: 13, lineHeight: 19 },
  filedHint: { color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 6 },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: BG,
  },
  input: {
    flex: 1, color: '#fff', fontSize: 15, maxHeight: 120,
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: ACCENT,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
});
