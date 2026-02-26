// supabase/functions/_shared/push.ts
// Phase 5 Fix 5.5 — Shared push notification helper using Firebase FCM HTTP v1 API.
//
// The legacy FCM API (/send) is deprecated. This uses the HTTP v1 API:
//   POST https://fcm.googleapis.com/v1/projects/{project_id}/messages:send
//
// Authentication: A short-lived OAuth2 Bearer token obtained by signing a JWT
// with the service account private key, then exchanging it at Google's token endpoint.
//
// The FIREBASE_SERVICE_ACCOUNT_JSON secret must be a base64-encoded JSON string
// of the Firebase service account credentials file (the file you download from
// Firebase Console → Project Settings → Service Accounts → Generate new private key).
// Encode it: base64 -i service-account.json | tr -d '\n'

// ── JWT Signing for Google OAuth2 ─────────────────────────────────────────────

/** Convert a base64url-encoded string to a Uint8Array. */
function base64urlToBytes(b64url: string): Uint8Array {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '=');
    const binary = atob(padded);
    return Uint8Array.from(binary, c => c.charCodeAt(0));
}

/** Convert a PEM-encoded RSA private key to a CryptoKey for RS256 signing. */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
    const pemContents = pem
        .replace(/-----BEGIN PRIVATE KEY-----/g, '')
        .replace(/-----END PRIVATE KEY-----/g, '')
        .replace(/\s+/g, '');
    const binaryDer = base64urlToBytes(pemContents);
    return crypto.subtle.importKey(
        'pkcs8',
        binaryDer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
    );
}

/** Build and sign a Google OAuth2 JWT, then exchange it for an access token. */
async function getGoogleAccessToken(serviceAccount: {
    client_email: string;
    private_key: string;
    project_id: string;
}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600;

    // Encode header and claim set
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    const payload = btoa(JSON.stringify({
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: expiry,
    })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    const signingInput = `${header}.${payload}`;
    const privateKey = await importPrivateKey(serviceAccount.private_key);

    const signatureBytes = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        privateKey,
        new TextEncoder().encode(signingInput)
    );

    const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    const jwt = `${signingInput}.${signature}`;

    // Exchange JWT for short-lived access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt,
        }),
    });

    if (!tokenRes.ok) {
        const err = await tokenRes.text();
        throw new Error(`Failed to get Google access token: ${err}`);
    }

    const tokenData = await tokenRes.json();
    return tokenData.access_token as string;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send a push notification via Firebase FCM HTTP v1 API.
 *
 * @param pushToken  The Expo push token stored on the driver/rider profile.
 * @param title      Notification title (shown on lock screen).
 * @param body       Notification body text.
 * @param data       Custom key-value payload delivered to the app (type, ride_id, etc.)
 */
export async function sendPushNotification(
    pushToken: string,
    title: string,
    body: string,
    data: Record<string, string>
): Promise<void> {
    if (!pushToken) {
        console.warn('sendPushNotification: no push token provided, skipping.');
        return;
    }

    const serviceAccountB64 = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON');
    if (!serviceAccountB64) {
        console.error('sendPushNotification: FIREBASE_SERVICE_ACCOUNT_JSON secret not set.');
        return;
    }

    let serviceAccount: { client_email: string; private_key: string; project_id: string };
    try {
        serviceAccount = JSON.parse(atob(serviceAccountB64));
    } catch {
        console.error('sendPushNotification: Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON.');
        return;
    }

    let accessToken: string;
    try {
        accessToken = await getGoogleAccessToken(serviceAccount);
    } catch (err) {
        console.error('sendPushNotification: Failed to obtain access token:', err);
        return;
    }

    // Expo push tokens can be either native FCM tokens or Expo-wrapped tokens.
    // If it's an Expo token (ExponentPushToken[...]), we send via Expo's push service.
    // If it's a bare FCM token, we send directly via FCM HTTP v1.
    if (pushToken.startsWith('ExponentPushToken')) {
        // ── Route via Expo Push Service ──────────────────────────────────────
        // Expo wraps FCM for us so we don't need to manage the access token.
        const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ to: pushToken, title, body, data, priority: 'high', sound: 'default' }),
        });
        if (!expoRes.ok) {
            console.error('Expo push failed:', await expoRes.text());
        }
        return;
    }

    // ── Route via FCM HTTP v1 directly (native FCM token) ────────────────────
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;

    const fcmRes = await fetch(fcmUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            message: {
                token: pushToken,
                notification: { title, body },
                data,
                android: { priority: 'high' },
                apns: {
                    payload: {
                        aps: { contentAvailable: true, sound: 'default' },
                    },
                },
            },
        }),
    });

    if (!fcmRes.ok) {
        console.error('FCM HTTP v1 push failed:', await fcmRes.text());
    }
}
