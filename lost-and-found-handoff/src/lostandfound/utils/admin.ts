import { auth, db } from '../config/firebase';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';

// Fallback hardcoded admin (ensures you can never be locked out)
const FALLBACK_ADMIN_EMAILS = ['jyyang@chadwickschool.org'];

// Cached config from Firestore (updated in real-time)
let cachedConfig: {
    adminEmails: string[];
    allowedDomains: string[];
    allowedEmails: string[];
} = {
    adminEmails: [...FALLBACK_ADMIN_EMAILS],
    allowedDomains: ['chadwickschool.org'],
    allowedEmails: [],
};

let unsubscribe: (() => void) | null = null;

/**
 * Start listening to Firestore config/access document for real-time updates.
 * Call this once when the app starts.
 */
export function startConfigListener(): void {
    if (unsubscribe) return; // Already listening

    unsubscribe = onSnapshot(doc(db, 'config', 'access'), (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            cachedConfig = {
                adminEmails: data.adminEmails || [...FALLBACK_ADMIN_EMAILS],
                allowedDomains: data.allowedDomains || ['chadwickschool.org'],
                allowedEmails: data.allowedEmails || [],
            };
        }
    }, (error) => {
        console.warn('Config listener error:', error);
    });
}

/**
 * Stop listening to config changes.
 */
export function stopConfigListener(): void {
    if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
    }
}

/**
 * Check if current user is an admin.
 */
export function isAdmin(): boolean {
    const user = auth.currentUser;
    if (!user || !user.email) return false;
    const email = user.email.toLowerCase();
    // Always include fallback admin
    if (FALLBACK_ADMIN_EMAILS.includes(email)) return true;
    return cachedConfig.adminEmails.map(e => e.toLowerCase()).includes(email);
}

/**
 * Check if an email is allowed to log in.
 */
export function isEmailAllowed(email: string): boolean {
    const lower = email.toLowerCase();
    // Check allowed domains
    for (const domain of cachedConfig.allowedDomains) {
        if (lower.endsWith(`@${domain.toLowerCase()}`)) return true;
    }
    // Check individual allowed emails
    if (cachedConfig.allowedEmails.map(e => e.toLowerCase()).includes(lower)) return true;
    // Check admin emails (admins are always allowed)
    if (cachedConfig.adminEmails.map(e => e.toLowerCase()).includes(lower)) return true;
    if (FALLBACK_ADMIN_EMAILS.includes(lower)) return true;
    return false;
}

/**
 * Get current config (for Admin panel display).
 */
export function getAccessConfig() {
    return { ...cachedConfig };
}

/**
 * Save updated config to Firestore.
 */
export async function saveAccessConfig(config: {
    adminEmails: string[];
    allowedDomains: string[];
    allowedEmails: string[];
}): Promise<void> {
    // Always ensure fallback admin is included
    const emails = [...new Set([...FALLBACK_ADMIN_EMAILS, ...config.adminEmails])];
    await setDoc(doc(db, 'config', 'access'), {
        adminEmails: emails,
        allowedDomains: config.allowedDomains,
        allowedEmails: config.allowedEmails,
        updatedAt: new Date().toISOString(),
    });
}

/**
 * Initialize the config document in Firestore if it doesn't exist yet.
 */
export async function initializeConfigIfNeeded(): Promise<void> {
    const snap = await getDoc(doc(db, 'config', 'access'));
    if (!snap.exists()) {
        await setDoc(doc(db, 'config', 'access'), {
            adminEmails: [...FALLBACK_ADMIN_EMAILS],
            allowedDomains: ['chadwickschool.org'],
            allowedEmails: [],
            updatedAt: new Date().toISOString(),
        });
    }
}
