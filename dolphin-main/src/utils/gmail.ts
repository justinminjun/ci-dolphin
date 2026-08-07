import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth } from '../config/firebase';

const GMAIL_TOKEN_KEY = '@gmail_access_token';

/**
 * Save the Google OAuth access token for Gmail API usage.
 */
export async function saveGmailToken(accessToken: string): Promise<void> {
    await AsyncStorage.setItem(GMAIL_TOKEN_KEY, accessToken);
}

/**
 * Get the stored Gmail access token.
 */
export async function getGmailToken(): Promise<string | null> {
    return AsyncStorage.getItem(GMAIL_TOKEN_KEY);
}

/**
 * Build a MIME email message encoded in base64url format.
 */
function buildMimeMessage(
    from: string,
    to: string[],
    subject: string,
    htmlBody: string,
): string {
    const boundary = `boundary_${Date.now()}`;
    const toHeader = to.join(', ');

    const mime = [
        `From: ${from}`,
        `To: ${toHeader}`,
        `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        subject,  // plain-text fallback
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        htmlBody,
        '',
        `--${boundary}--`,
    ].join('\r\n');

    // base64url encode
    const encoded = btoa(unescape(encodeURIComponent(mime)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    return encoded;
}

/**
 * Send an email via Gmail API using the stored access token.
 * Returns true if sent successfully, false otherwise.
 */
export async function sendGmailDirect(
    to: string[],
    subject: string,
    htmlBody: string,
): Promise<boolean> {
    try {
        const accessToken = await getGmailToken();
        if (!accessToken) {
            console.warn('No Gmail access token found');
            return false;
        }

        const user = auth.currentUser;
        const from = user?.email || '';
        if (!from) return false;

        const raw = buildMimeMessage(from, to, subject, htmlBody);

        const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ raw }),
        });

        if (response.ok) {
            return true;
        } else {
            const err = await response.json().catch(() => ({}));
            console.error('Gmail API error:', response.status, err);
            return false;
        }
    } catch (error) {
        console.error('sendGmailDirect error:', error);
        return false;
    }
}
