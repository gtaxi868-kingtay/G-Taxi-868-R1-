import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { MerchantAuthShell } from './MerchantAuthShell';

// Commander-recruited merchant onboarding — mirrors
// apps/merchant-mobile's JoinWithCodeScreen exactly. merchant_register_with_code
// is a public edge function that resolves commander_code against
// pod_commanders.onboarding_code, creates the auth user + a pending merchant
// record linked to the commander's territory. The commander activates them
// from the Command Center, then the merchant signs in.
export function MerchantJoinWithCode({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
    const [businessName, setBusinessName] = useState('');
    const [contactName, setContactName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [commanderCode, setCommanderCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);
    const [focused, setFocused] = useState<string | null>(null);

    const field = (name: string) => `rain-input-shell ${focused === name ? 'focused' : ''}`;
    const label = (name: string) => `rain-label ${focused === name ? 'focused' : ''}`;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password.length < 6) {
            setError('Password must be at least 6 characters');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const { data, error: fnErr } = await supabase.functions.invoke('merchant_register_with_code', {
                body: {
                    business_name: businessName.trim(),
                    email: email.trim().toLowerCase(),
                    password,
                    commander_code: commanderCode.trim().toUpperCase(),
                    name: contactName.trim() || businessName.trim(),
                },
            });
            if (fnErr) throw fnErr;
            if (!data?.success) throw new Error(data?.error || 'Could not register with that code');
            setDone(true);
        } catch (err: any) {
            setError(err.message || 'Registration failed');
        } finally {
            setLoading(false);
        }
    };

    if (done) {
        return (
            <MerchantAuthShell subtitle="Business Registered" badge="G-Partner" footer="Node Secure · G-Taxi Partner Suite">
                <div className="rain-notice">
                    <span>Your business has joined the territory. Your G-Lead will activate you shortly — then sign in to get started.</span>
                </div>
                <button type="button" className="rain-btn" onClick={onDone}>Back to Sign In</button>
            </MerchantAuthShell>
        );
    }

    return (
        <MerchantAuthShell subtitle="Join with a Code" badge="G-Partner" footer="Node Secure · G-Taxi Partner Suite">
            <form onSubmit={handleSubmit}>
                <div className="rain-field">
                    <label className={label('code')}>G-Lead Code</label>
                    <div className={field('code')}>
                        <div className="rain-focus-ring" />
                        <input
                            type="text" required autoFocus placeholder="COMMANDER CODE"
                            value={commanderCode} onChange={e => setCommanderCode(e.target.value)}
                            onFocus={() => setFocused('code')} onBlur={() => setFocused(null)}
                            className="rain-input" style={{ textTransform: 'uppercase' }}
                        />
                    </div>
                </div>

                <div className="rain-field">
                    <label className={label('business')}>Business Name</label>
                    <div className={field('business')}>
                        <div className="rain-focus-ring" />
                        <input
                            type="text" required placeholder="Your Business"
                            value={businessName} onChange={e => setBusinessName(e.target.value)}
                            onFocus={() => setFocused('business')} onBlur={() => setFocused(null)}
                            className="rain-input"
                        />
                    </div>
                </div>

                <div className="rain-field">
                    <label className={label('contact')}>Contact Name (optional)</label>
                    <div className={field('contact')}>
                        <div className="rain-focus-ring" />
                        <input
                            type="text" placeholder="Your Name"
                            value={contactName} onChange={e => setContactName(e.target.value)}
                            onFocus={() => setFocused('contact')} onBlur={() => setFocused(null)}
                            className="rain-input"
                        />
                    </div>
                </div>

                <div className="rain-field">
                    <label className={label('email')}>Email</label>
                    <div className={field('email')}>
                        <div className="rain-focus-ring" />
                        <input
                            type="email" required placeholder="partner@business.com"
                            value={email} onChange={e => setEmail(e.target.value)}
                            onFocus={() => setFocused('email')} onBlur={() => setFocused(null)}
                            className="rain-input"
                        />
                    </div>
                </div>

                <div className="rain-field">
                    <label className={label('password')}>Password</label>
                    <div className={field('password')}>
                        <div className="rain-focus-ring" />
                        <input
                            type="password" required minLength={6} placeholder="••••••••"
                            value={password} onChange={e => setPassword(e.target.value)}
                            onFocus={() => setFocused('password')} onBlur={() => setFocused(null)}
                            className="rain-input"
                        />
                    </div>
                </div>

                {error && (
                    <div className="rain-error">
                        <span>{error}</span>
                    </div>
                )}

                <button type="submit" disabled={loading} className="rain-btn">
                    {loading ? 'Joining…' : 'Join Territory'}
                </button>
            </form>

            <button type="button" className="rain-link-btn" onClick={onBack}>
                Already have an account? Sign in
            </button>
        </MerchantAuthShell>
    );
}
