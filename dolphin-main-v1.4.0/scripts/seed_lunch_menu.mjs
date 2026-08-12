import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const admin = require('firebase-admin');
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ─── Initialize Firebase Admin ───
const serviceAccountPath = path.join(PROJECT_ROOT, 'lost-and-found-20c10-firebase-adminsdk-fbsvc-b6a22c25ca.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf-8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
console.log('🔧 Firebase Admin initialized');

// ─── Load menu data ───
const dataPath = path.join(__dirname, 'menu_data.json');
const menuData = JSON.parse(readFileSync(dataPath, 'utf-8'));
console.log(`📋 Loaded ${Object.keys(menuData).length} day(s) of menu data`);

// ─── Upload to Firestore ───
const batch = db.batch();
let count = 0;

for (const [dateStr, data] of Object.entries(menuData)) {
  const docRef = db.collection('lunch_menus').doc(dateStr);
  batch.set(docRef, {
    ...data,
    date: dateStr,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  count++;
  console.log(`  ✅ Queued: ${dateStr} (${data.dayOfWeek})`);
}

// Update sync metadata
batch.set(db.doc('app_config/menu_sync'), {
  lastSync: admin.firestore.FieldValue.serverTimestamp(),
  count,
}, { merge: true });

console.log(`\n💾 Committing ${count} menu(s) to Firestore...`);
await batch.commit();
console.log(`✅ Done! ${count} menus uploaded.`);
process.exit(0);
