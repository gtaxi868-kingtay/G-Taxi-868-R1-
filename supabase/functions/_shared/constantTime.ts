// Constant-time secret comparison.
//
// `a === b` on secrets short-circuits at the first differing byte, and its runtime
// also varies with length. Over a network that signal is usually drowned in jitter,
// but it costs nothing to remove it. Comparing fixed-length SHA-256 digests means
// both the length and the per-byte exit are independent of the inputs.
//
// Use for cron secrets, webhook secrets, and API keys — never `===`.

export async function secretMatches(provided: string | null | undefined, expected: string): Promise<boolean> {
    // An unset expected secret must never validate: fail closed.
    if (!expected) return false;
    if (typeof provided !== "string" || provided.length === 0) return false;

    const enc = new TextEncoder();
    const [a, b] = await Promise.all([
        crypto.subtle.digest("SHA-256", enc.encode(provided)),
        crypto.subtle.digest("SHA-256", enc.encode(expected)),
    ]);

    const x = new Uint8Array(a);
    const y = new Uint8Array(b);
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
    return diff === 0;
}
