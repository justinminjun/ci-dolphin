import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";

// ─────────────────────────────────────────────────────────────────────────────
// Veracross Calendar Sync
// Fetches events from Veracross API and stores them in Firestore
// ─────────────────────────────────────────────────────────────────────────────

// Veracross API configuration
const VERACROSS_TOKEN_URL =
  "https://accounts.veracross.com/chadwickinternational/oauth/token";
const VERACROSS_EVENTS_URL =
  "https://api.veracross.com/chadwickinternational/v3/events/group_events";
// OAuth credentials are stored in Cloud Secret Manager — never in source.
// Set (or rotate) them with:
//   firebase functions:secrets:set VERACROSS_CLIENT_ID
//   firebase functions:secrets:set VERACROSS_CLIENT_SECRET
// They are mounted into the functions below via their `secrets` option and
// read at runtime with `.value()`.
const VERACROSS_CLIENT_ID = defineSecret("VERACROSS_CLIENT_ID");
const VERACROSS_CLIENT_SECRET = defineSecret("VERACROSS_CLIENT_SECRET");
const VERACROSS_SCOPE = "events.group_events:list events.group_events:read";

const PAGE_SIZE = 100;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Fetches an OAuth2 access token from Veracross using client credentials.
 */
async function getVeracrossToken(): Promise<string> {
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: VERACROSS_CLIENT_ID.value(),
    client_secret: VERACROSS_CLIENT_SECRET.value(),
    scope: VERACROSS_SCOPE,
  });

  const response = await fetch(VERACROSS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to get Veracross token: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

/**
 * Returns the date range: first day of current month → last day of next month.
 */
function getDateRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);

  const endDate = new Date(now.getFullYear(), now.getMonth() + 2, 0); // last day of next month

  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return { startDate: fmt(startDate), endDate: fmt(endDate) };
}

/**
 * Fetches all events from Veracross API with pagination.
 */
async function fetchAllEvents(
  token: string,
  startDate: string,
  endDate: string
): Promise<any[]> {
  let allEvents: any[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const url = new URL(VERACROSS_EVENTS_URL);
    url.searchParams.set("on_or_after_start_date", startDate);
    url.searchParams.set("on_or_before_end_date", endDate);

    // Veracross v3 rejects unknown query params ("page"); pagination is
    // header-based only (X-Page-Number / X-Page-Size).
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "X-Page-Size": String(PAGE_SIZE),
        "X-Page-Number": String(page),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch events (page ${page}): ${response.status} ${errorText}`
      );
    }

    const body = (await response.json()) as { data: any[] };
    const events = body.data || [];

    allEvents = allEvents.concat(events);

    // Check if there are more pages
    // Veracross uses X-Total-Count header or returns fewer than PAGE_SIZE
    const totalCount = response.headers.get("X-Total-Count");
    if (totalCount) {
      hasMore = allEvents.length < parseInt(totalCount, 10);
    } else {
      hasMore = events.length >= PAGE_SIZE;
    }

    page++;

    // Safety valve to prevent infinite loops
    if (page > 50) {
      console.warn("Hit page limit (50), stopping pagination.");
      break;
    }
  }

  return allEvents;
}

/**
 * Determines if an event is "all day" based on start/end times.
 */
function isAllDay(event: any): boolean {
  // If there are no specific times, or start_time is null, treat as all-day
  if (!event.start_time && !event.end_time) return true;
  // Some APIs explicitly flag this
  if (event.all_day !== undefined) return Boolean(event.all_day);
  return false;
}

/**
 * Maps a raw Veracross event to our Firestore document shape.
 */
function mapEventToDocument(event: any): Record<string, any> {
  // Veracross v3 group_events: the human-readable event name lives in
  // `description`; school level / event type come as *_description fields.
  // (Must stay in sync with scripts/seed_calendar.mjs.)
  return {
    title: event.description || "",
    location: event.location || "",
    startDate: event.start_date || null,
    endDate: event.end_date || event.start_date || null,
    startTime: event.start_time || null,
    endTime: event.end_time || null,
    allDay: isAllDay(event),
    schoolLevel: event.school_level_description || "",
    eventType: event.event_type_description || "",
    isPublic: event.public ?? true,
    // Extra metadata
    description: event.description || null,
    veracrossId: event.id,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  };
}

/**
 * Determines if an event should be filtered out.
 */
function shouldIncludeEvent(event: any): boolean {
  const desc = event.description;
  // Filter out events where description is null or 'None'
  if (desc === null || desc === undefined || desc === "None") {
    return false;
  }
  return true;
}

// ─── Core Sync Logic ─────────────────────────────────────────────────────────

async function syncCalendarEvents(): Promise<{
  success: boolean;
  eventCount: number;
  message: string;
}> {
  const db = admin.firestore();

  console.log("🔄 Starting Veracross calendar sync...");

  // 1. Get OAuth token
  console.log("🔑 Fetching Veracross OAuth token...");
  const token = await getVeracrossToken();

  // 2. Determine date range
  const { startDate, endDate } = getDateRange();
  console.log(`📅 Fetching events from ${startDate} to ${endDate}`);

  // 3. Fetch all events with pagination
  const rawEvents = await fetchAllEvents(token, startDate, endDate);
  console.log(`📥 Fetched ${rawEvents.length} raw events from Veracross`);

  // 4. Filter events
  const filteredEvents = rawEvents.filter(shouldIncludeEvent);
  console.log(
    `✅ ${filteredEvents.length} events after filtering (removed ${rawEvents.length - filteredEvents.length})`
  );

  // 5. Write to Firestore in batches (max 500 writes per batch)
  const BATCH_LIMIT = 500;
  let written = 0;

  for (let i = 0; i < filteredEvents.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    const chunk = filteredEvents.slice(i, i + BATCH_LIMIT);

    for (const event of chunk) {
      const docId = String(event.id);
      const docRef = db.collection("school_calendar").doc(docId);
      batch.set(docRef, mapEventToDocument(event), { merge: true });
    }

    await batch.commit();
    written += chunk.length;
    console.log(`📝 Written batch: ${written}/${filteredEvents.length}`);
  }

  // 6. Update sync metadata
  await db.doc("app_config/calendar_sync").set(
    {
      lastSync: admin.firestore.FieldValue.serverTimestamp(),
      lastSyncISO: new Date().toISOString(),
      eventCount: filteredEvents.length,
      dateRangeStart: startDate,
      dateRangeEnd: endDate,
      rawEventCount: rawEvents.length,
      filteredOutCount: rawEvents.length - filteredEvents.length,
    },
    { merge: true }
  );

  const message = `Calendar sync complete: ${filteredEvents.length} events stored (${startDate} → ${endDate})`;
  console.log(`✅ ${message}`);

  return { success: true, eventCount: filteredEvents.length, message };
}

// ─── Exported Cloud Functions (v2) ──────────────────────────────────────────

/**
 * Scheduled function — runs every hour to sync calendar events.
 */
export const scheduledCalendarSync = onSchedule(
  {
    schedule: "every 1 hours",
    timeZone: "Asia/Seoul",
    retryCount: 2,
    memory: "256MiB",
    timeoutSeconds: 120,
    secrets: [VERACROSS_CLIENT_ID, VERACROSS_CLIENT_SECRET],
  },
  async (_event) => {
    try {
      const result = await syncCalendarEvents();
      console.log("Scheduled sync result:", result);
    } catch (error) {
      console.error("❌ Scheduled calendar sync failed:", error);
      throw error; // Re-throw to trigger retry
    }
  }
);

/**
 * HTTPS function — manual trigger for calendar sync.
 * GET/POST https://<region>-<project>.cloudfunctions.net/syncCalendarHttp
 */
export const syncCalendarHttp = onRequest(
  {
    memory: "256MiB",
    timeoutSeconds: 120,
    cors: true,
    secrets: [VERACROSS_CLIENT_ID, VERACROSS_CLIENT_SECRET],
  },
  async (req, res) => {
    try {
      const result = await syncCalendarEvents();
      res.status(200).json(result);
    } catch (error: any) {
      console.error("❌ HTTP calendar sync failed:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Unknown error",
      });
    }
  }
);
