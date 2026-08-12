// Backfill Google placeId on existing local_recommendations.
// Matches each rec's title via Places API (New) text search and accepts the
// top result only when it is within MAX_DIST_M of the rec's stored coordinates.
// Run from the functions/ dir (it has firebase-admin):
//   cd functions && node ../scripts/backfill_place_ids.mjs

import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const SERVICE_ACCOUNT = '/Users/junyoung/OPENCLAW/dolphin/lost-and-found-20c10-firebase-adminsdk-fbsvc-b6a22c25ca.json';
const GOOGLE_MAPS_KEY = 'AIzaSyAZ_rgZ36eUlfppXajOITzxLAmLmfllkMQ';
const MAX_DIST_M = 200;

const sa = JSON.parse(readFileSync(SERVICE_ACCOUNT, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

function distMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

async function searchPlace(title, lat, lng) {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_MAPS_KEY,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.location',
        },
        body: JSON.stringify({
            textQuery: title,
            languageCode: 'en',
            pageSize: 3,
            locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 1000 } },
        }),
    });
    const data = await res.json();
    return data.places || [];
}

const snap = await db.collection('local_recommendations').get();
console.log(`Total recommendations: ${snap.size}`);
let updated = 0, skipped = 0;

for (const d of snap.docs) {
    const rec = d.data();
    if (rec.placeId) { console.log(`  [keep]    "${rec.title}" already has placeId`); continue; }
    if (!rec.latitude || !rec.longitude) { console.log(`  [skip]    "${rec.title}" — no coordinates`); skipped++; continue; }

    try {
        const places = await searchPlace(rec.title, rec.latitude, rec.longitude);
        const best = places.find(p => p.location &&
            distMeters(rec.latitude, rec.longitude, p.location.latitude, p.location.longitude) <= MAX_DIST_M);
        if (best) {
            const d2 = Math.round(distMeters(rec.latitude, rec.longitude, best.location.latitude, best.location.longitude));
            await d.ref.update({ placeId: best.id });
            console.log(`  [matched] "${rec.title}" → "${best.displayName?.text}" (${d2}m) ${best.id}`);
            updated++;
        } else {
            console.log(`  [no-match] "${rec.title}" — nothing within ${MAX_DIST_M}m`);
            skipped++;
        }
    } catch (e) {
        console.log(`  [error]   "${rec.title}" — ${e.message}`);
        skipped++;
    }
    await new Promise(r => setTimeout(r, 150));
}

console.log(`\nDone. matched=${updated}, skipped=${skipped}`);
