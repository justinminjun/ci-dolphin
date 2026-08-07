// Format a Firestore timestamp or Date into a relative time string
export function timeAgo(timestamp: any): string {
    if (!timestamp) return 'Just now';

    let date: Date;
    if (timestamp.toDate) {
        date = timestamp.toDate();
    } else if (timestamp instanceof Date) {
        date = timestamp;
    } else {
        return 'Just now';
    }

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}
