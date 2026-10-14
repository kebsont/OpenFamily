import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { cn, formatCurrency } from '../../lib/utils';
import { intlLocale } from '../../i18n/format';
import { change, shiftMonth, thisMonth } from '../../lib/purchases';

/** Amounts in the family's currency (FCFA by default here). */
/**
 * Joins classes without tailwind-merge: it reads the theme's custom sizes
 * (text-micro, text-caption) as colours and would drop them next to a
 * text colour.
 */
export const classes = (...list: Array<string | false | null | undefined>) => list.filter(Boolean).join(' ');

export const useMoney = () => {
    const { user } = useAuth();
    const currency = user?.currency || 'XOF';
    return (amount: number) => formatCurrency(amount, currency);
};

export const monthLabel = (month: string, style: 'long' | 'short' = 'long') => {
    const [y, m] = month.split('-').map(Number);
    return new Intl.DateTimeFormat(intlLocale(), { month: style, year: style === 'long' ? 'numeric' : undefined })
        .format(new Date(y, m - 1, 1));
};

export const dayLabel = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat(intlLocale(), { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
};

export const MonthPicker: React.FC<{ month: string; onChange: (m: string) => void; max?: string }> = ({ month, onChange, max }) => {
    const { t } = useTranslation('purchases');
    const atCurrent = month >= (max ?? thisMonth());
    return (
        <div className="flex items-center justify-between gap-2 rounded-card border border-border bg-card px-2 py-1.5">
            <button
                type="button"
                onClick={() => onChange(shiftMonth(month, -1))}
                className="rounded-input p-2 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                aria-label={t('month.previous')}
            >
                <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-caption font-semibold capitalize text-foreground">{monthLabel(month)}</span>
            <button
                type="button"
                onClick={() => onChange(shiftMonth(month, 1))}
                disabled={atCurrent}
                className="rounded-input p-2 text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:opacity-30"
                aria-label={t('month.next')}
            >
                <ChevronRight className="h-4 w-4" />
            </button>
        </div>
    );
};

/**
 * Change against last month. Spending more is shown in red, less in green;
 * "new" when there was nothing last month.
 */
export const Delta: React.FC<{ now: number; before: number; className?: string }> = ({ now, before, className }) => {
    const { t } = useTranslation('purchases');
    const ratio = change(now, before);
    if (ratio === null) {
        return now > 0 ? <span className={classes('whitespace-nowrap text-micro text-muted-foreground', className)}>{t('delta.new')}</span> : null;
    }
    const pct = Math.round(ratio * 100);
    if (pct === 0) return <span className={classes('whitespace-nowrap text-micro text-muted-foreground', className)}>{t('delta.same')}</span>;
    return (
        <span className={classes('whitespace-nowrap text-micro font-semibold', pct > 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400', className)}>
            {pct > 0 ? '▲' : '▼'} {Math.abs(pct)} %
        </span>
    );
};

/** A labelled horizontal bar: this month's amount, last month's beside it. */
export const BarRow: React.FC<{ name: string; total: number; previous: number; max: number }> = ({ name, total, previous, max }) => {
    const { t } = useTranslation('purchases');
    const money = useMoney();
    const width = max > 0 ? Math.max(2, Math.round((total / max) * 100)) : 0;
    return (
        <li className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-caption text-foreground">{name}</span>
                <span className="shrink-0 text-caption font-semibold text-foreground">{money(total)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
            </div>
            <div className="flex items-center justify-between text-micro text-muted-foreground">
                <span>{t('lastMonth', { amount: money(previous) })}</span>
                <Delta now={total} before={previous} />
            </div>
        </li>
    );
};

export const Section: React.FC<{ title: string; children: React.ReactNode; action?: React.ReactNode }> = ({ title, children, action }) => (
    <section className="rounded-card border border-border bg-card p-4 shadow-surface">
        <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-caption font-semibold text-foreground">{title}</h3>
            {action}
        </div>
        {children}
    </section>
);

export const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <p className="py-2 text-micro text-muted-foreground">{children}</p>
);

/** Native select (the phone's own picker), styled like the app's inputs. */
export const NativeSelect: React.FC<{
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    label?: string;
    id?: string;
    className?: string;
}> = ({ value, onChange, options, label, id, className }) => (
    <div className={cn('w-full', className)}>
        {label && (
            <label htmlFor={id} className="mb-1.5 block text-caption font-medium text-foreground">{label}</label>
        )}
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="input-nexus w-full text-caption">
            {options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
            ))}
        </select>
    </div>
);
