// Corner shop ("Boutique"): the small things bought almost every day, by the
// lady of the house or the maid, often on credit and paid later.
// Server side: the /boutique routes of server/src/routes/purchases.ts.
import { api } from './api';

export interface ShopItem {
    id: string;
    what: string;
    total: number;
    purchased_on: string;
    paid: boolean;
    paid_on: string | null;
    bought_by: string | null;
}

export interface ShopMonth {
    month: string;
    items: ShopItem[];
    month_total: number;
    unpaid: { total: number; count: number; since: string | null };
    frequent: Array<{ what: string; price: number; count: number }>;
}

type Ok<T> = { success: boolean; data: T };

export const getShop = async (month: string) =>
    (await api.get<Ok<ShopMonth>>(`/api/purchases/boutique?month=${month}`)).data;

export const addShopItem = async (input: { what: string; total: number; paid: boolean; bought_by: string | null; purchased_on: string }) =>
    (await api.post<Ok<{ id: string }>>('/api/purchases/boutique', input)).data;

export const setPaid = async (id: string, paid: boolean) => {
    await api.put<Ok<unknown>>(`/api/purchases/${id}/paid`, { paid });
};

export const settleShop = async () =>
    (await api.post<Ok<{ count: number; total: number }>>('/api/purchases/boutique/settle', {})).data;

export const deleteShopItem = async (id: string) => {
    await api.delete<{ success: boolean }>(`/api/purchases/${id}`);
};
