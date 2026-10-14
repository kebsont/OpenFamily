import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Loader2, Pencil, Receipt, ShoppingBag, Trash2, Zap } from 'lucide-react';
import { Button } from '../../components/ui';
import { cn } from '../../lib/utils';
import { deletePurchase, getPurchase, updatePurchase, type Purchase, type PurchaseInput } from '../../lib/purchases';
import { ReceiptEditor } from './ReceiptEditor';
import { classes, dayLabel, Empty, useMoney } from './ui';

const KIND_ICON = { receipt: Receipt, quick: ShoppingBag, electricity: Zap } as const;

export const HistoryPanel: React.FC<{
    purchases: Purchase[];
    loading: boolean;
    canEdit: boolean;
    onChanged: () => void;
}> = ({ purchases, loading, canEdit, onChanged }) => {
    const { t } = useTranslation(['purchases', 'budget', 'shopping']);
    const money = useMoney();
    const [open, setOpen] = useState<string | null>(null);
    const [detail, setDetail] = useState<Purchase | null>(null);
    const [editing, setEditing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const toggle = async (purchase: Purchase) => {
        setEditing(false);
        setError('');
        if (open === purchase.id) {
            setOpen(null);
            return;
        }
        setOpen(purchase.id);
        setDetail(null);
        try {
            setDetail(await getPurchase(purchase.id));
        } catch {
            setError(t('errors.generic'));
        }
    };

    const remove = async (purchase: Purchase) => {
        if (!window.confirm(t('history.deleteConfirm', { store: purchase.store, amount: money(purchase.total) }))) return;
        setBusy(true);
        try {
            await deletePurchase(purchase.id);
            setOpen(null);
            onChanged();
        } catch {
            setError(t('errors.generic'));
        } finally {
            setBusy(false);
        }
    };

    const saveEdit = async (input: PurchaseInput) => {
        if (!detail) return;
        setBusy(true);
        setError('');
        try {
            setDetail(await updatePurchase(detail.id, input));
            setEditing(false);
            onChanged();
        } catch {
            setError(t('errors.generic'));
        } finally {
            setBusy(false);
        }
    };

    if (loading && purchases.length === 0) {
        return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
    }
    if (purchases.length === 0) {
        return <Empty>{t('history.empty')}</Empty>;
    }

    // Grouped by day, newest first (the server already orders them).
    const days: Array<{ day: string; items: Purchase[] }> = [];
    for (const p of purchases) {
        const last = days[days.length - 1];
        if (last && last.day === p.purchased_on) last.items.push(p);
        else days.push({ day: p.purchased_on, items: [p] });
    }

    const subtitle = (p: Purchase) => {
        if (p.kind === 'electricity') return p.kwh !== null ? t('history.kwh', { kwh: p.kwh }) : t('kinds.electricity');
        if (p.kind === 'receipt') return t('history.lines', { count: p.item_count ?? 0 });
        return p.note || t('kinds.quick');
    };

    return (
        <div className="space-y-4">
            {days.map(({ day, items }) => (
                <div key={day}>
                    <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">{dayLabel(day)}</p>
                    <ul className="space-y-2">
                        {items.map((p) => {
                            const Icon = KIND_ICON[p.kind];
                            const isOpen = open === p.id;
                            return (
                                <li key={p.id} className="rounded-card border border-border bg-card shadow-surface">
                                    <button
                                        type="button"
                                        onClick={() => void toggle(p)}
                                        className="flex w-full items-center gap-3 p-3 text-left"
                                        aria-expanded={isOpen}
                                    >
                                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card bg-primary-soft text-primary">
                                            <Icon className="h-4 w-4" />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-caption font-medium text-foreground">{t(`stores.${p.store}`, { defaultValue: p.store })}</span>
                                            <span className="block truncate text-micro text-muted-foreground">{subtitle(p)}</span>
                                        </span>
                                        <span className="shrink-0 text-caption font-semibold text-foreground">{money(p.total)}</span>
                                        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                                    </button>

                                    {isOpen && (
                                        <div className="border-t border-border p-3">
                                            {!detail ? (
                                                <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                                            ) : editing ? (
                                                <ReceiptEditor
                                                    initial={{
                                                        store: detail.store,
                                                        purchased_on: detail.purchased_on,
                                                        total: detail.total,
                                                        category: detail.category,
                                                        items: detail.items ?? [],
                                                    }}
                                                    saving={busy}
                                                    error={error}
                                                    onSave={(input) => void saveEdit(input)}
                                                    onCancel={() => setEditing(false)}
                                                />
                                            ) : (
                                                <div className="space-y-3">
                                                    <p className="text-micro text-muted-foreground">
                                                        {t(`budget:categories.${detail.category}`, { defaultValue: detail.category })}
                                                        {detail.created_by_name ? ` · ${t('history.by', { name: detail.created_by_name })}` : ''}
                                                    </p>
                                                    {(detail.items?.length ?? 0) > 0 && (
                                                        <ul className="divide-y divide-border">
                                                            {detail.items!.map((item, i) => (
                                                                <li key={item.id ?? i} className="flex items-baseline justify-between gap-2 py-1.5">
                                                                    <span className="min-w-0">
                                                                        <span className="block truncate text-caption text-foreground">{item.name}</span>
                                                                        <span className="block text-micro text-muted-foreground">
                                                                            {item.quantity !== 1 ? `${item.quantity} × ` : ''}
                                                                            {t(`shopping:categories.${item.category}`, { defaultValue: item.category })}
                                                                        </span>
                                                                    </span>
                                                                    <span className={classes('shrink-0 text-caption', item.line_total < 0 ? 'text-emerald-600' : 'text-foreground')}>
                                                                        {money(item.line_total)}
                                                                    </span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                    {error && <p className="text-micro text-destructive">{error}</p>}
                                                    {canEdit && (
                                                        <div className="flex flex-wrap gap-2">
                                                            {detail.kind === 'receipt' && (
                                                                <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
                                                                    <Pencil className="mr-2 h-4 w-4" />{t('actions.edit')}
                                                                </Button>
                                                            )}
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="ghost"
                                                                disabled={busy}
                                                                onClick={() => void remove(p)}
                                                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                                            >
                                                                <Trash2 className="mr-2 h-4 w-4" />{t('actions.delete')}
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </div>
    );
};
