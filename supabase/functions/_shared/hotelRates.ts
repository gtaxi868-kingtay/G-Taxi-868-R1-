// Reads a nightly rate off a hotel's OWN rates page, so the hotel can accept
// it in one tap instead of typing it (founder, 2026-10-26). The result is only
// ever a SUGGESTION: it goes live when the hotel accepts it, and a foreign-
// currency price is never converted for them.
//
// Safety: the hotel supplies the address, so this is a server-side fetch of a
// user-chosen URL. Only public http(s) hostnames are fetched (no IP literals,
// no localhost/internal names, default ports only), redirects are followed by
// hand and re-checked, and at most 1 MB is read.

const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;

export function isSafePublicUrl(raw: string): URL | null {
    let u: URL;
    try { u = new URL(raw); } catch { return null; }
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    if (u.port && u.port !== "443" && u.port !== "80") return null;
    const h = u.hostname.toLowerCase();
    if (!h.includes(".") || /^[\d.]+$/.test(h) || h.includes(":") || h.startsWith("[")) return null;
    if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|svc|cluster)$/.test(h)) return null;
    if (/(^|\.)supabase\.(co|in)$/.test(h)) return null;   // never call ourselves
    return u;
}

export function htmlToText(html: string): string {
    return html
        .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#36;|&dollar;/g, "$")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*/g, "\n")
        .trim();
}

export type RateCandidate = {
    amount_text: string;
    currency: "TTD" | "USD" | null;
    rate_cents: number;
    excerpt: string;
    score: number;
};

const NIGHT = /(per\s*night|\/\s*night|a\s*night|nightly|per\s*room|\/\s*room|room\s*rate|rates?\s*from|from\s*$)/i;
const NOT_A_ROOM = /(deposit|tax|vat|fee|breakfast|transfer|parking|tour|minimum|discount|off\b|save)/i;

// Every money amount on the page with the words around it, scored by how
// likely it is to be the nightly room rate.
export function extractRateCandidates(text: string): RateCandidate[] {
    const out: RateCandidate[] = [];
    const re = /(TT\s?\$|TTD|US\s?\$|USD|\$)\s?(\d{1,3}(?:,\d{3})+|\d{2,6})(?:\.(\d{2}))?/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const sym = m[1].toUpperCase().replace(/\s/g, "");
        const currency = sym === "TT$" || sym === "TTD" ? "TTD" : sym === "US$" || sym === "USD" ? "USD" : null;
        const whole = Number(m[2].replace(/,/g, ""));
        const cents = whole * 100 + (m[3] ? Number(m[3]) : 0);
        if (!Number.isFinite(cents) || cents <= 0) continue;
        const before = text.slice(Math.max(0, m.index - 70), m.index);
        const after = text.slice(m.index + m[0].length, m.index + m[0].length + 70);
        const excerpt = `${before}${m[0]}${after}`.replace(/\s+/g, " ").trim();
        // Judge each amount by its own sentence only, so "Deposit TT$500" in
        // the next sentence never drags down "TT$1,250 per night".
        const segBefore = before.split(/[\n.;|]/).pop() || "";
        const segAfter = after.split(/[\n.;|,]/)[0] || "";
        let score = 0;
        if (NIGHT.test(segAfter) || NIGHT.test(segBefore.slice(-14))) score += 3;
        if (/room|suite|villa|cottage|apartment|studio|king|queen|double|single/i.test(segBefore + segAfter)) score += 1;
        if (currency) score += 1;
        if (NOT_A_ROOM.test(segBefore + segAfter)) score -= 3;
        // Plausible nightly room rates only (TT$50 to TT$100,000; US$10 to US$15,000).
        const limitLow = currency === "USD" ? 1_000 : 5_000;
        const limitHigh = currency === "USD" ? 1_500_000 : 10_000_000;
        if (cents < limitLow || cents > limitHigh) continue;
        out.push({ amount_text: m[0].trim(), currency, rate_cents: cents, excerpt, score });
    }
    return out.sort((a, b) => b.score - a.score || a.rate_cents - b.rate_cents);
}

// The single best guess, or null when nothing on the page looks like a rate.
// A bare "$" is shown to the hotel as unknown currency rather than guessed.
export function bestRate(text: string): RateCandidate | null {
    const c = extractRateCandidates(text);
    return c.length && c[0].score >= 3 ? c[0] : null;
}

export async function fetchPageText(rawUrl: string): Promise<{ ok: true; text: string; finalUrl: string } | { ok: false; error: string }> {
    const first = isSafePublicUrl(rawUrl);
    if (!first) return { ok: false, error: "That address can't be read. Use the public web address of your rates page." };
    let url: URL = first;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        let res: Response;
        try {
            res = await fetch(url.toString(), {
                redirect: "manual",
                headers: { "User-Agent": "G868-RateReader/1.0 (+hotel-requested rate check)", Accept: "text/html,application/xhtml+xml" },
                signal: AbortSignal.timeout(10_000),
            });
        } catch {
            return { ok: false, error: "Your website did not answer. Check the address and try again." };
        }
        if (res.status >= 300 && res.status < 400) {
            const next = res.headers.get("location");
            const nextUrl: URL | null = next ? isSafePublicUrl(new URL(next, url).toString()) : null;
            if (!nextUrl) return { ok: false, error: "Your website redirected somewhere we can't read." };
            url = nextUrl;
            continue;
        }
        if (!res.ok) return { ok: false, error: `Your website answered with error ${res.status}.` };
        const type = res.headers.get("content-type") || "";
        if (!/text\/html|application\/xhtml|text\/plain/i.test(type)) return { ok: false, error: "That page isn't a web page we can read." };
        const reader = res.body?.getReader();
        if (!reader) return { ok: false, error: "Your website sent an empty page." };
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (size < MAX_BYTES) {
            const { done, value } = await reader.read();
            if (done || !value) break;
            chunks.push(value);
            size += value.length;
        }
        reader.cancel().catch(() => {});
        const html = new TextDecoder().decode(chunks.length === 1 ? chunks[0] : new Uint8Array(chunks.flatMap((c) => [...c])));
        return { ok: true, text: htmlToText(html), finalUrl: url.toString() };
    }
    return { ok: false, error: "Your website redirected too many times." };
}
