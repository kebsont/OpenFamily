import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fetchLinkedAccounts, LINKED_ACCOUNTS_CHANGED, type LinkedAccount } from '../lib/households';

// One shared copy for the whole app: the header, the switcher and Settings all
// read it, and only one request goes out however many of them are on screen.
let state: LinkedAccount[] = [];
let loadedFor: string | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

const set = (next: LinkedAccount[]) => {
    state = next.length > 1 ? next : [];
    listeners.forEach((l) => l());
};

const load = (userId: string): Promise<void> => {
    if (inFlight) return inFlight;
    inFlight = fetchLinkedAccounts()
        .then((accounts) => {
            loadedFor = userId;
            set(accounts);
        })
        .catch(() => {
            // Non-blocking: the app works the same without the switcher.
        })
        .finally(() => {
            inFlight = null;
        });
    return inFlight;
};

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

if (typeof window !== 'undefined') {
    // Changes made from Settings carry the new list.
    window.addEventListener(LINKED_ACCOUNTS_CHANGED, (event) => {
        const detail = (event as CustomEvent<LinkedAccount[]>).detail;
        if (Array.isArray(detail)) set(detail);
    });
}

/**
 * The accounts the signed-in person can switch to, including the current one
 * (flagged is_current). Empty when nothing is linked.
 */
export function useLinkedAccounts() {
    const { user } = useAuth();
    const accounts = useSyncExternalStore(subscribe, () => state);
    const userId = user?.id ?? null;

    useEffect(() => {
        if (!userId) {
            loadedFor = null;
            set([]);
            return;
        }
        if (loadedFor !== userId) void load(userId);

        // Unread counts of the other households change while the app is open.
        const onVisible = () => {
            if (document.visibilityState === 'visible') void load(userId);
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [userId]);

    const current = accounts.find((a) => a.is_current) ?? null;
    const others = accounts.filter((a) => !a.is_current);

    return { accounts, current, others };
}
