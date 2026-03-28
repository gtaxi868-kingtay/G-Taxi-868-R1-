import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Activity, Database, Radio } from 'lucide-react';
import { LOGO_B64 } from '../logoUrl';


interface LoginProps {
    onLoginSuccess: () => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        const { error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            setError(error.message);
            setLoading(false);
        } else {
            onLoginSuccess();
        }
    };

    return (
        <div className="admin-login-page">
            {/* Background Glows (Inspired by Energy Drink ref) */}
            <div style={{ position: 'absolute', top: '10%', left: '10%', width: '40vw', height: '40vw', background: 'radial-gradient(circle, rgba(167, 139, 250, 0.1) 0%, transparent 70%)', filter: 'blur(60px)', zIndex: 1 }} />
            <div style={{ position: 'absolute', bottom: '10%', right: '10%', width: '40vw', height: '40vw', background: 'radial-gradient(circle, rgba(125, 211, 252, 0.08) 0%, transparent 70%)', filter: 'blur(60px)', zIndex: 1 }} />

            <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                
                {/* Branding Section */}
                <div style={{ marginBottom: '3rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: '1.5rem' }}>
                        <img 
                            src={LOGO_B64} 
                            alt="G-Taxi Logo" 
                            style={{ 
                                height: '70px', 
                                minWidth: '70px',
                                width: 'auto', 
                                display: 'block',
                                objectFit: 'contain'
                            }}
                            className="animate-pulse-slow"
                        />
                    </div>
                    <div>
                        <h1 className="neon-text-purple font-orbitron" style={{ fontSize: '2.25rem', fontWeight: 900, letterSpacing: '0.05em', margin: 0, opacity: 0.9 }}>
                            G-TAXI<span style={{ color: 'white' }}> 868</span>
                        </h1>
                        <div className="hud-label-small" style={{ marginTop: '8px', opacity: 0.4 }}>Administrative Command & Control</div>
                    </div>
                </div>

                {/* Main Login Card */}
                <div className="admin-login-card">
                    <div style={{ width: '100%', textAlign: 'center', marginBottom: '2.5rem' }}>
                        <div className="hud-label-small" style={{ color: 'var(--elegant-purple)', opacity: 0.6 }}>Verification Required</div>
                        <div style={{ height: '1px', width: '3rem', background: 'linear-gradient(90deg, transparent, var(--elegant-purple), transparent)', margin: '8px auto' }} />
                    </div>

                    <form onSubmit={handleLogin} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div className="admin-input-group">
                            <label className="admin-input-label">Operator Identification</label>
                            <input
                                type="email"
                                required
                                placeholder="operator@gtaxi868.com"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                className="admin-input"
                            />
                        </div>

                        <div className="admin-input-group">
                            <label className="admin-input-label">Security Access Key</label>
                            <input
                                type="password"
                                required
                                placeholder="••••••••"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                className="admin-input"
                            />
                        </div>

                        {error && (
                            <div style={{ width: '100%', maxWidth: '320px', margin: '1rem 0', padding: '1rem', borderRadius: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', textAlign: 'center' }}>
                                <span style={{ fontSize: '11px', fontWeight: 800, color: '#f87171' }}>{error}</span>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="admin-btn-tactical"
                        >
                            {loading ? 'Authorizing...' : 'login'}
                        </button>
                    </form>

                    <div style={{ marginTop: '2.5rem', display: 'flex', gap: '2rem', opacity: 0.2 }}>
                        <Database size={14} color="#7DD3FC" />
                        <Radio size={14} color="#A78BFA" />
                        <Activity size={14} color="#7DD3FC" />
                    </div>
                </div>

                {/* Subtle HUD Footer */}
                <div style={{ marginTop: '3rem', opacity: 0.15 }}>
                    <div className="hud-label-small" style={{ letterSpacing: '0.8em' }}>Terminal Secure // Relay 868</div>
                </div>
            </div>
        </div>
    );


}
