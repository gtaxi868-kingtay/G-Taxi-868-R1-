import { LOGO_B64 } from '../logoUrl';

// Shared "crystal liquid glass" scaffold for every merchant auth screen
// (login, register, join-with-code) — same pattern as
// apps/admin/src/pages/Login.tsx, ported once here so login/register/join
// don't each carry their own copy of the shard/seam CSS. Real merchant
// voice tokens (packages/design-system/src/tokens.ts): teal-black base,
// bright teal accent, copper as the metal.
export const MERCHANT_VOICE = {
    canvas: ['#070C0B', '#0A1210', '#0C1614'],
    accent: '#2DD4BF',
    metal: '#D9A06B',
    signature: ['#2DD4BF', '#C08552'],
    ctaFrom: '#0F766E',
    ctaTo: '#2DD4BF',
    ctaText: '#070C0B',
};

const SHARDS = [
    { x: -25, y: -12, w: 85, h: 30, angle: -16, skew: -6, o: 0.030 },
    { x: 45, y: -16, w: 85, h: 34, angle: 11, skew: 5, o: 0.020 },
    { x: -30, y: 26, w: 75, h: 30, angle: 27, skew: -4, o: 0.025 },
    { x: 60, y: 34, w: 70, h: 28, angle: -24, skew: 7, o: 0.018 },
    { x: -15, y: 74, w: 90, h: 32, angle: 7, skew: -8, o: 0.028 },
    { x: 40, y: 80, w: 80, h: 30, angle: -13, skew: 4, o: 0.022 },
];

const [A, B] = MERCHANT_VOICE.signature;
const SEAMS = [
    { x: 2, y: 11.5, len: 52, angle: -16, color: A, thickness: 2, delay: 0, dur: 4600 },
    { x: 55, y: 7.5, len: 48, angle: 11, color: B, thickness: 1.5, delay: 1200, dur: 5200 },
    { x: 68, y: 22, len: 30, angle: 64, color: A, thickness: 1.5, delay: 2600, dur: 3800 },
    { x: -4, y: 40, len: 44, angle: 27, color: B, thickness: 2, delay: 800, dur: 4200 },
    { x: 62, y: 47, len: 42, angle: -24, color: A, thickness: 1.5, delay: 2000, dur: 5600 },
    { x: 6, y: 62, len: 26, angle: 80, color: B, thickness: 1.5, delay: 3400, dur: 4400 },
    { x: 10, y: 83, len: 58, angle: 7, color: A, thickness: 2, delay: 400, dur: 4800 },
    { x: 52, y: 90, len: 46, angle: -13, color: B, thickness: 2.5, delay: 1600, dur: 4000 },
];

interface MerchantAuthShellProps {
    subtitle: string;
    badge?: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
}

export function MerchantAuthShell({ subtitle, badge, children, footer }: MerchantAuthShellProps) {
    return (
        <div className="rain-root">
            <style>{`
                .rain-root {
                    min-height: 100vh;
                    position: relative;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    overflow: hidden;
                    background: linear-gradient(160deg, ${MERCHANT_VOICE.canvas[0]}, ${MERCHANT_VOICE.canvas[1]} 55%, ${MERCHANT_VOICE.canvas[2]});
                    padding: 24px;
                }
                .rain-shard {
                    position: absolute;
                    border-top: 1px solid rgba(255,255,255,0.07);
                }
                .rain-seam-wrap {
                    position: absolute;
                    animation: gt-breathe var(--dur) ease-in-out var(--delay) infinite alternate;
                }
                .rain-seam-track {
                    position: relative;
                    overflow: hidden;
                    border-radius: 999px;
                }
                .rain-seam-sweep {
                    position: absolute;
                    top: 0; left: 0;
                    opacity: 0;
                    animation: gt-sweep var(--cycle) ease-in-out var(--sdelay) infinite;
                }
                @keyframes gt-breathe { from { opacity: .5 } to { opacity: 1 } }
                @keyframes gt-sweep {
                    0% { transform: translateX(calc(var(--seg) * -1)); opacity: 0; }
                    6% { opacity: 1; }
                    80% { opacity: 1; }
                    88% { transform: translateX(var(--len)); opacity: 0; }
                    100% { transform: translateX(var(--len)); opacity: 0; }
                }
                @keyframes gt-enter { from { opacity: 0; transform: translateY(14px) scale(.97); } to { opacity: 1; transform: none; } }
                @keyframes gt-logo-in { from { opacity: 0; transform: scale(.8); } to { opacity: 1; transform: scale(1); } }
                @keyframes gt-breath { from { transform: scale(1); } to { transform: scale(1.03); } }
                .rain-content { position: relative; z-index: 2; width: 100%; max-width: 440px; display: flex; flex-direction: column; align-items: center; }
                .rain-logo-block { display: flex; flex-direction: column; align-items: center; margin-bottom: 4px; animation: gt-logo-in 650ms cubic-bezier(.34,1.56,.64,1) both; }
                .rain-logo-breath { display: flex; flex-direction: column; align-items: center; animation: gt-breath 3200ms ease-in-out infinite alternate; }
                .rain-logo-img {
                    width: min(46vw, 150px); height: min(46vw, 150px); object-fit: contain; display: block;
                    filter: drop-shadow(0 0 24px ${MERCHANT_VOICE.accent}55);
                }
                .rain-badge {
                    display: flex; align-items: center; justify-content: center; gap: 8px;
                    margin-top: 12px; font-size: 11px; font-weight: 700; letter-spacing: 2px;
                    color: ${MERCHANT_VOICE.accent}; text-transform: uppercase;
                }
                .rain-title { color: #E9F5F3; font-size: 22px; font-weight: 800; letter-spacing: 2px; margin: 10px 0 0; text-align: center; }
                .rain-subtitle { color: ${MERCHANT_VOICE.metal}; font-size: 11px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; margin: 4px 0 0; text-align: center; }
                .rain-card-shell {
                    width: 100%;
                    border-radius: 24px;
                    overflow: hidden;
                    border: 1px solid rgba(255,255,255,0.14);
                    position: relative;
                    margin-top: 28px;
                    animation: gt-enter 450ms cubic-bezier(.23,1,.32,1) 120ms both;
                }
                .rain-lit-edge {
                    position: absolute; top: 0; left: 0; right: 0; height: 1.5px; z-index: 2;
                    background: linear-gradient(90deg, ${MERCHANT_VOICE.signature[0]}, ${MERCHANT_VOICE.signature[1]});
                }
                .rain-card {
                    background: rgba(10,18,16,0.55);
                    backdrop-filter: blur(26px);
                    -webkit-backdrop-filter: blur(26px);
                    padding: 32px 28px;
                    position: relative;
                }
                .rain-field { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
                .rain-label { color: rgba(233,245,243,0.5); font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; margin-left: 2px; transition: color 160ms ease; }
                .rain-label.focused { color: ${MERCHANT_VOICE.accent}; }
                .rain-input-shell { position: relative; border-radius: 16px; }
                .rain-focus-ring {
                    position: absolute; inset: 0; border-radius: 16px; border: 1.5px solid ${MERCHANT_VOICE.accent};
                    box-shadow: 0 0 10px ${MERCHANT_VOICE.accent}55;
                    opacity: 0; transition: opacity 180ms ease; pointer-events: none;
                }
                .rain-input-shell.focused .rain-focus-ring { opacity: 1; }
                .rain-input {
                    width: 100%; min-height: 56px; border-radius: 16px; padding: 0 18px;
                    background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.14);
                    color: #E9F5F3; font-size: 16px; font-weight: 500; box-sizing: border-box;
                }
                .rain-input::placeholder { color: rgba(233,245,243,0.28); }
                .rain-input:focus { outline: none; }
                .rain-error {
                    display: flex; align-items: center; gap: 8px;
                    background: rgba(255,77,77,0.08); border: 1px solid rgba(255,77,77,0.15);
                    border-radius: 10px; padding: 10px 14px; margin-bottom: 18px;
                }
                .rain-error span { color: #FF6B6B; font-size: 12px; font-weight: 600; }
                .rain-notice {
                    display: flex; align-items: center; gap: 8px;
                    background: ${MERCHANT_VOICE.accent}18; border: 1px solid ${MERCHANT_VOICE.accent}40;
                    border-radius: 10px; padding: 10px 14px; margin-bottom: 18px;
                }
                .rain-notice span { color: ${MERCHANT_VOICE.accent}; font-size: 12px; font-weight: 600; line-height: 1.5; }
                .rain-btn {
                    width: 100%; height: 56px; border-radius: 16px; border: none; cursor: pointer;
                    position: relative; overflow: hidden;
                    background: linear-gradient(135deg, ${MERCHANT_VOICE.ctaFrom}, ${MERCHANT_VOICE.ctaTo});
                    color: ${MERCHANT_VOICE.ctaText}; font-size: 16px; font-weight: 800;
                    letter-spacing: 1.5px; text-transform: uppercase;
                    transition: transform 140ms ease, opacity 140ms ease;
                }
                .rain-btn:active:not(:disabled) { transform: scale(0.97); }
                .rain-btn:disabled { opacity: 0.55; cursor: not-allowed; }
                .rain-btn::after {
                    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 10px;
                    background: linear-gradient(180deg, rgba(255,255,255,0.45), rgba(255,255,255,0));
                    border-radius: 16px 16px 0 0; pointer-events: none;
                }
                .rain-link-btn {
                    width: 100%; margin-top: 16px; background: none; border: none; cursor: pointer;
                    color: rgba(233,245,243,0.4); font-size: 12px; font-weight: 600; text-align: center;
                }
                .rain-footer { margin-top: 24px; text-align: center; animation: gt-enter 450ms cubic-bezier(.23,1,.32,1) 200ms both; }
                .rain-footer-text { color: rgba(233,245,243,0.25); font-size: 10px; letter-spacing: 3px; text-transform: uppercase; }
                @media (prefers-reduced-motion: reduce) {
                    .rain-logo-breath, .rain-seam-sweep { animation: none; }
                    .rain-logo-block, .rain-card-shell, .rain-footer { animation: gt-fade 300ms ease both; }
                }
            `}</style>

            {/* Shattered-glass facet wall */}
            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
                {SHARDS.map((s, i) => (
                    <div key={i} className="rain-shard" style={{
                        left: `${s.x}%`, top: `${s.y}%`, width: `${s.w}%`, height: `${s.h}%`,
                        background: `rgba(255,255,255,${s.o})`,
                        transform: `rotate(${s.angle}deg) skewX(${s.skew}deg)`,
                    }} />
                ))}
                {SEAMS.map((s, i) => {
                    const segW = Math.max(s.len * 0.13, 3.5);
                    const cycle = 900 + s.len * 16 + 1400;
                    return (
                        <div key={i} className="rain-seam-wrap" style={{
                            left: `${s.x}%`, top: `${s.y}%`, opacity: 0.55,
                            transform: `rotate(${s.angle}deg)`,
                            ['--dur' as any]: `${s.dur}ms`, ['--delay' as any]: `${-s.delay}ms`,
                        }}>
                            <div className="rain-seam-track" style={{ width: `${s.len}vw`, height: s.thickness }}>
                                <div style={{
                                    position: 'absolute', inset: 0,
                                    background: `linear-gradient(90deg, ${s.color}00, ${s.color}, ${s.color}00)`,
                                }} />
                                <div className="rain-seam-sweep" style={{
                                    ['--seg' as any]: `${segW}vw`, ['--len' as any]: `${s.len}vw`,
                                    ['--cycle' as any]: `${cycle}ms`, ['--sdelay' as any]: `${-s.delay}ms`,
                                    width: `${segW}vw`, height: s.thickness,
                                    background: `linear-gradient(90deg, ${s.color}00, #FFFFFF, ${s.color}00)`,
                                }} />
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="rain-content">
                <div className="rain-logo-block">
                    <div className="rain-logo-breath">
                        <img src={LOGO_B64} alt="G-Taxi" className="rain-logo-img" />
                    </div>
                    {badge && <div className="rain-badge">{badge}</div>}
                    <h1 className="rain-title">{subtitle}</h1>
                    <p className="rain-subtitle">G-Taxi Partner Suite</p>
                </div>

                <div className="rain-card-shell">
                    <div className="rain-lit-edge" />
                    <div className="rain-card">
                        {children}
                    </div>
                </div>

                {footer && (
                    <div className="rain-footer">
                        <span className="rain-footer-text">{footer}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
