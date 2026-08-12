/**
 * sync_lunch_menu.mjs
 * 
 * All-or-nothing weekly lunch menu sync:
 * 1. Lists images in current month's Google Drive folder
 * 2. Determines current week's weekdays (Mon-Fri)
 * 3. For days with no image → marks as holiday/closed
 * 4. For days with image → extracts menu via Gemini Vision (with auto-retry)
 * 5. ALL extractions must succeed → then commits everything to Firestore
 * 6. If any fails → nothing is committed
 * 
 * Usage: NODE_PATH=./functions/node_modules node scripts/sync_lunch_menu.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const admin = require('firebase-admin');
const { GoogleAuth } = require('google-auth-library');
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ─── Config ───
const DRIVE_ROOT_FOLDER_ID = '1nnUGhdiZsuohW6a9KVcvYz7gGAMpC1Dj';
const GEMINI_API_KEY = 'AIzaSyAtsNj37PJ2Z6Nec7rFPczRDXIQHkF3VwQ';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
const MAX_RETRIES = 3;

// ─── Initialize Firebase Admin ───
const serviceAccountPath = path.join(PROJECT_ROOT, 'lost-and-found-20c10-firebase-adminsdk-fbsvc-b6a22c25ca.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf-8'));
if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

// ─── Google Auth for Drive API ───
const googleAuth = new GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});

async function getDriveToken() {
    const client = await googleAuth.getClient();
    const token = await client.getAccessToken();
    return token.token;
}

// ─── Drive API helpers ───
async function listDriveFiles(folderId, token) {
    const q = encodeURIComponent(`'${folderId}' in parents`);
    const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,createdTime,modifiedTime)&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true&orderBy=name`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    return data.files || [];
}

async function downloadDriveFile(fileId, outputPath, token) {
    const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(outputPath, buffer);
    return true;
}

// ─── Date helpers ───
function getWeekDates(referenceDate) {
    const d = referenceDate || new Date();
    const day = d.getDay(); // 0=Sun
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    
    const dates = [];
    for (let i = 0; i < 5; i++) {
        const dd = new Date(monday);
        dd.setDate(monday.getDate() + i);
        const dateStr = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;
        const dayOfWeek = dd.toLocaleDateString('en-US', { weekday: 'long' });
        dates.push({ dateStr, dayOfWeek, day: dd.getDate(), month: dd.getMonth() + 1, year: dd.getFullYear() });
    }
    return dates;
}

function parseFileDate(fileName, year, month) {
    const base = fileName.replace(/\.(jpg|jpeg|png|gif)$/i, '').replace(/-\d+$/, '');
    const monthDigits = String(month);
    if (base.startsWith(monthDigits)) {
        const dayStr = base.substring(monthDigits.length);
        const day = parseInt(dayStr);
        if (day >= 1 && day <= 31) {
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
    }
    // combined_image pattern
    const match = base.match(/(\d{3,4})$/);
    if (match) {
        const num = match[1];
        const m = parseInt(num.substring(0, num.length - 2));
        const d = parseInt(num.substring(num.length - 2));
        if (m === month && d >= 1 && d <= 31) {
            return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
    }
    return null;
}

// ─── Gemini Vision API (with auto-retry) ───
async function extractMenuFromImage(imagePath) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await _callGemini(imagePath);
        } catch (e) {
            if (attempt < MAX_RETRIES) {
                console.log(`  ⚠️ Attempt ${attempt}/${MAX_RETRIES} failed, retrying in 3s...`);
                await new Promise(r => setTimeout(r, 3000));
            } else {
                throw e;
            }
        }
    }
}

async function _callGemini(imagePath) {
    const imageData = readFileSync(imagePath);
    const base64 = imageData.toString('base64');
    const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    
    const prompt = `Analyze this school cafeteria lunch menu image from Chadwick International School in Songdo, South Korea.

Extract ALL menu items organized by category. The menu may have some or all of these sections:
- MS/US (Middle School / Upper School) with categories: Korean, International, Pasta & Noodle, Vegetarian & Salad, Protein & In the Box
- VS (Village School / Elementary) with categories: Korean, International, In the Box
- PK/K (Pre-K / Kindergarten) with a single lunch category

IMPORTANT: Some days only certain sections operate. If a section (MS/US, VS, or PK/K) is NOT present in the image at all, set its value to null instead of an empty object.

Return ONLY a valid JSON object (no markdown, no code fences).
Each category has "items" (English) and "itemsKo" (Korean) arrays that must be the same length:
{
  "msus": {
    "korean": { "items": ["English name"], "itemsKo": ["한국어"] },
    "international": { "items": [...], "itemsKo": [...] },
    "pasta": { "items": [...], "itemsKo": [...] },
    "vegetarian": { "items": [...], "itemsKo": [...] },
    "protein": { "items": [...], "itemsKo": [...] }
  },
  "vs": {
    "korean": { "items": [...], "itemsKo": [...] },
    "international": { "items": [...], "itemsKo": [...] },
    "inTheBox": { "items": [...], "itemsKo": [...] }
  },
  "pkk": {
    "lunch": { "items": [...], "itemsKo": [...] }
  }
}

If MS/US section is not in the image: "msus": null
If VS section is not in the image: "vs": null
If PK/K section is not in the image: "pkk": null

Rules:
- "items": English translation of each menu item
- "itemsKo": Original Korean name
- Both arrays must be same length, 1:1 correspondence
- Keep names concise but descriptive
- Return ONLY valid JSON`;

    const body = {
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
    };

    const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API error ${res.status}: ${errText}`);
    }

    const json = await res.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        console.error('  ❌ Parse failed:', cleaned.substring(0, 300));
        throw new Error('Invalid JSON from Gemini');
    }
}

// ─── Main ───
async function main() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const monthKey = `${currentYear}_${currentMonth}`;
    
    // For Sunday night sync, get NEXT week's dates
    // For other days, get current week
    const isSunday = now.getDay() === 0;
    const targetDate = new Date(now);
    if (isSunday) {
        targetDate.setDate(now.getDate() + 1); // Monday of next week
    }
    const weekDates = getWeekDates(targetDate);
    
    console.log('🔧 Firebase Admin initialized');
    console.log(`📅 Target week: ${weekDates[0].dateStr} (Mon) → ${weekDates[4].dateStr} (Fri)`);
    
    // 1. Get Drive token
    const token = await getDriveToken();
    
    // 2. Find month folder(s) — week might span two months
    console.log('📂 Listing Drive folders...');
    const rootFolders = await listDriveFiles(DRIVE_ROOT_FOLDER_ID, token);
    
    // Collect all images from relevant month folders
    const allImages = {};
    const months = [...new Set(weekDates.map(d => `${d.year}_${d.month}`))];
    
    for (const mk of months) {
        const folder = rootFolders.find(f => f.name === mk && f.mimeType === 'application/vnd.google-apps.folder');
        if (!folder) {
            console.log(`  ⚠️ No folder for ${mk}`);
            continue;
        }
        console.log(`📁 Found folder: ${folder.name}`);
        const images = await listDriveFiles(folder.id, token);
        for (const img of images.filter(f => f.mimeType.startsWith('image/'))) {
            const [y, m] = mk.split('_').map(Number);
            const dateStr = parseFileDate(img.name, y, m);
            if (dateStr) allImages[dateStr] = img;
        }
    }
    
    console.log(`📋 Found images for dates: ${Object.keys(allImages).sort().join(', ') || 'none'}`);
    
    // 3. Process each weekday — all-or-nothing
    const results = []; // { dateStr, dayOfWeek, data, status }
    let allSuccess = true;
    
    for (const wd of weekDates) {
        const img = allImages[wd.dateStr];
        
        if (!img) {
            // No image → holiday / cafeteria closed
            console.log(`\n📅 ${wd.dateStr} (${wd.dayOfWeek}): No menu image → Holiday`);
            results.push({
                dateStr: wd.dateStr,
                dayOfWeek: wd.dayOfWeek,
                data: { holiday: true, msus: null, vs: null, pkk: null },
                status: 'holiday',
            });
            continue;
        }
        
        console.log(`\n🖼️  ${wd.dateStr} (${wd.dayOfWeek}): ${img.name}`);
        
        // Download
        const ext = img.mimeType.includes('png') ? 'png' : 'jpg';
        const imgPath = path.join(__dirname, `menu_temp_${wd.dateStr}.${ext}`);
        console.log('  📥 Downloading...');
        try {
            await downloadDriveFile(img.id, imgPath, token);
        } catch (e) {
            console.error(`  ❌ Download failed: ${e.message}`);
            allSuccess = false;
            break;
        }
        
        // Extract via Gemini (with retries)
        console.log('  🤖 Extracting with Gemini Vision...');
        try {
            const menuData = await extractMenuFromImage(imgPath);
            
            const msusCount = menuData.msus ? Object.values(menuData.msus).reduce((s, c) => s + (c?.items?.length || 0), 0) : 0;
            const vsCount = menuData.vs ? Object.values(menuData.vs).reduce((s, c) => s + (c?.items?.length || 0), 0) : 0;
            const pkkCount = menuData.pkk?.lunch?.items?.length || 0;
            
            console.log(`  ✅ Extracted — MS/US: ${msusCount} items, VS: ${vsCount} items, PK/K: ${pkkCount} items`);
            if (!menuData.msus) console.log('     ℹ️ MS/US section not available');
            if (!menuData.vs) console.log('     ℹ️ VS section not available');
            if (!menuData.pkk) console.log('     ℹ️ PK/K section not available');
            
            results.push({
                dateStr: wd.dateStr,
                dayOfWeek: wd.dayOfWeek,
                data: { holiday: false, ...menuData, driveFileId: img.id },
                status: 'ok',
            });
        } catch (e) {
            console.error(`  ❌ FAILED after ${MAX_RETRIES} attempts: ${e.message}`);
            allSuccess = false;
            break;
        }
        
        // Cleanup temp file
        try { unlinkSync(imgPath); } catch {}
        
        // Rate limit between Gemini calls
        await new Promise(r => setTimeout(r, 2000));
    }
    
    // 4. All-or-nothing commit
    if (!allSuccess) {
        console.log('\n🚫 Some menus failed to extract. NOTHING was committed.');
        console.log('   The entire week must succeed before updating.');
        process.exit(1);
    }
    
    console.log(`\n━━━ All ${results.length} days processed successfully ━━━`);
    
    const batch = db.batch();
    for (const r of results) {
        const docRef = db.collection('lunch_menus').doc(r.dateStr);
        batch.set(docRef, {
            date: r.dateStr,
            dayOfWeek: r.dayOfWeek,
            ...r.data,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        
        const icon = r.status === 'holiday' ? '🏖️' : '✅';
        console.log(`  ${icon} ${r.dateStr} (${r.dayOfWeek}): ${r.status === 'holiday' ? 'Holiday — Cafeteria Closed' : 'Menu updated'}`);
    }
    
    batch.set(db.doc('app_config/menu_sync'), {
        lastSync: admin.firestore.FieldValue.serverTimestamp(),
        weekStart: weekDates[0].dateStr,
        weekEnd: weekDates[4].dateStr,
        count: results.length,
        holidays: results.filter(r => r.status === 'holiday').map(r => r.dateStr),
    }, { merge: true });
    
    console.log('\n💾 Committing all menus to Firestore...');
    await batch.commit();
    console.log(`✅ Done! ${results.length} days committed (${results.filter(r => r.status === 'ok').length} menus, ${results.filter(r => r.status === 'holiday').length} holidays).`);
    
    process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
