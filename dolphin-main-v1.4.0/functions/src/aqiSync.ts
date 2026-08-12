import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

// ─────────────────────────────────────────────────────────────────────────────
// AirKorea AQI Sync
//
// The app previously called the data.go.kr AirKorea API directly from every
// client with a shared key, which blew through the free daily quota
// ("API token quota exceeded") as the user base grew. This function is now the
// ONLY caller: it fetches the 아암 (Aam, Songdo) station every 15 minutes
// (96 calls/day, well under the 500/day quota) and writes the result to
// Firestore `app_config/aqi`, which the app reads instead.
// ─────────────────────────────────────────────────────────────────────────────

// data.go.kr service key (free public-data key; already URL-encoded)
const AIRKOREA_KEY =
  "R0X5pekrA8MUE15FBh0iu%2BwniCwbeIenDE2BugBNRZTzcx6IYSG%2BOSSDr6XIuSTgGazpJzzHrtHjrancrdMxoA%3D%3D";
const AIRKOREA_URL =
  "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty" +
  `?stationName=%EC%95%84%EC%95%94&dataTerm=daily&pageNo=1&numOfRows=1&returnType=json&serviceKey=${AIRKOREA_KEY}&ver=1.3`;

// Keyless fallback when AirKorea is unavailable (quota, outage). Only PM
// values — the gas readings use different units (µg/m³ vs ppm), so we zero
// them rather than mislead.
const OPENMETEO_AQI_URL =
  "https://air-quality-api.open-meteo.com/v1/air-quality" +
  "?latitude=37.3823&longitude=126.6617&current=pm2_5,pm10&timezone=Asia/Seoul";

async function fetchOpenMeteoFallback(): Promise<any | null> {
  try {
    const res = await fetch(OPENMETEO_AQI_URL);
    const json: any = await res.json();
    const cur = json?.current;
    if (!cur || typeof cur.pm2_5 !== "number") return null;
    return {
      pm25Value: String(Math.round(cur.pm2_5)),
      pm10Value: String(Math.round(cur.pm10)),
      o3Value: "0", no2Value: "0", so2Value: "0", coValue: "0",
      dataTime: (cur.time || "").replace("T", " "),
      source: "open-meteo",
    };
  } catch {
    return null;
  }
}

async function syncAQI(): Promise<{ success: boolean; message: string }> {
  const db = admin.firestore();

  const res = await fetch(AIRKOREA_URL);
  const text = await res.text();

  let item: any = null;
  try {
    const json = JSON.parse(text);
    item = json?.response?.body?.items?.[0] ?? null;
    if (item) item.source = "airkorea";
  } catch {
    // Non-JSON body (e.g. "API token quota exceeded") — try the fallback.
    item = await fetchOpenMeteoFallback();
    if (!item) {
      await db.doc("app_config/aqi").set(
        {
          lastError: text.slice(0, 200),
          lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return { success: false, message: `AirKorea non-JSON response: ${text.slice(0, 100)}` };
    }
  }

  if (!item) {
    item = await fetchOpenMeteoFallback();
    if (!item) return { success: false, message: "AirKorea returned no items and fallback failed" };
  }

  await db.doc("app_config/aqi").set(
    {
      pm25: parseFloat(item.pm25Value) || 0,
      pm10: parseFloat(item.pm10Value) || 0,
      o3: parseFloat(item.o3Value) || 0,
      no2: parseFloat(item.no2Value) || 0,
      so2: parseFloat(item.so2Value) || 0,
      co: parseFloat(item.coValue) || 0,
      dataTime: item.dataTime || "",
      station: "아암 (Aam)",
      source: item.source || "airkorea",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastError: null,
    },
    { merge: true }
  );

  return { success: true, message: `AQI updated [${item.source}]: PM2.5=${item.pm25Value} PM10=${item.pm10Value} (${item.dataTime})` };
}

export const scheduledAqiSync = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "Asia/Seoul",
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async () => {
    const result = await syncAQI();
    console.log(result.message);
    if (!result.success) throw new Error(result.message);
  }
);

export const syncAqiHttp = onRequest(
  { memory: "256MiB", timeoutSeconds: 60, cors: true },
  async (_req, res) => {
    try {
      const result = await syncAQI();
      res.status(result.success ? 200 : 502).json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }
);
