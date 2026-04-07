// supabase/functions/_shared/fcm.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Sends a push notification via Firebase FCM v1 API.
 * Expects FIREBASE_SERVICE_ACCOUNT_JSON to be set as a Supabase Secret (Base64 encoded).
 */
export async function sendPushNotification(
  supabaseAdmin: any,
  userId: string,
  payload: { title: string; body: string; data?: Record<string, string> }
) {
  try {
    // 1. Get user's push token
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('push_token')
      .eq('id', userId)
      .single();

    if (error || !profile?.push_token) {
      console.warn(`No push token found for user ${userId}`);
      return { success: false, error: 'No token' };
    }

    // 2. Get Firebase Token (OAuth2)
    const firebaseSecretB64 = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
    if (!firebaseSecretB64) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON secret not set");
    }

    const serviceAccount = JSON.parse(atob(firebaseSecretB64));
    const accessToken = await getAccessToken(serviceAccount);

    // 3. Send via FCM v1
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;
    
    const message = {
      message: {
        token: profile.push_token,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data || {},
        android: {
          priority: "high",
          notification: {
            sound: "default",
            click_action: "FLUTTER_NOTIFICATION_CLICK",
          },
        },
        apns: {
          payload: {
            aps: {
              content_available: true,
              sound: "default",
            },
          },
        },
      },
    };

    const response = await fetch(fcmUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });

    const result = await response.json();
    if (!response.ok) {
      console.error("FCM Error Details:", result);
      throw new Error(`FCM send failed: ${JSON.stringify(result)}`);
    }

    return { success: true, result };
  } catch (err) {
    console.error("sendPushNotification error:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Generates an OAuth2 Access Token for Firebase using the Service Account.
 * Minimal implementation to avoid heavy dependencies in Edge Functions.
 */
async function getAccessToken(serviceAccount: any): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: serviceAccount.token_uri,
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = btoa(JSON.stringify(header));
  const encodedClaim = btoa(JSON.stringify(claim));
  const signatureInput = `${encodedHeader}.${encodedClaim}`;

  // Sign with RSA (Simplified for Deno)
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBinary(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signatureInput)
  );

  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const jwt = `${signatureInput}.${encodedSignature}`;

  // Exchange JWT for Access Token
  const response = await fetch(serviceAccount.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Auth failed: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

function pemToBinary(pem: string): Uint8Array {
  const base64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
