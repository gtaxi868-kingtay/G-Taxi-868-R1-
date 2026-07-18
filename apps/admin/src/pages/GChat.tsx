import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Send, Sparkles, Inbox } from 'lucide-react';

// Talk to G — plain-English chat grounded in the live briefing numbers.
// G reasons through its council lenses and can FILE suggestions (they land in
// the G Approvals inbox as 'recommendation' rows) but can never execute:
// g_execute_action's reviewed HANDLERS registry stays the only execution path.

interface ChatMsg {
    role: 'user' | 'assistant';
    content: string;
    filed?: Array<{ id: string; title: string }>;
}

const C = {
    text:    '#F1F5F9',
    muted:   'rgba(255,255,255,0.4)',
    body:    'rgba(255,255,255,0.85)',
    surface: 'rgba(255,255,255,0.05)',
    accent:  '#A78BFA',
    userBg:  'rgba(167,139,250,0.16)',
};

const SUGGESTIONS = [
    'What needs my attention right now?',
    'How did we do this week vs today?',
    'Where is the biggest risk in the platform tonight?',
    'Is any lane demand building for G-Escape?',
];

export function GChat() {
    const [messages, setMessages] = useState<ChatMsg[]>([]);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, busy]);

    const send = async (text: string) => {
        const q = text.trim();
        if (!q || busy) return;
        setError(null);
        const history = [...messages, { role: 'user' as const, content: q }];
        setMessages(history);
        setInput('');
        setBusy(true);
        try {
            const { data, error: fnErr } = await supabase.functions.invoke('g_chat', {
                body: { messages: history.map(({ role, content }) => ({ role, content })) },
            });
            if (fnErr) throw fnErr;
            const reply = data?.reply || data?.error || 'No reply.';
            setMessages([...history, { role: 'assistant', content: reply, filed: data?.proposals_filed ?? [] }]);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'G is unreachable right now.');
            setMessages(history); // keep the user's message; let them retry
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', maxWidth: 860 }}>
            <div style={{ marginBottom: 16 }}>
                <h2 style={{ color: C.text, fontSize: 20, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Sparkles size={18} color={C.accent} /> Talk to G
                </h2>
                <p style={{ color: C.muted, fontSize: 13, margin: '4px 0 0' }}>
                    Grounded in the live numbers. Anything G wants to DO lands in G Approvals for your sign-off — it never executes on its own.
                </p>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, paddingRight: 4 }}>
                {messages.length === 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                        {SUGGESTIONS.map((s) => (
                            <button
                                key={s}
                                onClick={() => send(s)}
                                style={{
                                    background: C.surface, color: C.body, border: '1px solid rgba(255,255,255,0.12)',
                                    borderRadius: 18, padding: '8px 14px', fontSize: 13, cursor: 'pointer',
                                }}
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                )}

                {messages.map((m, i) => (
                    <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
                        <div style={{
                            background: m.role === 'user' ? C.userBg : C.surface,
                            border: '1px solid rgba(255,255,255,0.10)',
                            borderRadius: 14,
                            padding: '10px 14px',
                            color: C.body, fontSize: 14, lineHeight: 1.55,
                            whiteSpace: 'pre-wrap',
                        }}>
                            {m.content}
                        </div>
                        {m.filed && m.filed.length > 0 && (
                            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {m.filed.map((f) => (
                                    <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.accent, fontSize: 12 }}>
                                        <Inbox size={13} /> Filed to G Approvals: “{f.title}”
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}

                {busy && (
                    <div style={{ alignSelf: 'flex-start', color: C.muted, fontSize: 13, padding: '6px 2px' }}>
                        G is thinking…
                    </div>
                )}
                {error && (
                    <div style={{ alignSelf: 'flex-start', color: '#F87171', fontSize: 13 }}>
                        {error}
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            <form
                onSubmit={(e) => { e.preventDefault(); send(input); }}
                style={{ display: 'flex', gap: 8, marginTop: 14 }}
            >
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask G anything about the business…"
                    style={{
                        flex: 1, background: C.surface, border: '1px solid rgba(255,255,255,0.14)',
                        borderRadius: 12, padding: '12px 14px', color: C.text, fontSize: 14, outline: 'none',
                    }}
                />
                <button
                    type="submit"
                    disabled={busy || !input.trim()}
                    style={{
                        background: C.accent, border: 'none', borderRadius: 12, width: 46,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: busy || !input.trim() ? 'default' : 'pointer',
                        opacity: busy || !input.trim() ? 0.5 : 1,
                    }}
                >
                    <Send size={16} color="#0F172A" />
                </button>
            </form>
        </div>
    );
}
