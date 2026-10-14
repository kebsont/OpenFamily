// Monthly list ("Liste du mois"): next month's big shopping run, suggested from
// the previous lists, receipts and corner-shop purchases.
// Server side: server/src/routes/monthlyList.ts.
import { api } from './api';

export type Place = 'store' | 'market';
export type SuggestionStatus = 'due' | 'not_yet' | 'occasional' | 'planned' | 'in_list';

export interface Suggestion {
    key: string;
    name: string;
    detail: string | null;
    quantity: number | null;
    place: Place;
    category: string;
    status: SuggestionStatus;
    months: number;
    total_months: number;
    interval: number | null;
    last: string | null;
    corner: number;
}

export interface Suggestions {
    month: string;
    store_label: string | null;
    total_months: number;
    history: Array<{ month: string; count: number }>;
    items: Suggestion[];
}

export interface ApplyItem {
    name: string;
    place: Place;
    quantity?: number | null;
    detail?: string | null;
    category?: string;
}

type Ok<T> = { success: boolean; data: T };

export const getSuggestions = async (month: string) =>
    (await api.get<Ok<Suggestions>>(`/api/monthly-list/suggestions?month=${month}`)).data;

export const applyMonthlyList = async (month: string, items: ApplyItem[]) =>
    (await api.post<Ok<{ added: number; skipped: number; market: number }>>('/api/monthly-list/apply', { month, items })).data;

export const importLists = async (text: string, month?: string) =>
    (await api.post<Ok<{ months: Array<{ month: string; count: number }> }>>('/api/monthly-list/import', { text, month: month || undefined })).data;

export const deleteListMonth = async (month: string) => {
    await api.delete<{ success: boolean }>(`/api/monthly-list/history/${month}`);
};

/** The month being prepared: this one, or the next from the 20th on. */
export const defaultListMonth = (today = new Date()): string => {
    const d = new Date(today.getFullYear(), today.getMonth() + (today.getDate() >= 20 ? 1 : 0), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
