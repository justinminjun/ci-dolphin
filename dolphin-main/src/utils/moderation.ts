import { db, auth } from '../config/firebase';
import { doc, setDoc, deleteDoc, getDoc, updateDoc, addDoc, collection, serverTimestamp, arrayUnion, arrayRemove } from 'firebase/firestore';
import { Alert } from 'react-native';

export type ReportReason = 'Spam' | 'Inappropriate Content' | 'Harassment' | 'Scam / Fraud' | 'Other';

export const REPORT_REASONS: ReportReason[] = [
    'Spam',
    'Inappropriate Content',
    'Harassment',
    'Scam / Fraud',
    'Other',
];

/**
 * Report a piece of content (post, listing, comment, chat message).
 */
export async function reportContent(opts: {
    contentType: 'post' | 'listing' | 'comment' | 'chat_message';
    contentId: string;
    contentOwnerId: string;
    contentOwnerName?: string;
    reason: ReportReason;
    additionalInfo?: string;
}): Promise<boolean> {
    const uid = auth.currentUser?.uid;
    if (!uid) return false;

    try {
        await addDoc(collection(db, 'reports'), {
            reporterId: uid,
            reporterName: auth.currentUser?.displayName || 'Unknown',
            contentType: opts.contentType,
            contentId: opts.contentId,
            contentOwnerId: opts.contentOwnerId,
            contentOwnerName: opts.contentOwnerName || 'Unknown',
            reason: opts.reason,
            additionalInfo: opts.additionalInfo || '',
            status: 'pending', // pending | reviewed | dismissed
            createdAt: serverTimestamp(),
        });
        return true;
    } catch (e) {
        console.error('Report failed:', e);
        return false;
    }
}

/**
 * Block a user. Saves to the current user's Firestore document.
 */
export async function blockUser(targetUserId: string): Promise<boolean> {
    const uid = auth.currentUser?.uid;
    if (!uid || uid === targetUserId) return false;

    try {
        await updateDoc(doc(db, 'users', uid), {
            blockedUsers: arrayUnion(targetUserId),
        });
        return true;
    } catch (e) {
        console.error('Block failed:', e);
        return false;
    }
}

/**
 * Unblock a user.
 */
export async function unblockUser(targetUserId: string): Promise<boolean> {
    const uid = auth.currentUser?.uid;
    if (!uid) return false;

    try {
        await updateDoc(doc(db, 'users', uid), {
            blockedUsers: arrayRemove(targetUserId),
        });
        return true;
    } catch (e) {
        console.error('Unblock failed:', e);
        return false;
    }
}

/**
 * Get the current user's blocked user IDs list.
 */
export async function getBlockedUsers(): Promise<string[]> {
    const uid = auth.currentUser?.uid;
    if (!uid) return [];

    try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (snap.exists()) {
            return snap.data()?.blockedUsers || [];
        }
        return [];
    } catch {
        return [];
    }
}

/**
 * Show a report/block action sheet (Alert-based, works on both platforms).
 */
export function showReportBlockMenu(opts: {
    targetUserId: string;
    targetUserName: string;
    contentType: 'post' | 'listing' | 'comment' | 'chat_message';
    contentId: string;
    onBlocked?: () => void;
}) {
    const uid = auth.currentUser?.uid;
    if (!uid || uid === opts.targetUserId) return;

    Alert.alert(
        'Report or Block',
        `What would you like to do with content by ${opts.targetUserName}?`,
        [
            { text: 'Cancel', style: 'cancel' },
            {
                text: '🚩 Report Content',
                onPress: () => showReportReasonPicker(opts),
            },
            {
                text: '🚫 Block User',
                style: 'destructive',
                onPress: () => {
                    Alert.alert(
                        'Block User',
                        `Block ${opts.targetUserName}? You won't see their content anymore.`,
                        [
                            { text: 'Cancel', style: 'cancel' },
                            {
                                text: 'Block',
                                style: 'destructive',
                                onPress: async () => {
                                    const success = await blockUser(opts.targetUserId);
                                    if (success) {
                                        // Also report the content automatically when blocking
                                        await reportContent({
                                            contentType: opts.contentType,
                                            contentId: opts.contentId,
                                            contentOwnerId: opts.targetUserId,
                                            contentOwnerName: opts.targetUserName,
                                            reason: 'Other',
                                            additionalInfo: 'User was blocked',
                                        });
                                        Alert.alert('Blocked', `${opts.targetUserName} has been blocked. Their content will be removed from your feed.`);
                                        opts.onBlocked?.();
                                    } else {
                                        Alert.alert('Error', 'Failed to block user. Please try again.');
                                    }
                                },
                            },
                        ]
                    );
                },
            },
        ]
    );
}

function showReportReasonPicker(opts: {
    targetUserId: string;
    targetUserName: string;
    contentType: 'post' | 'listing' | 'comment' | 'chat_message';
    contentId: string;
}) {
    Alert.alert(
        'Report Reason',
        'Why are you reporting this content?',
        [
            ...REPORT_REASONS.map(reason => ({
                text: reason,
                onPress: async () => {
                    const success = await reportContent({
                        contentType: opts.contentType,
                        contentId: opts.contentId,
                        contentOwnerId: opts.targetUserId,
                        contentOwnerName: opts.targetUserName,
                        reason,
                    });
                    if (success) {
                        Alert.alert('Reported', 'Thank you for your report. We will review this content within 24 hours.');
                    } else {
                        Alert.alert('Error', 'Failed to submit report. Please try again.');
                    }
                },
            })),
            { text: 'Cancel', style: 'cancel' },
        ]
    );
}
