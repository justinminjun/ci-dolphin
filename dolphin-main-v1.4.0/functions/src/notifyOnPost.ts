import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

// New-content notifications: when someone posts in the F&S Lounge (Community)
// or lists an item on the Market, push a notification to everyone — except the
// author, and except users who turned the category off (notifPrefs).
//
// Push tokens are read SERVER-SIDE only (admin SDK), so clients never see other
// users' tokens, and a client can't trigger a mass push by spoofing — only a
// real Firestore create fires this. Push-only (no per-user in-app docs) to keep
// the bell uncluttered, matching the "ambient announcement" feel.

// Lounge categories that DO notify. Tips / Life Info / Food/Dining / Housing
// are intentionally excluded (too high-frequency / low-signal for everyone).
const LOUNGE_NOTIFY_CATEGORIES = ["general", "question", "event"];

interface ExpoMessage {
  to: string;
  sound: "default";
  title: string;
  body: string;
  data: Record<string, any>;
}

// Fan out a push to every eligible user. prefKey gates against users/{uid}.notifPrefs.
async function fanOutPush(opts: {
  excludeUid?: string;
  prefKey: "lounge" | "market";
  title: string;
  body: string;
  data: Record<string, any>;
}): Promise<void> {
  const db = admin.firestore();
  const usersSnap = await db.collection("users").get();

  const messages: ExpoMessage[] = [];
  const tokenToUid = new Map<string, string>();
  let noToken = 0;
  usersSnap.forEach((doc) => {
    if (opts.excludeUid && doc.id === opts.excludeUid) return;
    const u = doc.data() || {};
    const prefs = u.notifPrefs || {};
    if (prefs.all === false) return;            // master off
    if (prefs[opts.prefKey] === false) return;  // this category off
    const token: string | undefined = u.pushToken;
    if (!token) { noToken++; return; }
    tokenToUid.set(token, doc.id);
    messages.push({ to: token, sound: "default", title: opts.title, body: opts.body, data: opts.data });
  });

  // Expo accepts up to 100 messages per request. Inspect tickets so failures
  // are visible in logs, and drop tokens Expo says are dead so the recipient
  // count reflects reality.
  let ok = 0, failed = 0;
  const deadTokens: string[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chunk),
      });
      const json: any = await res.json();
      const tickets: any[] = json?.data || [];
      tickets.forEach((t, idx) => {
        if (t.status === "ok") { ok++; return; }
        failed++;
        const err = t.details?.error || t.message || "unknown";
        console.warn(`push ticket error [${err}] for ${chunk[idx]?.to?.slice(0, 30)}`);
        if (t.details?.error === "DeviceNotRegistered") deadTokens.push(chunk[idx].to);
      });
    } catch (e) {
      failed += chunk.length;
      console.error("Expo push chunk failed:", e);
    }
  }

  // Remove dead tokens so users re-register on next app open.
  for (const token of deadTokens) {
    const uid = tokenToUid.get(token);
    if (!uid) continue;
    try {
      await db.doc(`users/${uid}`).update({ pushToken: admin.firestore.FieldValue.delete() });
      console.log(`removed dead pushToken for ${uid}`);
    } catch { /* non-fatal */ }
  }

  console.log(`fanOutPush[${opts.prefKey}]: sent=${ok} failed=${failed} noToken=${noToken} (dead removed: ${deadTokens.length})`);
}

// ── F&S Lounge: new post ──
export const onLoungePostCreated = onDocumentCreated(
  { document: "lounge_posts/{postId}", memory: "256MiB" },
  async (event) => {
    const post = event.data?.data();
    if (!post) return;
    if (!LOUNGE_NOTIFY_CATEGORIES.includes(post.category)) return;

    const titleText = (post.title || "New post").toString().trim().slice(0, 80);
    const bodyText = (post.body || "").toString().replace(/\s+/g, " ").trim().slice(0, 140)
      || "Tap to read the latest in the F&S Lounge.";

    await fanOutPush({
      excludeUid: post.authorId,
      prefKey: "lounge",
      title: `[F&S Lounge] ${titleText}`,
      body: bodyText,
      data: { type: "lounge", postId: event.params.postId },
    });
  }
);

// ── Market: new listing (generic message; one notification per multi-item batch) ──
export const onMarketListingCreated = onDocumentCreated(
  { document: "market_listings/{listingId}", memory: "256MiB" },
  async (event) => {
    const listing = event.data?.data();
    if (!listing) return;

    // Multi-item bundles share a batchId — only notify once for the whole batch.
    if (listing.batchId) {
      const markerRef = admin.firestore().doc(`notif_batches/${listing.batchId}`);
      const isFirst = await admin.firestore().runTransaction(async (tx) => {
        const m = await tx.get(markerRef);
        if (m.exists) return false;
        tx.set(markerRef, { createdAt: admin.firestore.FieldValue.serverTimestamp() });
        return true;
      });
      if (!isFirst) return;
    }

    const buying = listing.listingType === "buying";
    await fanOutPush({
      excludeUid: listing.sellerId,
      prefKey: "market",
      title: "🛍️ Dolphin Market",
      body: buying
        ? "Someone is looking to buy something new — tap to see the Market."
        : "A new item was just listed on the Market.",
      data: { type: "market", listingId: event.params.listingId },
    });
  }
);
