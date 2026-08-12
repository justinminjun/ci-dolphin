/**
 * menuSync.ts — Cloud Function for automated weekly lunch menu sync
 * 
 * Runs every Sunday at 11:00 PM KST (14:00 UTC).
 * 1. Fetches menu images from Google Drive
 * 2. Extracts bilingual menu data via Gemini Vision
 * 3. All-or-nothing: commits only if all days succeed
 * 4. Days with no image → marked as holiday/closed
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { GoogleAuth } from "google-auth-library";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ─── Config ───
const DRIVE_ROOT_FOLDER_ID = "1nnUGhdiZsuohW6a9KVcvYz7gGAMpC1Dj";
const GEMINI_API_KEY = "AIzaSyAtsNj37PJ2Z6Nec7rFPczRDXIQHkF3VwQ";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
const MAX_RETRIES = 3;

// ─── Google Auth for Drive ───
const googleAuth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});

async function getDriveToken(): Promise<string> {
  const client = await googleAuth.getClient();
  const token = await client.getAccessToken();
  return token.token || "";
}

// ─── Drive helpers ───
async function listDriveFiles(folderId: string, token: string): Promise<any[]> {
  const q = encodeURIComponent(`'${folderId}' in parents`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType)&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true&orderBy=name`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return (data as any).files || [];
}

async function downloadDriveFile(fileId: string, outputPath: string, token: string): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
}

// ─── Date helpers ───
interface WeekDay {
  dateStr: string;
  dayOfWeek: string;
  day: number;
  month: number;
  year: number;
}

function getNextWeekDates(): WeekDay[] {
  const now = new Date();
  // Target next Monday from Sunday
  const target = new Date(now);
  const dayOfWeek = now.getDay();
  if (dayOfWeek === 0) {
    target.setDate(now.getDate() + 1);
  } else {
    target.setDate(now.getDate() + (8 - dayOfWeek));
  }

  const dates: WeekDay[] = [];
  for (let i = 0; i < 5; i++) {
    const dd = new Date(target);
    dd.setDate(target.getDate() + i);
    dates.push({
      dateStr: `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, "0")}-${String(dd.getDate()).padStart(2, "0")}`,
      dayOfWeek: dd.toLocaleDateString("en-US", { weekday: "long" }),
      day: dd.getDate(),
      month: dd.getMonth() + 1,
      year: dd.getFullYear(),
    });
  }
  return dates;
}

function parseFileDate(fileName: string, year: number, month: number): string | null {
  const base = fileName.replace(/\.(jpg|jpeg|png|gif)$/i, "").replace(/-\d+$/, "");
  const monthDigits = String(month);
  if (base.startsWith(monthDigits)) {
    const dayStr = base.substring(monthDigits.length);
    const day = parseInt(dayStr);
    if (day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  const match = base.match(/(\d{3,4})$/);
  if (match) {
    const num = match[1];
    const m = parseInt(num.substring(0, num.length - 2));
    const d = parseInt(num.substring(num.length - 2));
    if (m === month && d >= 1 && d <= 31) {
      return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}

// ─── Gemini Vision with retry ───
async function extractMenuFromImage(imagePath: string): Promise<any> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await callGemini(imagePath);
    } catch (e) {
      if (attempt < MAX_RETRIES) {
        console.log(`  ⚠️ Attempt ${attempt}/${MAX_RETRIES} failed, retrying...`);
        await new Promise((r) => setTimeout(r, 3000));
      } else {
        throw e;
      }
    }
  }
}

async function callGemini(imagePath: string): Promise<any> {
  const imageData = fs.readFileSync(imagePath);
  const base64 = imageData.toString("base64");
  const mimeType = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";

  const prompt = `Analyze this school cafeteria lunch menu image from Chadwick International School in Songdo, South Korea.

Extract ALL menu items organized by category. The menu may have some or all of these sections:
- MS/US (Middle School / Upper School) with categories: Korean, International, Pasta & Noodle, Vegetarian & Salad, Protein & In the Box
- VS (Village School / Elementary) with categories: Korean, International, In the Box
- PK/K (Pre-K / Kindergarten) with a single lunch category

IMPORTANT: If a section is NOT present in the image, set its value to null.

Return ONLY valid JSON (no markdown, no code fences):
{
  "msus": { "korean": { "items": [...], "itemsKo": [...] }, "international": {...}, "pasta": {...}, "vegetarian": {...}, "protein": {...} },
  "vs": { "korean": {...}, "international": {...}, "inTheBox": {...} },
  "pkk": { "lunch": { "items": [...], "itemsKo": [...] } }
}

Rules:
- "items": English translations, "itemsKo": Korean names
- Both arrays same length, 1:1 correspondence
- Section not in image → null
- Return ONLY valid JSON`;

  const body = {
    contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
  };

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Gemini error ${res.status}`);

  const json: any = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  return JSON.parse(cleaned);
}

// ─── Core sync logic ───
async function syncMenus(): Promise<string> {
  const db = admin.firestore();
  const token = await getDriveToken();
  const weekDates = getNextWeekDates();

  console.log(`📅 Week: ${weekDates[0].dateStr} → ${weekDates[4].dateStr}`);

  // Find month folders
  const rootFolders = await listDriveFiles(DRIVE_ROOT_FOLDER_ID, token);
  const allImages: Record<string, any> = {};
  const months = [...new Set(weekDates.map((d) => `${d.year}_${d.month}`))];

  for (const mk of months) {
    const folder = rootFolders.find((f: any) => f.name === mk && f.mimeType === "application/vnd.google-apps.folder");
    if (!folder) continue;
    const images = await listDriveFiles(folder.id, token);
    for (const img of images.filter((f: any) => f.mimeType.startsWith("image/"))) {
      const [y, m] = mk.split("_").map(Number);
      const dateStr = parseFileDate(img.name, y, m);
      if (dateStr) allImages[dateStr] = img;
    }
  }

  // Process each weekday
  interface Result {
    dateStr: string;
    dayOfWeek: string;
    data: any;
    status: string;
  }
  const results: Result[] = [];

  for (const wd of weekDates) {
    const img = allImages[wd.dateStr];

    if (!img) {
      // A day can be filled in by hand when catering is published outside the
      // Drive-photo pipeline (e.g. orientation fortnight). No photo must never
      // wipe a manual entry back to "holiday" — leave those days untouched.
      const existing = await db.collection("lunch_menus").doc(wd.dateStr).get();
      if (existing.exists && existing.get("manual") === true) {
        console.log(`✋ ${wd.dateStr}: manual entry kept`);
        continue;
      }
      console.log(`📅 ${wd.dateStr}: Holiday`);
      results.push({ dateStr: wd.dateStr, dayOfWeek: wd.dayOfWeek, data: { holiday: true, msus: null, vs: null, pkk: null }, status: "holiday" });
      continue;
    }

    console.log(`🖼️ ${wd.dateStr}: ${img.name}`);
    const imgPath = path.join(os.tmpdir(), `menu_${wd.dateStr}.jpg`);

    try {
      await downloadDriveFile(img.id, imgPath, token);
      const menuData = await extractMenuFromImage(imgPath);
      results.push({ dateStr: wd.dateStr, dayOfWeek: wd.dayOfWeek, data: { holiday: false, ...menuData, driveFileId: img.id }, status: "ok" });
      console.log(`✅ ${wd.dateStr}: Success`);
    } catch (e: any) {
      console.error(`❌ ${wd.dateStr}: FAILED — ${e.message}`);
      return `FAILED: ${wd.dateStr} — ${e.message}. Nothing committed.`;
    } finally {
      try { fs.unlinkSync(imgPath); } catch {}
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  // All-or-nothing commit
  const batch = db.batch();
  for (const r of results) {
    batch.set(db.collection("lunch_menus").doc(r.dateStr), {
      date: r.dateStr, dayOfWeek: r.dayOfWeek, ...r.data,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  batch.set(db.doc("app_config/menu_sync"), {
    lastSync: admin.firestore.FieldValue.serverTimestamp(),
    weekStart: weekDates[0].dateStr,
    weekEnd: weekDates[4].dateStr,
    count: results.length,
    holidays: results.filter((r) => r.status === "holiday").map((r) => r.dateStr),
  }, { merge: true });

  await batch.commit();
  const msg = `✅ ${results.length} days committed (${results.filter((r) => r.status === "ok").length} menus, ${results.filter((r) => r.status === "holiday").length} holidays)`;
  console.log(msg);
  return msg;
}

// ─── Scheduled Function: Every Sunday 11 PM KST (14:00 UTC) ───
export const scheduledMenuSync = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .pubsub.schedule("0 14 * * 0")  // Sunday 2 PM UTC = Sunday 11 PM KST
  .timeZone("Asia/Seoul")
  .onRun(async () => {
    console.log("🔄 Starting scheduled weekly menu sync...");
    const result = await syncMenus();
    console.log(result);
    return null;
  });

// ─── HTTP Trigger for manual sync ───
export const syncMenuHttp = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    console.log("🔄 Manual menu sync triggered...");
    try {
      const result = await syncMenus();
      res.status(200).json({ success: true, message: result });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
