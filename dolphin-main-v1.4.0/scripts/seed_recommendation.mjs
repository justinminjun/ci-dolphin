// Script to seed a sample restaurant recommendation into Firestore
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { readFileSync } from 'fs';

// Init Firebase Admin
const serviceAccount = JSON.parse(
    readFileSync('/Users/junyoung/OPENCLAW/dolphin/functions/service-account-key.json', 'utf8')
);

const app = initializeApp({
    credential: cert(serviceAccount),
    storageBucket: 'lost-and-found-20c10.firebasestorage.app',
});

const db = getFirestore(app);
const bucket = getStorage(app).bucket();

async function seedRecommendation() {
    console.log('📸 Uploading photo...');
    
    // Upload the food photo
    const photoPath = '/Users/junyoung/.gemini/antigravity/brain/c550c133-aae8-4954-8645-d851cae4e4ac/sinbokgwan_food_1781093166546.png';
    const destination = 'local_guide/seed/sinbokgwan_hero.jpg';
    
    await bucket.upload(photoPath, {
        destination,
        metadata: { contentType: 'image/png' },
    });
    
    const file = bucket.file(destination);
    await file.makePublic();
    const photoUrl = `https://storage.googleapis.com/${bucket.name}/${destination}`;
    
    console.log('✅ Photo uploaded:', photoUrl);
    
    // 신복관 송도점 coordinates (Lotte Mall Songdo area)
    // Address: 인천광역시 연수구 인천타워대로132번길 9, 롯데몰 송도 캐슬파크 C동 2층
    const latitude = 37.3806;
    const longitude = 126.6614;
    
    console.log('📝 Creating recommendation...');
    
    const docRef = await db.collection('local_recommendations').add({
        title: 'Sinbokgwan (신복관) Songdo',
        description: `Hands down the best Korean-Chinese food near campus 🔥 Their jajangmyeon is next level — huge portions with perfectly chunky vegetables. Always get the tangsuyuk (sweet & sour pork) on the side, trust me it's crispy and not too sweet.\n\nLocated on the 2nd floor of Lotte Mall Castle Park C. Usually packed during lunch so try to go a bit early. Prices are super reasonable for the portion size. Great for a group dinner too!\n\nPro tip: Order the 간짜장 if you like it thicker and less saucy. You won't regret it.`,
        category: 'restaurant',
        photo: photoUrl,
        latitude,
        longitude,
        address: '인천 연수구 인천타워대로132번길 9 롯데몰 캐슬파크 C동 2F',
        authorId: 'seed_user_001',
        authorName: 'Sarah K.',
        authorPhoto: null,
        likes: 7,
        createdAt: FieldValue.serverTimestamp(),
    });
    
    console.log('✅ Recommendation created:', docRef.id);
    
    // Add some fake likes for realism
    for (let i = 0; i < 7; i++) {
        await db.collection('local_recommendations').doc(docRef.id)
            .collection('likes').doc(`fake_user_${i}`).set({
                userId: `fake_user_${i}`,
                createdAt: new Date(),
            });
    }
    
    console.log('✅ Added 7 likes');
    console.log('🎉 Done! Check the app.');
}

seedRecommendation().catch(console.error);
