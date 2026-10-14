import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { change, thisMonth, type Analysis } from '../../lib/purchases';
import { addLines } from '../../lib/monthlyList';
import { BarRow, classes, dayLabel, Delta, Empty, monthLabel, Section, useMoney } from './ui';

/** Small shops worth replacing by the monthly supermarket run. */
const CORNER_SHOPS = new Set(['boutique']);

export const AnalysisPanel: React.FC<{ data: Analysis | null; loading: boolean }> = ({ data, loading }) => {
    const { t } = useTranslation(['purchases', 'budget', 'shopping']);
    const money = useMoney();
    const [added, setAdded] = useState<Set<string>>(new Set());
    const [adding, setAdding] = useState<string | null>(null);

    if (!data) {
        return loading
            ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            : <Empty>{t('errors.generic')}</Empty>;
    }

    const { month, previous } = data;
    const nothing = month.total === 0 && previous.total === 0;
    const elec = data.electricity.summary;
    const maxStore = Math.max(0, ...data.stores.map((s) => Math.max(s.total, s.previous)));
    const maxAisle = Math.max(0, ...data.aisles.map((s) => Math.max(s.total, s.previous)));
    const maxTrend = Math.max(0, ...data.trend.map((m) => m.total));

    const addToList = async (what: string) => {
        const key = what.toLowerCase();
        setAdding(key);
        try {
            // On this month's list, for the big run instead of the corner shop.
            await addLines(thisMonth(), what);
            setAdded((s) => new Set(s).add(key));
        } finally {
            setAdding(null);
        }
    };

    const tile = (label: string, value: number, before: number, extra?: React.ReactNode) => (
        <div className="rounded-card border border-border bg-card p-3 shadow-surface">
            <p className="text-micro text-muted-foreground">{label}</p>
            <p className="mt-0.5 text-body font-semibold text-foreground">{money(value)}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
                <Delta now={value} before={before} />
                {extra}
            </div>
        </div>
    );

    if (nothing) return <Empty>{t('analysis.empty')}</Empty>;

    const smallShops = data.small_shops;
    const corner = smallShops.filter((s) => CORNER_SHOPS.has(s.store.toLowerCase()) && s.what);

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
                {tile(t('analysis.total'), month.total, previous.total)}
                {tile(t('analysis.receipts'), month.receipts, previous.receipts)}
                {tile(t('analysis.quick'), month.quick, previous.quick)}
                {tile(t('analysis.electricity'), month.electricity, previous.electricity,
                    elec.month.kwh > 0 ? <span className="text-micro text-muted-foreground">{t('analysis.kwhShort', { kwh: elec.month.kwh })}</span> : undefined)}
            </div>

            <Section title={t('analysis.trend')}>
                <div className="flex items-end gap-2">
                    {data.trend.map((m) => (
                        <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                            {/* A fixed-height track: a percentage height needs a definite parent. */}
                            <div className="relative h-24 w-full">
                                <div
                                    className={cn('absolute inset-x-0 bottom-0 rounded-t-input', m.month === month.id ? 'bg-primary' : 'bg-primary/30')}
                                    style={{ height: `${maxTrend > 0 && m.total > 0 ? Math.max(3, (m.total / maxTrend) * 100) : 0}%` }}
                                    title={money(m.total)}
                                />
                            </div>
                            <span className="text-[10px] capitalize text-muted-foreground">{monthLabel(m.month, 'short')}</span>
                        </div>
                    ))}
                </div>
                <p className="mt-2 text-micro text-muted-foreground">
                    {t('analysis.trendHint', { amount: money(Math.round(data.trend.reduce((s, m) => s + m.total, 0) / Math.max(1, data.trend.filter((m) => m.total > 0).length))) })}
                </p>
            </Section>

            <Section title={t('analysis.byStore')}>
                {data.stores.length === 0 ? <Empty>{t('analysis.none')}</Empty> : (
                    <ul className="space-y-3">
                        {data.stores.map((s) => (
                            <BarRow key={s.name} name={t(`stores.${s.name}`, { defaultValue: s.name })} total={s.total} previous={s.previous} max={maxStore} />
                        ))}
                    </ul>
                )}
            </Section>

            {data.aisles.length > 0 && (
                <Section title={t('analysis.byAisle')}>
                    <ul className="space-y-3">
                        {data.aisles.map((s) => (
                            <BarRow key={s.name} name={t(`shopping:categories.${s.name}`, { defaultValue: s.name })} total={s.total} previous={s.previous} max={maxAisle} />
                        ))}
                    </ul>
                </Section>
            )}

            {data.products.length > 0 && (
                <Section title={t('analysis.products')}>
                    <ul className="divide-y divide-border">
                        {data.products.slice(0, 15).map((p) => {
                            const priceChange = p.avg_price !== null && p.previous_avg_price !== null ? change(p.avg_price, p.previous_avg_price) : null;
                            return (
                                <li key={p.product} className="flex items-start justify-between gap-3 py-2">
                                    <span className="min-w-0">
                                        <span className="block truncate text-caption font-medium text-foreground">{p.product}</span>
                                        <span className="block text-micro text-muted-foreground">
                                            {t('analysis.qty', { qty: p.quantity })}
                                            {' · '}
                                            {p.previous_quantity > 0 ? t('analysis.qtyBefore', { qty: p.previous_quantity }) : t('delta.new')}
                                        </span>
                                        {priceChange !== null && Math.round(priceChange * 100) !== 0 && (
                                            <span className={classes('block text-micro', priceChange > 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400')}>
                                                {t(priceChange > 0 ? 'analysis.priceUp' : 'analysis.priceDown', {
                                                    pct: Math.abs(Math.round(priceChange * 100)),
                                                    price: money(p.avg_price!),
                                                })}
                                            </span>
                                        )}
                                    </span>
                                    <span className="shrink-0 text-right">
                                        <span className="block text-caption font-semibold text-foreground">{money(p.total)}</span>
                                        <Delta now={p.total} before={p.previous_total} />
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </Section>
            )}

            <Section title={t('analysis.electricityTitle')}>
                {elec.month.count === 0 ? <Empty>{t('analysis.noElectricity')}</Empty> : (
                    <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="rounded-input bg-surface-2 p-2">
                                <p className="text-micro text-muted-foreground">{t('analysis.spent')}</p>
                                <p className="text-caption font-semibold text-foreground">{money(elec.month.amount)}</p>
                            </div>
                            <div className="rounded-input bg-surface-2 p-2">
                                <p className="text-micro text-muted-foreground">{t('analysis.energy')}</p>
                                <p className="text-caption font-semibold text-foreground">{elec.month.kwh > 0 ? `${elec.month.kwh} kWh` : '—'}</p>
                            </div>
                            <div className="rounded-input bg-surface-2 p-2">
                                <p className="text-micro text-muted-foreground">{t('analysis.perKwh')}</p>
                                <p className="text-caption font-semibold text-foreground">{elec.month.price_per_kwh !== null ? money(elec.month.price_per_kwh) : '—'}</p>
                            </div>
                        </div>
                        <p className="text-micro text-muted-foreground">
                            {t('analysis.electricityCompare', {
                                count: elec.month.count,
                                before: money(elec.previous.amount),
                                kwh: elec.previous.kwh,
                            })}
                        </p>
                        <ul className="divide-y divide-border">
                            {data.electricity.top_ups.map((u) => (
                                <li key={u.id} className="flex justify-between py-1.5 text-caption">
                                    <span className="capitalize text-muted-foreground">{dayLabel(u.date)}</span>
                                    <span className="text-foreground">{money(u.total)}{u.kwh !== null ? ` · ${u.kwh} kWh` : ''}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </Section>

            <Section title={t('analysis.smallShops')}>
                {smallShops.length === 0 ? <Empty>{t('analysis.noSmallShops')}</Empty> : (
                    <div className="space-y-3">
                        {corner.length > 0 && <p className="text-micro text-muted-foreground">{t('analysis.groupHint')}</p>}
                        <ul className="divide-y divide-border">
                            {smallShops.map((s) => {
                                const key = s.what.toLowerCase();
                                const isCorner = CORNER_SHOPS.has(s.store.toLowerCase()) && s.what;
                                return (
                                    <li key={`${s.store}-${key}`} className="flex items-center justify-between gap-2 py-2">
                                        <span className="min-w-0">
                                            <span className="block truncate text-caption text-foreground">{s.what || t('analysis.unnamed')}</span>
                                            <span className="block text-micro text-muted-foreground">
                                                {t(`stores.${s.store}`, { defaultValue: s.store })} · {t('analysis.times', { count: s.count })}
                                            </span>
                                        </span>
                                        <span className="flex shrink-0 items-center gap-2">
                                            <span className="text-caption font-semibold text-foreground">{money(s.total)}</span>
                                            {isCorner && (
                                                added.has(key) ? (
                                                    <span className="flex items-center gap-1 text-micro text-emerald-600"><Check className="h-4 w-4" />{t('analysis.added')}</span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => void addToList(s.what)}
                                                        disabled={adding !== null}
                                                        className="flex items-center gap-1 rounded-input border border-border px-2 py-1 text-micro font-medium text-primary hover:bg-primary-soft"
                                                    >
                                                        {adding === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                                                        {t('analysis.addToList')}
                                                    </button>
                                                )
                                            )}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}
            </Section>
        </div>
    );
};
