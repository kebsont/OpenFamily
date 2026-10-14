import React from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { CombinedHousehold } from '../../lib/purchases';
import { BarRow, Delta, Empty, Section, useMoney } from './ui';

/**
 * Every household of the person who runs several, side by side. The server
 * answers only to that person (linked accounts); nobody else sees this tab.
 */
export const CombinedPanel: React.FC<{ households: CombinedHousehold[] | null; loading: boolean }> = ({ households, loading }) => {
    const { t } = useTranslation('purchases');
    const money = useMoney();

    if (!households) {
        return loading
            ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            : <Empty>{t('errors.generic')}</Empty>;
    }

    const name = (h: CombinedHousehold) => h.label || t('combined.familyOf', { name: h.owner_name });
    const sum = (pick: (h: CombinedHousehold) => number) => households.reduce((s, h) => s + pick(h), 0);
    const total = sum((h) => h.month.total);
    const totalBefore = sum((h) => h.previous.total);
    const kwh = sum((h) => h.electricity.month.kwh);
    const max = Math.max(0, ...households.map((h) => Math.max(h.month.total, h.previous.total)));

    const line = (label: string, now: number, before: number) => (
        <div className="flex items-center justify-between gap-2 py-1.5">
            <span className="text-caption text-muted-foreground">{label}</span>
            <span className="flex items-center gap-2">
                <span className="text-caption font-medium text-foreground">{money(now)}</span>
                <Delta now={now} before={before} className="min-w-[3.5rem] text-right" />
            </span>
        </div>
    );

    return (
        <div className="space-y-4">
            <Section title={t('combined.allHouseholds')}>
                <p className="text-title font-bold text-foreground">{money(total)}</p>
                <div className="mt-1 flex items-center gap-2">
                    <Delta now={total} before={totalBefore} />
                    <span className="text-micro text-muted-foreground">{t('lastMonth', { amount: money(totalBefore) })}</span>
                </div>
                {kwh > 0 && <p className="mt-1 text-micro text-muted-foreground">{t('combined.electricity', { kwh })}</p>}
                <ul className="mt-4 space-y-3">
                    {households.map((h) => (
                        <BarRow key={h.id} name={name(h)} total={h.month.total} previous={h.previous.total} max={max} />
                    ))}
                </ul>
            </Section>

            {households.map((h) => (
                <Section key={h.id} title={name(h)} action={h.is_current ? <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary">{t('combined.open')}</span> : undefined}>
                    {h.month.total === 0 && h.previous.total === 0 ? <Empty>{t('analysis.none')}</Empty> : (
                        <div className="divide-y divide-border">
                            {line(t('analysis.receipts'), h.month.receipts, h.previous.receipts)}
                            {line(t('analysis.quick'), h.month.quick, h.previous.quick)}
                            {line(t('analysis.electricity'), h.month.electricity, h.previous.electricity)}
                            {h.electricity.month.kwh > 0 && (
                                <p className="py-1.5 text-micro text-muted-foreground">
                                    {t('combined.kwhLine', {
                                        kwh: h.electricity.month.kwh,
                                        price: h.electricity.month.price_per_kwh !== null ? money(h.electricity.month.price_per_kwh) : '—',
                                    })}
                                </p>
                            )}
                            {h.stores.length > 0 && (
                                <p className="py-1.5 text-micro text-muted-foreground">
                                    {h.stores.slice(0, 4).map((s) => `${t(`stores.${s.name}`, { defaultValue: s.name })} ${money(s.total)}`).join(' · ')}
                                </p>
                            )}
                        </div>
                    )}
                </Section>
            ))}
        </div>
    );
};
