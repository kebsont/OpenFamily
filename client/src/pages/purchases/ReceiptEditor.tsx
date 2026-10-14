import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button, Input } from '../../components/ui';
import { useCategories } from '../../hooks/useCategories';
import type { PurchaseInput, PurchaseItem } from '../../lib/purchases';
import { NativeSelect, useMoney } from './ui';

export interface ReceiptValues {
    store: string;
    purchased_on: string;
    total: number;
    category: string;
    items: PurchaseItem[];
}

/** A store name printed on a receipt, made readable ("AUCHAN SENEGAL" → "Auchan"). */
export const tidyStore = (raw: string): string => {
    const s = raw.trim();
    if (/auchan/i.test(s)) return 'Auchan';
    if (!s) return '';
    return s.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
};

const parseAmount = (value: string): number => {
    const n = Number(value.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
};

/**
 * Checking a receipt read from a photo (or editing a saved one): store, date,
 * total, budget category and every line. The sum of the lines is compared to
 * the printed total, since a misread line shows up there first.
 */
export const ReceiptEditor: React.FC<{
    initial: ReceiptValues;
    saving: boolean;
    error: string;
    onSave: (input: PurchaseInput) => void;
    onCancel: () => void;
}> = ({ initial, saving, error, onSave, onCancel }) => {
    const { t } = useTranslation(['purchases', 'budget', 'shopping']);
    const money = useMoney();
    const { categories } = useCategories();
    const [store, setStore] = useState(initial.store);
    const [date, setDate] = useState(initial.purchased_on);
    const [total, setTotal] = useState(String(initial.total || ''));
    const [category, setCategory] = useState(initial.category);
    const [items, setItems] = useState<PurchaseItem[]>(initial.items);

    const linesTotal = useMemo(() => Math.round(items.reduce((s, i) => s + (Number(i.line_total) || 0), 0) * 100) / 100, [items]);
    const totalValue = parseAmount(total);
    const matches = Math.abs(totalValue - linesTotal) <= Math.max(1, totalValue * 0.005);

    const setItem = (index: number, patch: Partial<PurchaseItem>) =>
        setItems((list) => list.map((item, i) => (i === index ? { ...item, ...patch } : item)));

    const budgetOptions = categories.budget.map((c) => ({ value: c, label: t(`budget:categories.${c}`, { defaultValue: c }) }));
    const aisleOptions = categories.shopping.map((c) => ({ value: c, label: t(`shopping:categories.${c}`, { defaultValue: c }) }));

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({
            kind: 'receipt',
            store: store.trim(),
            purchased_on: date,
            total: totalValue,
            category,
            items: items
                .filter((i) => i.name.trim())
                .map((i) => ({ ...i, name: i.name.trim(), product: (i.product || i.name).trim() })),
        });
    };

    return (
        <form onSubmit={submit} className="space-y-4">
            <p className="text-micro text-muted-foreground">{t('editor.checkHint')}</p>

            <div className="grid grid-cols-2 gap-3">
                <Input label={t('fields.store')} id="receipt-store" value={store} maxLength={60} required
                    onChange={(e) => setStore(e.target.value)} />
                <Input label={t('fields.date')} id="receipt-date" type="date" value={date} required
                    onChange={(e) => setDate(e.target.value)} />
                <Input label={t('fields.total')} id="receipt-total" inputMode="decimal" value={total} required
                    onChange={(e) => setTotal(e.target.value)} />
                <NativeSelect label={t('fields.budgetCategory')} id="receipt-category" value={category}
                    onChange={setCategory} options={budgetOptions} />
            </div>

            <div className={`flex items-start gap-2 rounded-input px-3 py-2 text-micro ${matches
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'}`}>
                {matches ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                <span>
                    {matches
                        ? t('editor.totalsMatch', { amount: money(linesTotal) })
                        : t('editor.totalsDiffer', { lines: money(linesTotal), total: money(totalValue) })}
                </span>
            </div>

            <div>
                <p className="mb-1 text-caption font-medium text-foreground">{t('editor.lines', { count: items.length })}</p>
                {items.length > 0 && (
                    <div className="mb-1 grid grid-cols-[3.25rem_1fr_1.4fr] gap-2 px-2.5 text-micro text-muted-foreground">
                        <span>{t('fields.quantity')}</span>
                        <span>{t('fields.lineTotal')}</span>
                        <span>{t('fields.aisle')}</span>
                    </div>
                )}
                <ul className="space-y-2">
                    {items.map((item, index) => (
                        <li key={index} className="space-y-2 rounded-input border border-border bg-card p-2.5">
                            <div className="flex items-center gap-2">
                                <input
                                    className="input-nexus min-w-0 flex-1 text-caption"
                                    value={item.name}
                                    aria-label={t('fields.itemName')}
                                    onChange={(e) => setItem(index, { name: e.target.value, product: e.target.value })}
                                />
                                <button
                                    type="button"
                                    onClick={() => setItems((list) => list.filter((_, i) => i !== index))}
                                    className="shrink-0 rounded-input p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                    aria-label={t('editor.removeLine')}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>
                            <div className="grid grid-cols-[3.25rem_1fr_1.4fr] gap-2">
                                <input
                                    className="input-nexus text-caption"
                                    inputMode="decimal"
                                    value={String(item.quantity)}
                                    aria-label={t('fields.quantity')}
                                    onChange={(e) => setItem(index, { quantity: parseAmount(e.target.value) || 1 })}
                                />
                                <input
                                    className="input-nexus text-caption"
                                    inputMode="decimal"
                                    value={String(item.line_total)}
                                    aria-label={t('fields.lineTotal')}
                                    onChange={(e) => setItem(index, { line_total: parseAmount(e.target.value) })}
                                />
                                <select
                                    className="input-nexus text-caption"
                                    value={item.category}
                                    aria-label={t('fields.aisle')}
                                    onChange={(e) => setItem(index, { category: e.target.value })}
                                >
                                    {aisleOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </div>
                        </li>
                    ))}
                </ul>
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="mt-2"
                    onClick={() => setItems((list) => [...list, {
                        name: '', product: '', category: categories.shopping[0] ?? 'Autre', quantity: 1, unit_price: null, line_total: 0,
                    }])}
                >
                    <Plus className="mr-2 h-4 w-4" />
                    {t('editor.addLine')}
                </Button>
            </div>

            {error && (
                <p className="flex items-center gap-1 text-micro text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {error}
                </p>
            )}

            <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={saving} className="whitespace-nowrap">
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t('actions.save')}
                </Button>
                <Button type="button" variant="ghost" onClick={onCancel} className="whitespace-nowrap">
                    {t('actions.cancel')}
                </Button>
            </div>
        </form>
    );
};
