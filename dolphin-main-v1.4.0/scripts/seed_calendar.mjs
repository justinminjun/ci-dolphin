import admin from 'firebase-admin';
import { readFileSync } from 'fs';

// Initialize Firebase Admin
const serviceAccount = JSON.parse(
  readFileSync('./lost-and-found-20c10-firebase-adminsdk-fbsvc-b6a22c25ca.json', 'utf-8')
);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();
console.log('🔧 Firebase Admin initialized');

// Step 1: Get Veracross token
// Credentials come from the environment — never hardcode them. Run with:
//   VERACROSS_CLIENT_ID=... VERACROSS_CLIENT_SECRET=... node scripts/seed_calendar.mjs
const VERACROSS_CLIENT_ID = process.env.VERACROSS_CLIENT_ID;
const VERACROSS_CLIENT_SECRET = process.env.VERACROSS_CLIENT_SECRET;
if (!VERACROSS_CLIENT_ID || !VERACROSS_CLIENT_SECRET) {
  console.error('❌ Missing VERACROSS_CLIENT_ID / VERACROSS_CLIENT_SECRET environment variables.');
  process.exit(1);
}

const tokenRes = await fetch('https://accounts.veracross.com/chadwickinternational/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: VERACROSS_CLIENT_ID,
    client_secret: VERACROSS_CLIENT_SECRET,
    scope: 'events.group_events:list events.group_events:read',
  }).toString(),
});
const tokenData = await tokenRes.json();
const token = tokenData.access_token;
console.log('✅ Got Veracross token');

// Step 2: Fetch events for this month and next month
const now = new Date();
const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
const endMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);
const endDate = `${endMonth.getFullYear()}-${String(endMonth.getMonth() + 1).padStart(2, '0')}-${String(endMonth.getDate()).padStart(2, '0')}`;

console.log(`📅 Fetching events from ${startDate} to ${endDate}`);

const eventsRes = await fetch(
  `https://api.veracross.com/chadwickinternational/v3/events/group_events?on_or_after_start_date=${startDate}&on_or_before_end_date=${endDate}`,
  {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'X-Page-Size': '200',
    },
  }
);
const eventsData = await eventsRes.json();
const events = (eventsData.data || []).filter(e => e.description && e.description !== 'None');

console.log(`📝 Found ${events.length} events`);

// Step 3: Write to Firestore using Admin SDK (no auth rules apply)
const batch = db.batch();
for (const e of events) {
  const docRef = db.collection('school_calendar').doc(String(e.id));
  batch.set(docRef, {
    title: e.description,
    location: e.location || null,
    startDate: e.start_date,
    endDate: e.end_date,
    startTime: e.start_time ? e.start_time.substring(0, 5) : null,
    endTime: e.end_time ? e.end_time.substring(0, 5) : null,
    allDay: !e.start_time,
    schoolLevel: e.school_level_description || '',
    eventType: e.event_type_description || '',
    isPublic: e.public || false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

// Metadata
batch.set(db.doc('app_config/calendar_sync'), {
  lastSync: admin.firestore.FieldValue.serverTimestamp(),
  eventCount: events.length,
});

await batch.commit();
console.log(`✅ Seeded ${events.length} events to Firestore!`);
process.exit(0);
