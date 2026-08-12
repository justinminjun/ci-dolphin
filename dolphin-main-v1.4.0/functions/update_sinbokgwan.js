// Update Sinbokgwan restaurant entry: upload 2 new photos + update Firestore doc
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

const serviceAccount = require('../lost-and-found-20c10-firebase-adminsdk-fbsvc-b6a22c25ca.json');

const app = initializeApp({
    credential: cert(serviceAccount),
    storageBucket: 'lost-and-found-20c10.firebasestorage.app',
});

const db = getFirestore(app);
const bucket = getStorage(app).bucket();

const DOC_ID = 'lLR5mG4L4hVinVptyt3w';

const uploads = [
    {
        localPath: '/Users/junyoung/.gemini/antigravity/brain/c550c133-aae8-4954-8645-d851cae4e4ac/media__1781094414155.jpg',
        destination: 'local_guide/sinbokgwan/photo2.jpg',
        contentType: 'image/jpeg',
    },
    {
        localPath: '/Users/junyoung/.gemini/antigravity/brain/c550c133-aae8-4954-8645-d851cae4e4ac/media__1781094483824.jpg',
        destination: 'local_guide/sinbokgwan/photo3.jpg',
        contentType: 'image/jpeg',
    },
];

async function main() {
    // 1. Get existing document to retrieve current photo URL
    console.log('📖 Reading existing document...');
    const docSnap = await db.collection('local_recommendations').doc(DOC_ID).get();
    if (!docSnap.exists) {
        throw new Error(`Document ${DOC_ID} not found!`);
    }
    const existingData = docSnap.data();
    const existingPhotoUrl = existingData.photo;
    console.log('✅ Existing photo URL:', existingPhotoUrl);

    // 2. Upload new photos
    const newUrls = [];
    for (const u of uploads) {
        console.log(`📸 Uploading ${u.destination}...`);
        await bucket.upload(u.localPath, {
            destination: u.destination,
            metadata: { contentType: u.contentType },
        });
        const file = bucket.file(u.destination);
        await file.makePublic();
        const url = `https://storage.googleapis.com/${bucket.name}/${u.destination}`;
        newUrls.push(url);
        console.log('   ✅', url);
    }

    // 3. Update the Firestore document
    const photosArray = [existingPhotoUrl, newUrls[0], newUrls[1]];

    console.log('📝 Updating Firestore document...');
    await db.collection('local_recommendations').doc(DOC_ID).update({
        photos: photosArray,
        photo: existingPhotoUrl, // keep existing as thumbnail
        description: "Right near Central Park, so it's super close to school. It's a beef brisket & baby octopus (우삼겹 쭈꾸미) spot — the portions are huge and it's perfect for 2-4 people. The cheese fried rice at the end is the real kicker 🧀🔥",
        address: '9 Incheon Tower-daero 132beon-gil, Yeonsu-gu, Incheon (Lotte Mall Castle Park Bldg C, 2F)',
    });

    console.log('✅ Document updated successfully!');
    console.log('');
    console.log('=== RESULT ===');
    console.log('photos array:', JSON.stringify(photosArray, null, 2));
    console.log('photo (thumbnail):', existingPhotoUrl);
}

main().catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
});
