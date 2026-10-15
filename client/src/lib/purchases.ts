// Purchases ("Achats"): receipts, small expenses and electricity top-ups.
// Server side: server/src/routes/purchases.ts.
import { api } from './api';

export type PurchaseKind = 'receipt' | 'quick' | 'electricity';

export interface PurchaseItem {
    id?: string;
    name: string;
    product: string;
    category: string;
    quantity: number;
    unit_price: number | null;
    line_total: number;
}

export interface Purchase {
    id: string;
    kind: PurchaseKind;
    store: string;
    purchased_on: string;
    total: number;
    kwh: number | null;
    category: string;
    note: string | null;
    budget_entry_id: string | null;
    /** Corner shop: bought on credit until paid. */
    paid?: boolean;
    bought_by?: string | null;
    item_count?: number;
    created_by_name?: string | null;
    items?: PurchaseItem[];
}

export interface PurchaseInput {
    kind: PurchaseKind;
    store: string;
    purchased_on: string;
    total: number;
    kwh?: number | null;
    category: string;
    note?: string | null;
    items?: PurchaseItem[];
}

export interface ReceiptDraft {
    store: string;
    purchased_on: string | null;
    total: number;
    lines_total: number;
    totals_match: boolean;
    items: PurchaseItem[];
}

export interface Pair { name: string; total: number; previous: number }

export interface MonthTotals {
    id: string;
    total: number;
    receipts: number;
    quick: number;
    electricity: number;
    count: number;
}

export interface ElectricitySummary { amount: number; kwh: number; count: number; price_per_kwh: number | null }

export interface Analysis {
    month: MonthTotals;
    previous: MonthTotals;
    stores: Pair[];
    categories: Pair[];
    aisles: Pair[];
    products: Array<{
        product: string;
        quantity: number;
        total: number;
        purchases: number;
        avg_price: number | null;
        previous_quantity: number;
        previous_total: number;
        previous_avg_price: number | null;
    }>;
    electricity: {
        summary: { month: ElectricitySummary; previous: ElectricitySummary };
        top_ups: Array<{ id: string; date: string; total: number; kwh: number | null }>;
    };
    small_shops: Array<{ store: string; what: string; count: number; total: number }>;
    trend: Array<{ month: string; total: number; receipts: number; quick: number; electricity: number; kwh: number }>;
}

export interface CombinedHousehold {
    id: string;
    label: string | null;
    owner_name: string;
    is_current: boolean;
    month: MonthTotals;
    previous: MonthTotals;
    stores: Pair[];
    electricity: { month: ElectricitySummary; previous: ElectricitySummary };
}

type Ok<T> = { success: boolean; data: T };

export const listPurchases = async (month: string) =>
    (await api.get<Ok<Purchase[]>>(`/api/purchases?month=${month}`)).data;

export const getPurchase = async (id: string) =>
    (await api.get<Ok<Purchase>>(`/api/purchases/${id}`)).data;

export const createPurchase = async (input: PurchaseInput) =>
    (await api.post<Ok<Purchase>>('/api/purchases', input)).data;

export const updatePurchase = async (id: string, input: PurchaseInput) =>
    (await api.put<Ok<Purchase>>(`/api/purchases/${id}`, input)).data;

export const deletePurchase = async (id: string) => {
    await api.delete<{ success: boolean }>(`/api/purchases/${id}`);
};

export const getAnalysis = async (month: string) =>
    (await api.get<Ok<Analysis>>(`/api/purchases/analysis?month=${month}`)).data;

export const getCombined = async (month: string) =>
    (await api.get<Ok<{ month: string; households: CombinedHousehold[] }>>(`/api/purchases/combined?month=${month}`)).data;

export const scanReceipt = async (images: Array<{ mediaType: string; data: string }>) =>
    (await api.post<Ok<ReceiptDraft>>('/api/purchases/scan', { images })).data;

/**
 * Shrinks a phone photo before upload: long edge at most 2400 px (enough for
 * the small print of a long receipt), JPEG. Returns base64 without the prefix.
 */
export const prepareReceiptImage = (file: File): Promise<{ mediaType: 'image/jpeg'; data: string }> =>
    new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            try {
                const maxEdge = 2400;
                const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.naturalWidth * scale);
                canvas.height = Math.round(img.naturalHeight * scale);
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('canvas');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                resolve({ mediaType: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1) });
            } catch (error) {
                reject(error);
            } finally {
                URL.revokeObjectURL(url);
            }
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('image'));
        };
        img.src = url;
    });

/** 'YYYY-MM' of today, and month arithmetic for the month picker. */
export const thisMonth = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const shiftMonth = (month: string, delta: number): string => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const todayIso = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Relative change, null when there is nothing to compare with. */
export const change = (now: number, before: number): number | null =>
    before > 0 ? (now - before) / before : null;
