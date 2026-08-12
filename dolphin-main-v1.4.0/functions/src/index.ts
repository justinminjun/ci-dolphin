import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";

admin.initializeApp();

// ── Re-export Veracross calendar sync functions (v2) ──
export { scheduledCalendarSync, syncCalendarHttp } from "./calendarSync";

// ── Re-export weekly lunch menu sync functions ──
export { scheduledMenuSync, syncMenuHttp } from "./menuSync";

// ── Re-export AirKorea AQI sync (server-side proxy; see aqiSync.ts) ──
export { scheduledAqiSync, syncAqiHttp } from "./aqiSync";

// ── New-content push notifications (Lounge posts + Market listings) ──
export { onLoungePostCreated, onMarketListingCreated } from "./notifyOnPost";

// ─────────────────────────────────────────────────────────────────────────────
// 1) Gemini API Proxy — keeps API key server-side only
// ─────────────────────────────────────────────────────────────────────────────

const GEMINI_PROMPT = `You are an AI assistant for a school's Lost & Found app. Analyze this image of a lost or found item.

Return a JSON object with strictly these keys:
- "title": a short, clear name for the item (e.g. "MacBook Pro Laptop")
- "description": a brief but detailed visual description (2-3 sentences)
- "color": primary color of the item
- "brand": any recognizable brand, or empty string
- "category": one of: Electronics, Clothing, Accessories, Stationery, Bag, Sports, Books, Other
- "tags": an array of exactly 4 hashtag-style feature keywords (without the # symbol). These should describe key visual features, material, or distinguishing marks. Examples: ["silver", "Apple logo", "13-inch", "sticker on lid"]

Only return the raw JSON object, no markdown formatting, no code blocks.`;

export const analyzeImage = functions.https.onCall(async (request) => {
  // ── Auth check ──
  if (!request.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "You must be logged in."
    );
  }

  const { base64Image } = request.data;
  if (!base64Image || typeof base64Image !== "string") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "base64Image is required."
    );
  }

  // Limit image size (5 MB base64 ≈ 6.67 MB string)
  if (base64Image.length > 7_000_000) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Image too large. Max 5 MB."
    );
  }

  // ── Rate limiting (10 calls per user per hour) ──
  const uid = request.auth.uid;
  const rateLimitRef = admin.firestore().doc(`rate_limits/${uid}_gemini`);
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;

  const rateLimitSnap = await rateLimitRef.get();
  if (rateLimitSnap.exists) {
    const data = rateLimitSnap.data()!;
    const windowStart = data.windowStart || 0;
    const count = data.count || 0;

    if (now - windowStart < oneHour && count >= 10) {
      throw new functions.https.HttpsError(
        "resource-exhausted",
        "Rate limit exceeded. Try again later."
      );
    }

    if (now - windowStart >= oneHour) {
      await rateLimitRef.set({ windowStart: now, count: 1 });
    } else {
      await rateLimitRef.update({ count: admin.firestore.FieldValue.increment(1) });
    }
  } else {
    await rateLimitRef.set({ windowStart: now, count: 1 });
  }

  // ── Call Gemini ──
  const apiKey = process.env.GEMINI_API_KEY || functions.config().gemini?.key || "";
  if (!apiKey) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Gemini API key not configured on server."
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  try {
    const result = await model.generateContent([
      GEMINI_PROMPT,
      { inlineData: { data: base64Image, mimeType: "image/jpeg" } },
    ]);
    const response = await result.response;
    const text = response.text();
    const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (error: any) {
    console.error("Gemini API error:", error);
    throw new functions.https.HttpsError(
      "internal",
      "Failed to analyze image."
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) Admin verification — server-side check for sensitive operations
// ─────────────────────────────────────────────────────────────────────────────

export const verifyAdmin = functions.https.onCall(async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Not logged in.");
  }

  const email = request.auth.token.email?.toLowerCase();
  if (!email) {
    return { isAdmin: false };
  }

  // Check Firestore config
  const configSnap = await admin.firestore().doc("config/access").get();
  const adminEmails: string[] = configSnap.exists
    ? (configSnap.data()?.adminEmails || []).map((e: string) => e.toLowerCase())
    : [];

  // Hardcoded fallback
  const fallback = ["jyyang@chadwickschool.org"];
  const allAdmins = [...new Set([...fallback, ...adminEmails])];

  return { isAdmin: allAdmins.includes(email) };
});

// ─────────────────────────────────────────────────────────────────────────────
// 3) Secure push notification sender — prevents token spoofing
// ─────────────────────────────────────────────────────────────────────────────

export const sendNotification = functions.https.onCall(async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Not logged in.");
  }

  const { recipientId, title, body, data } = request.data;
  if (!recipientId || !title) {
    throw new functions.https.HttpsError("invalid-argument", "Missing fields.");
  }

  // Look up recipient's push token
  const userSnap = await admin.firestore().doc(`users/${recipientId}`).get();
  if (!userSnap.exists) return { sent: false, reason: "user_not_found" };

  const pushToken = userSnap.data()?.pushToken;
  if (!pushToken) return { sent: false, reason: "no_token" };

  // Send via Expo Push API
  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: pushToken,
        sound: "default",
        title,
        body,
        data: data || {},
      }),
    });
    return { sent: true };
  } catch (error) {
    console.error("Push send error:", error);
    return { sent: false, reason: "send_failed" };
  }
});
