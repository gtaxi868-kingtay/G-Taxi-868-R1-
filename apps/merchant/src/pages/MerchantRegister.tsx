import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { MerchantAuthShell } from './MerchantAuthShell';

// Plain self-signup — mirrors apps/merchant-mobile's Register flow exactly:
// calls the merchant_signup edge function (service-role), which creates the
// auth user, a pending merchants row, a profile, and a zero-balance wallet.
// Lands as activation_status='pending' until an admin activates it.
export function MerchantRegister({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);
    const [focused, setFocused] = useState<'name' | 'email' | 'password' | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password.length < 6) {
            setError('Password must be at least 6 characters');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const { data, error: fnErr } = await supabase.functions.invoke('merchant_signup', {
                body: { email: email.trim().toLowerCase(), password, full_name: name.trim() },
            });
            if (fnErr) throw fnErr;
            if (!data?.success) throw new Error(data?.error || 'Registration failed');
            setDone(true);
        } catch (err: any) {
            setError(err.message || 'Registration failed');
        } finally {
            setLoading(false);
        }
    };

    if (done) {
        return (
            <MerchantAuthShell subtitle="Account Created" footer="Node Secure · G-Taxi Partner Suite">
                <div className="rain-notice">
                    <span>Your business is registered and pending activation. An admin will review and activate your account, then you can sign in.</span>
                </div>
                <button type="button" className="rain-btn" onClick={onDone}>Back to Sign In</button>
            </MerchantAuthShell>
        );
    }

    return (
        <MerchantAuthShell subtitle="Register Business" footer="Node Secure · G-Taxi Partner Suite">
            <form onSubmit={handleSubmit}>
                <div className="rain-field">
                    <label className={`rain-label ${focused === 'name' ? 'focused' : ''}`}>Business Name</label>
                    <div className={`rain-input-shell ${focused === 'name' ? 'focused' : ''}`}>
                        <div className="rain-focus-ring" />
                        <input
                            type="text" required autoFocus placeholder="Your Business"
                            value={name} onChange={e => setName(e.target.value)}
                            onFocus={() => setFocused('name')} onBlur={() => setFocused(null)}
                            className="rain-input"
                        />
                    </div>
                </div>

                <div className="rain-field">
                    <label className={`rain-label ${focused === 'email' ? 'focused' : ''}`}>Email</label>
                    <div className={`rain-input-shell ${focused === 'email' ? 'focused' : ''}`}>
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
                    <label className={`rain-label ${focused === 'password' ? 'focused' : ''}`}>Password</label>
                    <div className={`rain-input-shell ${focused === 'password' ? 'focused' : ''}`}>
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
                    {loading ? 'Registering…' : 'Register'}
                </button>
            </form>

            <button type="button" className="rain-link-btn" onClick={onBack}>
                Already have an account? Sign in
            </button>
        </MerchantAuthShell>
    );
}
