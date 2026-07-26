import { useState } from 'react';
import { MerchantAuthShell } from './MerchantAuthShell';

interface MerchantLoginProps {
    email: string;
    setEmail: (v: string) => void;
    password: string;
    setPassword: (v: string) => void;
    loading: boolean;
    error: string;
    onSubmit: (e: React.FormEvent) => void;
    onGoRegister: () => void;
    onGoJoin: () => void;
}

export function MerchantLogin({ email, setEmail, password, setPassword, loading, error, onSubmit, onGoRegister, onGoJoin }: MerchantLoginProps) {
    const [focused, setFocused] = useState<'email' | 'password' | null>(null);

    return (
        <MerchantAuthShell subtitle="G-TAXI" footer="Node Secure · G-Taxi Partner Suite">
            <form onSubmit={onSubmit}>
                <div className="rain-field">
                    <label className={`rain-label ${focused === 'email' ? 'focused' : ''}`}>Partner Email</label>
                    <div className={`rain-input-shell ${focused === 'email' ? 'focused' : ''}`}>
                        <div className="rain-focus-ring" />
                        <input
                            type="email"
                            required
                            autoFocus
                            placeholder="partner@business.com"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            onFocus={() => setFocused('email')}
                            onBlur={() => setFocused(null)}
                            className="rain-input"
                        />
                    </div>
                </div>

                <div className="rain-field">
                    <label className={`rain-label ${focused === 'password' ? 'focused' : ''}`}>Security Key</label>
                    <div className={`rain-input-shell ${focused === 'password' ? 'focused' : ''}`}>
                        <div className="rain-focus-ring" />
                        <input
                            type="password"
                            required
                            placeholder="••••••••"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            onFocus={() => setFocused('password')}
                            onBlur={() => setFocused(null)}
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
                    {loading ? 'Signing In…' : 'Authorize Session'}
                </button>
            </form>

            <button type="button" className="rain-link-btn" onClick={onGoJoin}>
                Have a G-Lead code? Join with a code
            </button>
            <button type="button" className="rain-link-btn" onClick={onGoRegister}>
                Don't have an account? Register your business
            </button>
        </MerchantAuthShell>
    );
}
