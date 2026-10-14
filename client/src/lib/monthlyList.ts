// Monthly shopping list ("Courses"): one list per month, written like a note
// and ticked in the shop; past months are the history. Suggestions come from
// the previous lists, receipts and corner-shop purchases.
// Server side: server/src/routes/monthlyList.ts.
import { api } from './api';

export interface ListItem {
    id: string;
    month: string;
    name: string;
    quantity: number | null;
    detail: string | null;
    checked: boolean;
    position: number;
}

export interface MonthList {
    month: string;
    items: ListItem[];
    history: Array<{ month: string; count: number }>;
}

export type SuggestionStatus = 'due' | 'not_yet' | 'occasional' | 'planned' | 'in_list';

export interface Suggestion {
    key: string;
    name: string;
    detail: string | null;
    quantity: number | null;
    status: SuggestionStatus;
}

export interface Suggestions {
    month: string;
    items: Suggestion[];
}

type Ok<T> = { success: boolean; data: T };

export const getMonth = async (month: string) =>
    (await api.get<Ok<MonthList>>(`/api/monthly-list/month?month=${month}`)).data;

/** One product per line; returns the whole list of the month. */
export const addLines = async (month: string, text: string) =>
    (await api.post<Ok<{ month: string; items: ListItem[] }>>('/api/monthly-list/items', { month, text })).data.items;

export const updateItem = async (id: string, change: { checked?: boolean; text?: string }) =>
    (await api.put<Ok<ListItem>>(`/api/monthly-list/items/${id}`, change)).data;

export const deleteItem = async (id: string) => {
    await api.delete<{ success: boolean }>(`/api/monthly-list/items/${id}`);
};

export const getSuggestions = async (month: string) =>
    (await api.get<Ok<Suggestions>>(`/api/monthly-list/suggestions?month=${month}`)).data;

export const importLists = async (text: string, month?: string) =>
    (await api.post<Ok<{ months: Array<{ month: string; count: number }> }>>('/api/monthly-list/import', { text, month: month || undefined })).data;

export const deleteListMonth = async (month: string) => {
    await api.delete<{ success: boolean }>(`/api/monthly-list/history/${month}`);
};

/** A line as the family writes it: "Pâtes (penne) 2". */
export const lineText = (item: { name: string; detail: string | null; quantity: number | null }) =>
    `${item.name}${item.detail ? ` (${item.detail})` : ''}${item.quantity ? ` ${item.quantity}` : ''}`;
