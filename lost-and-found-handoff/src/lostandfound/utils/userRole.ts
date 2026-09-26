/**
 * Determine user role based on Chadwick email pattern.
 * - Emails like jyang2025@chadwickschool.org → Student (has graduation year digits before @)
 * - Emails like bchae@chadwickschool.org → Faculty/Staff (no year digits)
 */
export function getUserRole(email: string): 'student' | 'faculty' {
    const localPart = email.split('@')[0] || '';
    // Check if the local part ends with 4 digits (graduation year)
    return /\d{4}$/.test(localPart) ? 'student' : 'faculty';
}

export function getRoleLabel(email: string): string {
    return getUserRole(email) === 'student' ? 'Student' : 'Faculty / Staff';
}
