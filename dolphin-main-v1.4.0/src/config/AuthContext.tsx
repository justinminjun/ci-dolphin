import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db } from '../config/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { registerForPushNotifications } from '../utils/notifications';
import { startConfigListener, initializeConfigIfNeeded } from '../utils/admin';

// Helper: detect if email belongs to a student (graduation year suffix)
export function isStudentEmail(email: string | null | undefined): boolean {
    if (!email) return false;
    return /\d{4}@chadwickschool\.org$/i.test(email);
}

// Helper: extract graduation year from student email
export function getGraduationYear(email: string | null | undefined): number | null {
    if (!email) return null;
    const match = email.match(/(\d{4})@chadwickschool\.org$/i);
    return match ? parseInt(match[1], 10) : null;
}

interface UserData {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
    role: 'user' | 'admin' | 'student';
    isStudent: boolean;
    graduationYear: number | null;
    createdAt: any;
}

interface AuthContextType {
    user: User | null;
    userData: UserData | null;
    loading: boolean;
    isStudent: boolean;
    viewAsStudent: boolean;
    setViewAsStudent: (v: boolean) => void;
    // TEMP: client-side-only test bypass for the web deploy while Google
    // Sign-In's domain isn't authorized yet. No real Firebase Auth session is
    // created, so Firestore-backed reads/writes will not work — this only
    // unlocks the navigation shell/layout for visual testing. Remove
    // enterTestMode + all its wiring once Google Sign-In works on this host.
    enterTestMode: () => void;
}

const AuthContext = createContext<AuthContextType>({ user: null, userData: null, loading: true, isStudent: false, viewAsStudent: false, setViewAsStudent: () => {}, enterTestMode: () => {} });

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [userData, setUserData] = useState<UserData | null>(null);
    const [loading, setLoading] = useState(true);
    const [viewAsStudent, setViewAsStudent] = useState(false);
    const testModeRef = useRef(false);

    const enterTestMode = () => {
        testModeRef.current = true;
        setUser({ uid: 'test-mode-user', email: null, displayName: 'Test User', photoURL: null } as User);
        setUserData({
            uid: 'test-mode-user', email: null, displayName: 'Test User', photoURL: null,
            role: 'user', isStudent: false, graduationYear: null, createdAt: null,
        });
        setLoading(false);
    };

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (testModeRef.current) return;
            setUser(currentUser);
            if (currentUser) {
                // Check if user exists in Firestore
                const userRef = doc(db, 'users', currentUser.uid);
                const userSnap = await getDoc(userRef);

                const studentFlag = isStudentEmail(currentUser.email);
                const gradYear = getGraduationYear(currentUser.email);

                if (userSnap.exists()) {
                    const existing = userSnap.data() as UserData;
                    const updates: any = {};
                    // Always sync latest photoURL from Google
                    if (currentUser.photoURL && existing.photoURL !== currentUser.photoURL) {
                        updates.photoURL = currentUser.photoURL;
                    }
                    // Always sync student status
                    if (existing.isStudent !== studentFlag) updates.isStudent = studentFlag;
                    if (existing.graduationYear !== gradYear) updates.graduationYear = gradYear;
                    if (studentFlag && existing.role !== 'student') updates.role = 'student';

                    if (Object.keys(updates).length > 0) {
                        await setDoc(userRef, updates, { merge: true });
                        setUserData({ ...existing, ...updates });
                    } else {
                        setUserData(existing);
                    }
                } else {
                    // Create new user profile
                    const newUserData: UserData = {
                        uid: currentUser.uid,
                        email: currentUser.email,
                        displayName: currentUser.displayName,
                        photoURL: currentUser.photoURL,
                        role: studentFlag ? 'student' : 'user',
                        isStudent: studentFlag,
                        graduationYear: gradYear,
                        createdAt: serverTimestamp(),
                    };
                    await setDoc(userRef, newUserData);
                    setUserData(newUserData);
                }

                // Register for push notifications
                registerForPushNotifications(currentUser.uid);

                // Start listening to access config (admin list, allowed domains)
                startConfigListener();
                initializeConfigIfNeeded();
            } else {
                setUserData(null);
            }
            setLoading(false);
        });

        return unsubscribe;
    }, []);

    const realIsStudent = userData?.isStudent ?? isStudentEmail(user?.email);
    const isStudent = viewAsStudent || realIsStudent;

    return (
        <AuthContext.Provider value={{ user, userData, loading, isStudent, viewAsStudent, setViewAsStudent, enterTestMode }}>
            {children}
        </AuthContext.Provider>
    );
};
