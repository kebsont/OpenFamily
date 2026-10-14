// Linked accounts ("foyers"): one person, several households, one tap to switch.
// Server side: server/src/routes/linkedAccounts.ts.
import { api } from './api';
import { clearApiCache } from './pwa';

export interface LinkedAccount {
    id: string;
    name: string;
    email: string;
    /** Name this person gave the household in the switcher ("Second house"). */
    label: string | null;
    /** Created from the switcher: no login of its own, reached only by switching. */
    managed: boolean;
    is_owner: boolean;
    family_owner_name: string | null;
    is_current: boolean;
    unread_count: number;
}

interface AccountsResponse {
    success: boolean;
    data: { accounts: LinkedAccount[] };
}

/** Fired after any change, so the header switcher and Settings stay in step. */
export const LINKED_ACCOUNTS_CHANGED = 'openfamily:linked-accounts-changed';

const IS_DEMO = Boolean(import.meta.env.VITE_DEMO);

const changed = (accounts: LinkedAccount[]) => {
    window.dispatchEvent(new CustomEvent(LINKED_ACCOUNTS_CHANGED, { detail: accounts }));
    return accounts;
};

export const fetchLinkedAccounts = async (): Promise<LinkedAccount[]> => {
    if (IS_DEMO) return [];
    const res = await api.get<AccountsResponse>('/api/linked-accounts');
    return res.success ? res.data.accounts : [];
};

export const linkAccount = async (input: {
    email: string;
    password: string;
    label?: string;
    currentLabel?: string;
}): Promise<LinkedAccount[]> => {
    const res = await api.post<AccountsResponse>('/api/linked-accounts', input);
    return changed(res.data.accounts);
};

/** Opens a new household run from this login. Returns the new account's id. */
export const createHousehold = async (input: { label: string; currentLabel?: string }): Promise<{ accounts: LinkedAccount[]; created: string }> => {
    const res = await api.post<{ success: boolean; data: { accounts: LinkedAccount[]; created: string } }>(
        '/api/linked-accounts/households',
        input
    );
    changed(res.data.accounts);
    return res.data;
};

export const renameHousehold = async (userId: string, label: string): Promise<LinkedAccount[]> => {
    const res = await api.put<AccountsResponse>(`/api/linked-accounts/${userId}/label`, { label });
    return changed(res.data.accounts);
};

export const unlinkAccount = async (userId: string): Promise<LinkedAccount[]> => {
    const res = await api.delete<AccountsResponse>(`/api/linked-accounts/${userId}`);
    return changed(res.data.accounts);
};

/**
 * The name shown for a household: its label, else familyOf(owner name), which
 * the caller translates ("Family of …").
 */
export const householdName = (
    account: Pick<LinkedAccount, 'label' | 'family_owner_name' | 'name'>,
    familyOf: (ownerName: string) => string
): string => account.label || familyOf(account.family_owner_name || account.name);

/**
 * Continue as a linked account, then reload the app from the start so nothing
 * of the previous household (lists, filters, caches) stays on screen.
 */
export const switchToAccount = async (userId: string): Promise<void> => {
    // Carry this device's push subscription along: it then also receives the
    // other household's reminders. getRegistration(), not .ready, which never
    // settles when no service worker is installed.
    let push: unknown;
    try {
        if ('serviceWorker' in navigator && 'PushManager' in window) {
            const reg = await navigator.serviceWorker.getRegistration();
            const sub = await reg?.pushManager.getSubscription();
            if (sub) push = sub.toJSON();
        }
    } catch {
        push = undefined;
    }

    const res = await api.post<{ success: boolean; data: { token: string; user: unknown } }>(
        '/api/linked-accounts/switch',
        { userId, push }
    );
    if (!res.success || !res.data?.token) throw new Error('switch_failed');

    api.setToken(res.data.token);
    localStorage.setItem('user', JSON.stringify(res.data.user));
    // Offline copies belong to the household being left.
    await clearApiCache();
    window.location.assign(import.meta.env.BASE_URL || '/');
};
