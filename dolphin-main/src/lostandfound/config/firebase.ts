// Re-export from the main Dolphin firebase config
// This ensures both Dolphin and Lost & Found share the same Firebase instances
export { auth, db, storage } from '../../config/firebase';
