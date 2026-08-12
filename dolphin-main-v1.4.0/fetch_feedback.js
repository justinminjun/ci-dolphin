const admin = require('firebase-admin');

// Initialize with default credentials (uses gcloud auth)
admin.initializeApp({
    projectId: 'lost-and-found-20c10',
});

const db = admin.firestore();

async function fetchFeedback() {
    const snapshot = await db.collection('dolphin_feedback').orderBy('createdAt', 'desc').get();
    
    if (snapshot.empty) {
        console.log('No feedback found.');
        process.exit(0);
    }

    // CSV output
    console.log('No,Date,Time,User Name,Email,Category,Status,Feedback Text,Photo Count');
    
    let idx = 1;
    snapshot.forEach(doc => {
        const d = doc.data();
        const date = d.createdAt?.toDate ? d.createdAt.toDate() : new Date();
        const dateStr = date.toISOString().split('T')[0];
        const timeStr = date.toISOString().split('T')[1].substring(0, 8);
        const text = (d.text || '').replace(/"/g, '""').replace(/\n/g, ' ');
        const userName = (d.userName || 'Anonymous').replace(/,/g, ' ');
        const email = d.userEmail || '';
        const category = d.category || 'other';
        const status = d.status || 'new';
        const photoCount = d.photoCount || 0;
        
        console.log(`${idx},"${dateStr}","${timeStr}","${userName}","${email}","${category}","${status}","${text}",${photoCount}`);
        idx++;
    });
    
    process.exit(0);
}

fetchFeedback().catch(e => { console.error(e); process.exit(1); });
