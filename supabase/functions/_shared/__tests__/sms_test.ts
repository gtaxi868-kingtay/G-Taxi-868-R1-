// WhatsApp Cloud API Tests
// Run: deno test --allow-env --allow-net supabase/functions/_shared/__tests__/sms_test.ts
// ============================================================

import { assertEquals, assertExists, assertStringIncludes } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { getDeepLink, getBusinessDeepLink } from "../sms.ts";

Deno.test("getDeepLink: builds correct wa.me URL with T&T phone", () => {
  const link = getDeepLink("18685551234", "Hello from G-Taxi");
  assertStringIncludes(link, "https://wa.me/18685551234");
  assertStringIncludes(link, encodeURIComponent("Hello from G-Taxi"));
});

Deno.test("getDeepLink: strips + prefix from phone", () => {
  const link = getDeepLink("+18685551234", "test");
  assertEquals(link.startsWith("https://wa.me/18685551234"), true);
});

Deno.test("getDeepLink: non-alphanumeric phone chars stripped", () => {
  const link = getDeepLink("1 (868) 555-1234", "test");
  assertEquals(link.startsWith("https://wa.me/18685551234"), true);
});

Deno.test("getDeepLink: encodes special chars in message", () => {
  const link = getDeepLink("18685551234", "GTAX_abc123_OFFLINE_REQUEST + more");
  assertStringIncludes(link, encodeURIComponent("GTAX_abc123_OFFLINE_REQUEST + more"));
});

Deno.test("getBusinessDeepLink: uses G-Taxi business line", () => {
  const link = getBusinessDeepLink("Need help with my ride");
  assertStringIncludes(link, "https://wa.me/18687031000");
  assertStringIncludes(link, encodeURIComponent("Need help with my ride"));
});

Deno.test("getBusinessDeepLink: delivers NFC offline request", () => {
  const tagId = "nfc-tag-42";
  const link = getBusinessDeepLink(`GTAX_${tagId}_OFFLINE_REQUEST`);
  assertStringIncludes(link, encodeURIComponent("GTAX_nfc-tag-42_OFFLINE_REQUEST"));
  assertEquals(link.includes("18687031000"), true);
});

Deno.test("getDeepLink: empty message produces valid URL", () => {
  const link = getDeepLink("18685551234", "");
  assertEquals(link, "https://wa.me/18685551234?text=");
});

Deno.test("getDeepLink: message with newlines is encoded", () => {
  const msg = "Line one\nLine two\nLine three";
  const link = getDeepLink("18685551234", msg);
  assertStringIncludes(link, "Line%20one");
  assertStringIncludes(link, "Line%20two");
  assertStringIncludes(link, "Line%20three");
});
