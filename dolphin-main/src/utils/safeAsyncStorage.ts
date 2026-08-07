/**
 * Safe AsyncStorage wrapper that doesn't crash when the native module is unavailable.
 * Falls back to an in-memory store so the app continues to work.
 */

let _asyncStorage: any = null;
let _initialized = false;

// In-memory fallback
const memoryStore = new Map<string, string>();

const fallback = {
  getItem: async (key: string): Promise<string | null> => memoryStore.get(key) ?? null,
  setItem: async (key: string, value: string): Promise<void> => { memoryStore.set(key, value); },
  removeItem: async (key: string): Promise<void> => { memoryStore.delete(key); },
  multiGet: async (keys: string[]): Promise<[string, string | null][]> =>
    keys.map(k => [k, memoryStore.get(k) ?? null] as [string, string | null]),
  multiSet: async (pairs: [string, string][]): Promise<void> => {
    pairs.forEach(([k, v]) => memoryStore.set(k, v));
  },
  multiRemove: async (keys: string[]): Promise<void> => {
    keys.forEach(k => memoryStore.delete(k));
  },
  clear: async (): Promise<void> => { memoryStore.clear(); },
  getAllKeys: async (): Promise<string[]> => Array.from(memoryStore.keys()),
};

function getStorage() {
  if (_initialized) return _asyncStorage || fallback;
  _initialized = true;
  try {
    const mod = require('@react-native-async-storage/async-storage');
    _asyncStorage = mod.default || mod;
    // Test if native module works by accessing a property
    if (!_asyncStorage || typeof _asyncStorage.getItem !== 'function') {
      _asyncStorage = null;
    }
  } catch {
    _asyncStorage = null;
  }
  return _asyncStorage || fallback;
}

const SafeAsyncStorage = {
  getItem: (key: string) => getStorage().getItem(key),
  setItem: (key: string, value: string) => getStorage().setItem(key, value),
  removeItem: (key: string) => getStorage().removeItem(key),
  multiGet: (keys: string[]) => getStorage().multiGet(keys),
  multiSet: (pairs: [string, string][]) => getStorage().multiSet(pairs),
  multiRemove: (keys: string[]) => getStorage().multiRemove(keys),
  clear: () => getStorage().clear(),
  getAllKeys: () => getStorage().getAllKeys(),
};

export default SafeAsyncStorage;
