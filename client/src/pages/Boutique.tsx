import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, CheckCircle, Loader2, Plus, X } from 'lucide-react';
import { Button } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useWebSocketUpdates } from '../hooks/useWebSocketUpdates';
import { addShopItem, deleteShopItem, getShop, setPaid, settleShop, type ShopItem, type ShopMonth } from '../lib/boutique';
import { thisMonth, todayIso } from '../lib/purchases';
import { cn } from '../lib/utils';
import { ShoppingTabs } from './ShoppingTabs';
import { dayLabel, MonthPicker, useMoney } from './purchases/ui';

const PREFS_KEY = 'openfamily.boutique';
const MAID = 'La bonne';

interface Prefs {
    paid: boolean;
    byMaid: boolean;
}

const readPrefs = (): Prefs => {
    try {
        const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null') as Partial<Prefs> | null;
        return { paid: raw?.paid !== false, byMaid: raw?.byMaid === true };
    } catch {
        return { paid: true, byMaid: false };
    }
};

const savePrefs = (prefs: Prefs) => {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
        // Private browsing: the choice is simply not remembered.
    }
};

/** "1 500", "1.500" and "1500" are all 1500; "2,5" is 2.5. */
const amount = (value: string): number => {
    const v = value.replace(/[\s\u00a0\u202f]/g, '');
    if (/^\d{1,3}([.,]\d{3})+$/.test(v)) return Number(v.replace(/[.,]/g, ''));
    return Number(v.replace(',', '.'));
};

/**
 * The corner shop's notebook: what was taken today (bread, pepper, charcoal…),
 * by whom, paid or on credit. What is owed is always in sight, and settled in
 * one tap when the shop is paid. Apart from the month's big shopping list.
 */
const Boutique: React.FC = () => {
    const { t } = useTranslation('boutique');
    const { user } = useAuth();
    const money = useMoney();
    const canEdit = Boolean(user?.is_owner) || (user?.role ?? '').toLowerCase() !== 'enfant';
    const myName = (user?.name ?? '').trim().split(/\s+/)[0] || t('me');

    const [month, setMonth] = useState(thisMonth());
    const [data, setData] = useState<ShopMonth | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const [what, setWhat] = useState('');
    const [price, setPrice] = useState('');
    const [date, setDate] = useState(todayIso());
    const [prefs, setPrefs] = useState<Prefs>(readPrefs);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [added, setAdded] = useState('');
    const [confirmSettle, setConfirmSettle] = useState(false);
    const [settled, setSettled] = useState('');
    const priceRef = useRef<HTMLInputElement>(null);
    const whatRef = useRef<HTMLInputElement>(null);

    const load = useCallback(async () => {
        try {
            setData(await getShop(month));
            setLoadFailed(false);
        } catch {
            setLoadFailed(true);
        }
    }, [month]);

    useEffect(() => {
        void load();
    }, [load]);

    // Every purchase is also a budget entry: another phone added or paid one.
    useWebSocketUpdates('budget', () => void load());

    const updatePrefs = (change: Partial<Prefs>) => {
        const next = { ...prefs, ...change };
        setPrefs(next);
        savePrefs(next);
    };

    const pick = (item: { what: string; price: number }) => {
        setWhat(item.what);
        setPrice(String(item.price));
        priceRef.current?.focus();
    };

    const add = async (e: React.FormEvent) => {
        e.preventDefault();
        const total = amount(price);
        if (!what.trim()) {
            whatRef.current?.focus();
            return;
        }
        if (!Number.isFinite(total) || total <= 0) {
            setError(t('errors.price'));
            priceRef.current?.focus();
            return;
        }
        setSaving(true);
        setError('');
        try {
            await addShopItem({
                what: what.trim(),
                total,
                paid: prefs.paid,
                bought_by: prefs.byMaid ? MAID : myName,
                purchased_on: date,
            });
            setAdded(`${what.trim()} · ${money(total)}`);
            setWhat('');
            setPrice('');
            if (month !== date.slice(0, 7)) setMonth(date.slice(0, 7));
            else await load();
            whatRef.current?.focus();
        } catch {
            setError(t('errors.save'));
        } finally {
            setSaving(false);
        }
    };

    const togglePaid = async (item: ShopItem) => {
        setData((d) => (d ? { ...d, items: d.items.map((i) => (i.id === item.id ? { ...i, paid: !i.paid } : i)) } : d));
        try {
            await setPaid(item.id, !item.paid);
        } finally {
            void load();
        }
    };

    const remove = async (item: ShopItem) => {
        if (!window.confirm(t('deleteConfirm', { what: item.what, amount: money(item.total) }))) return;
        try {
            await deleteShopItem(item.id);
        } finally {
            void load();
        }
    };

    const settle = async () => {
        setConfirmSettle(false);
        try {
            const result = await settleShop();
            setSettled(t('settled', { amount: money(result.total) }));
            await load();
        } catch {
            setError(t('errors.save'));
        }
    };

    // Days, newest first, each with its total.
    const days: Array<{ day: string; total: number; items: ShopItem[] }> = [];
    for (const item of data?.items ?? []) {
        const last = days[days.length - 1];
        if (last && last.day === item.purchased_on) {
            last.items.push(item);
            last.total += item.total;
        } else {
            days.push({ day: item.purchased_on, total: item.total, items: [item] });
        }
    }

    const choice = (selected: boolean, onClick: () => void, label: string) => (
        <button
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={onClick}
            className={cn(
                'flex-1 rounded-input px-3 py-2 text-caption font-medium transition-colors',
                selected ? 'bg-card text-foreground shadow-surface' : 'text-muted-foreground'
            )}
        >
            {label}
        </button>
    );

    return (
        <div className="mx-auto max-w-2xl space-y-4">
            <ShoppingTabs active="boutique" />

            {data && data.unpaid.count > 0 && (
                <section className="rounded-card border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
                    <p className="text-caption text-amber-800 dark:text-amber-300">{t('owed.title')}</p>
                    <p className="text-title font-bold text-foreground">{money(data.unpaid.total)}</p>
                    <p className="text-micro text-muted-foreground">
                        {t('owed.detail', { count: data.unpaid.count, since: data.unpaid.since ? dayLabel(data.unpaid.since) : '' })}
                    </p>
                    {canEdit && (confirmSettle ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className="text-caption text-foreground">{t('owed.confirm')}</span>
                            <Button size="sm" onClick={() => void settle()}>{t('owed.yes')}</Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmSettle(false)}>{t('owed.no')}</Button>
                        </div>
                    ) : (
                        <Button size="sm" variant="secondary" className="mt-3" onClick={() => setConfirmSettle(true)}>
                            <Check className="mr-2 h-4 w-4" />
                            {t('owed.settle')}
                        </Button>
                    ))}
                </section>
            )}
            {settled && (
                <p className="flex items-center gap-1 text-caption text-emerald-700 dark:text-emerald-400">
                    <CheckCircle className="h-4 w-4 shrink-0" />
                    {settled}
                </p>
            )}

            {canEdit && (
                <form onSubmit={add} className="space-y-3 rounded-card border border-border bg-card p-4 shadow-surface">
                    <div>
                        <label htmlFor="shop-what" className="mb-1 block text-caption font-medium text-foreground">{t('fields.what')}</label>
                        <input
                            id="shop-what"
                            ref={whatRef}
                            className="input-nexus w-full"
                            value={what}
                            maxLength={120}
                            placeholder={t('fields.whatPlaceholder')}
                            autoCapitalize="sentences"
                            enterKeyHint="next"
                            onChange={(e) => setWhat(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    priceRef.current?.focus();
                                }
                            }}
                        />
                    </div>
                    {data && data.frequent.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {data.frequent.map((f) => (
                                <button
                                    key={f.what}
                                    type="button"
                                    onClick={() => pick(f)}
                                    className="rounded-pill border border-border bg-card px-3 py-1 text-caption text-foreground hover:border-primary hover:bg-primary-soft hover:text-primary"
                                >
                                    {f.what} · {money(f.price)}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="shop-price" className="mb-1 block text-caption font-medium text-foreground">{t('fields.price')}</label>
                            <input
                                id="shop-price"
                                ref={priceRef}
                                className="input-nexus w-full"
                                inputMode="numeric"
                                value={price}
                                placeholder="300"
                                enterKeyHint="done"
                                onChange={(e) => setPrice(e.target.value)}
                            />
                        </div>
                        <div>
                            <label htmlFor="shop-date" className="mb-1 block text-caption font-medium text-foreground">{t('fields.date')}</label>
                            <input id="shop-date" type="date" className="input-nexus w-full" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value || todayIso())} />
                        </div>
                    </div>
                    <div className="flex gap-1 rounded-input bg-surface-2 p-1" role="radiogroup" aria-label={t('fields.payment')}>
                        {choice(prefs.paid, () => updatePrefs({ paid: true }), t('fields.paid'))}
                        {choice(!prefs.paid, () => updatePrefs({ paid: false }), t('fields.credit'))}
                    </div>
                    <div className="flex gap-1 rounded-input bg-surface-2 p-1" role="radiogroup" aria-label={t('fields.boughtBy')}>
                        {choice(!prefs.byMaid, () => updatePrefs({ byMaid: false }), t('fields.me'))}
                        {choice(prefs.byMaid, () => updatePrefs({ byMaid: true }), t('fields.maid'))}
                    </div>
                    {error && <p className="flex items-center gap-1 text-micro text-destructive"><AlertCircle className="h-4 w-4 shrink-0" />{error}</p>}
                    {added && !error && <p className="flex items-center gap-1 text-micro text-emerald-700 dark:text-emerald-400"><CheckCircle className="h-4 w-4 shrink-0" />{t('added', { what: added })}</p>}
                    <Button type="submit" disabled={saving} className="w-full">
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                        {t('add')}
                    </Button>
                </form>
            )}

            <MonthPicker month={month} onChange={setMonth} />

            {loadFailed ? (
                <p className="flex items-center gap-1 text-caption text-destructive"><AlertCircle className="h-4 w-4" />{t('errors.load')}</p>
            ) : !data ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : days.length === 0 ? (
                <p className="py-2 text-caption text-muted-foreground">{t('empty')}</p>
            ) : (
                <>
                    <p className="text-caption text-muted-foreground">
                        {t('monthTotal')} <span className="font-semibold text-foreground">{money(data.month_total)}</span>
                    </p>
                    {days.map((day) => (
                        <section key={day.day} className="rounded-card border border-border bg-card px-4 py-2 shadow-surface">
                            <div className="flex items-baseline justify-between gap-2 border-b border-border py-2">
                                <h3 className="text-caption font-semibold capitalize text-foreground">{dayLabel(day.day)}</h3>
                                <span className="text-caption text-muted-foreground">{money(day.total)}</span>
                            </div>
                            <ul className="divide-y divide-border">
                                {day.items.map((item) => (
                                    <li key={item.id} className="flex items-center gap-2 py-2">
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-body text-foreground">{item.what}</span>
                                            {item.bought_by && (
                                                <span className="block text-micro text-muted-foreground">
                                                    {item.bought_by === MAID ? t('fields.maid') : item.bought_by}
                                                </span>
                                            )}
                                        </span>
                                        <span className="shrink-0 text-caption font-semibold text-foreground">{money(item.total)}</span>
                                        <button
                                            type="button"
                                            disabled={!canEdit}
                                            onClick={() => void togglePaid(item)}
                                            className={cn(
                                                'shrink-0 rounded-pill px-2.5 py-1 text-micro font-semibold',
                                                item.paid
                                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400'
                                                    : 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                                            )}
                                            aria-label={item.paid ? t('markCredit', { what: item.what }) : t('markPaid', { what: item.what })}
                                        >
                                            {item.paid ? t('paid') : t('credit')}
                                        </button>
                                        {canEdit && (
                                            <button
                                                type="button"
                                                onClick={() => void remove(item)}
                                                className="shrink-0 rounded-input p-1 text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
                                                aria-label={t('remove', { what: item.what })}
                                            >
                                                <X className="h-4 w-4" />
                                            </button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}
                </>
            )}
        </div>
    );
};

export default Boutique;
