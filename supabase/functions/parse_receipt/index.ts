// Phase 4: parse_receipt — OCR receipt parsing via Google Cloud Vision API.
// Driver uploads receipt photo → edge function downloads it → extracts
// amount_cents, reference_token, deposit_date, bank_name.
// Falls back to returning the URL if Vision API not configured.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_APPLICATION_CREDENTIALS_B64 = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ReceiptResult {
  amount_cents: number | null;
  reference_token: string | null;
  deposit_date: string | null;
  bank_name: string | null;
  ocr_text: string | null;
  ocr_available: boolean;
  confidence: number | null;
}

function res(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractAmountFromText(text: string): number | null {
  const patterns = [
    /(?:TTD|TT|\\$|total|amount)[:\\s]*([0-9,]+(?:\\.[0-9]{2})?)/i,
    /([0-9,]+(?:\\.[0-9]{2})?)\\s*(?:TTD|TT|\\$)/i,
    /(?:deposit|credit|payment)[:\\s]*([0-9,]+(?:\\.[0-9]{2})?)/i,
    /balance[\\s:]*([0-9,]+(?:\\.[0-9]{2})?)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const cleaned = m[1].replace(/,/g, "");
      const val = parseFloat(cleaned);
      if (!isNaN(val) && val > 0) return Math.round(val * 100);
    }
  }
  return null;
}

function extractReferenceFromText(text: string): string | null {
  const patterns = [
    /(?:ref|reference|receipt|trans[\\s-]?id|trx)[:\\s#]*([A-Z0-9]{6,20})/i,
    /([A-Z0-9]{8,20})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1].length >= 6) return m[1];
  }
  return null;
}

function extractDateFromText(text: string): string | null {
  const patterns = [
    /(\\d{1,2})[\\/\\-](\\d{1,2})[\\/\\-](\\d{2,4})/,
    /(\\d{4})[\\/\\-](\\d{1,2})[\\/\\-](\\d{1,2})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0];
  }
  return null;
}

function extractBankFromText(text: string): string | null {
  const banks = [
    "RBTT", "RBC", "Royal Bank", "First Citizens", "FCB",
    "Republic Bank", "Scotiabank", "Bank of Baroda",
    "CIBC FirstCaribbean", "JMMB", "Unit Trust", "UTT",
    "WiPay", "Smart ATM",
  ];
  for (const bank of banks) {
    if (text.includes(bank)) return bank;
  }
  return null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(
      authHeader?.replace("Bearer ", "") ?? ""
    );
    if (authErr || !user) return res(401, { success: false, error: "Unauthorized" });

    const { photo_url } = await req.json();
    if (!photo_url) return res(400, { success: false, error: "photo_url required" });

    let fullUrl = photo_url;
    if (!photo_url.startsWith("http")) {
      fullUrl = `${SUPABASE_URL}/storage/v1/object/public/receipts/${photo_url}`;
    }

    let ocrText: string | null = null;
    let ocrAvailable = false;
    let confidence: number | null = null;

    if (GOOGLE_APPLICATION_CREDENTIALS_B64) {
      try {
        const credentials = JSON.parse(atob(GOOGLE_APPLICATION_CREDENTIALS_B64));
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion: await createJwt(credentials),
          }),
        });
        const { access_token } = await tokenRes.json();

        const photoResp = await fetch(fullUrl);
        const photoBuffer = await photoResp.arrayBuffer();
        const base64Image = btoa(
          new Uint8Array(photoBuffer).reduce((d, b) => d + String.fromCharCode(b), "")
        );

        const visionRes = await fetch(
          `https://vision.googleapis.com/v1/images:annotate`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              requests: [{
                image: { content: base64Image },
                features: [{ type: "TEXT_DETECTION", maxResults: 1 }],
              }],
            }),
          }
        );

        const visionData = await visionRes.json();
        if (visionData.responses?.[0]?.textAnnotations?.[0]) {
          ocrText = visionData.responses[0].textAnnotations[0].description;
          confidence = visionData.responses[0].textAnnotations[0].confidence ?? null;
          ocrAvailable = true;
        }
      } catch (e) {
        console.error("Vision API call failed:", e);
      }
    }

    const result: ReceiptResult = {
      amount_cents: ocrText ? extractAmountFromText(ocrText) : null,
      reference_token: ocrText ? extractReferenceFromText(ocrText) : null,
      deposit_date: ocrText ? extractDateFromText(ocrText) : null,
      bank_name: ocrText ? extractBankFromText(ocrText) : null,
      ocr_text: ocrText,
      ocr_available: ocrAvailable,
      confidence,
    };

    return res(200, { success: true, data: result });
  } catch (error: any) {
    console.error("parse_receipt error:", error);
    if (error instanceof Response) return error;
    return res(500, { success: false, error: "Internal server error" });
  }
});

async function createJwt(serviceAccount: {
  client_email: string;
  private_key: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const payload = btoa(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const signingInput = `${header}.${payload}`;
  const pem = serviceAccount.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binaryDer = Uint8Array.from(
    atob(pem.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0)
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  return `${signingInput}.${signature}`;
}
