import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    AlertCircle, ArrowLeftRight, Check, CheckCircle, ChevronLeft, ClipboardList, Loader2, Plus, ShoppingBasket, Store, Trash2,
} from 'lucide-react';
import { Button, Textarea } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import {
    applyMonthlyList,
    defaultListMonth,
    deleteListMonth,
    getSuggestions,
    importLists,
    type ApplyItem,
    type Place,
    type Suggestion,
    type Suggestions,
} from '../lib/monthlyList';
import { shiftMonth, thisMonth } from '../lib/purchases';
import { cn } from '../lib/utils';
import { Empty, MonthPicker, monthLabel, Section } from './purchases/ui';

/** Already on this month's list or in the shopping list: nothing to tick. */
const isDone = (item: Suggestion) => item.status === 'planned' || item.status === 'in_list';

interface Custom {
    id: number;
    name: string;
    place: Place;
}

/**
 * The big shopping run of the month, prepared from the previous months: the
 * products usually needed are ticked, the others are one tap away. Just the
 * products, supermarket and market apart; a product moved from one to the
 * other stays there.
 */
const MonthlyList: React.FC = () => {
    const { t } = useTranslation('monthlyList');
    const { user } = useAuth();
    const canEdit = Boolean(user?.is_owner) || (user?.role ?? '').toLowerCase() !== 'enfant';

    const [month, setMonth] = useState(defaultListMonth());
    const [data, setData] = useState<Suggestions | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [places, setPlaces] = useState<Map<string, Place>>(new Map());
    const [custom, setCustom] = useState<Custom[]>([]);
    const [newName, setNewName] = useState('');
    const [newPlace, setNewPlace] = useState<Place>('store');
    const [applying, setApplying] = useState(false);
    const [applyError, setApplyError] = useState('');
    const [result, setResult] = useState<{ added: number; skipped: number; market: number } | null>(null);
    const [showImport, setShowImport] = useState(false);
    // Opening the page once this month's list is done goes to next month's.
    const firstLoad = useRef(true);

    const load = useCallback(async (keepResult = false) => {
        setLoading(true);
        setLoadError('');
        if (!keepResult) setResult(null);
        try {
            const next = await getSuggestions(month);
            if (firstLoad.current) {
                firstLoad.current = false;
                if (month === thisMonth() && next.history.some((h) => h.month === month)) {
                    setMonth(shiftMonth(month, 1));
                    return;
                }
            }
            setData(next);
            setSelected(new Set(next.items.filter((i) => i.status === 'due').map((i) => i.key)));
            setPlaces(new Map());
            setShowImport((open) => open || next.history.length === 0);
        } catch {
            setLoadError('load');
        } finally {
            setLoading(false);
        }
    }, [month]);

    useEffect(() => {
        void load();
    }, [load]);

    const placeOf = (item: Suggestion): Place => places.get(item.key) ?? item.place;
    const storeLabel = data?.store_label || t('places.store');
    const placeLabel = (place: Place) => (place === 'market' ? t('places.market') : storeLabel);

    const toggle = (key: string) =>
        setSelected((s) => {
            const next = new Set(s);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    const move = (item: Suggestion) =>
        setPlaces((m) => new Map(m).set(item.key, placeOf(item) === 'market' ? 'store' : 'market'));

    const visible = useMemo(() => (data?.items ?? []).filter((i) => !isDone(i)), [data]);
    const chosen = useMemo(() => visible.filter((i) => selected.has(i.key)), [visible, selected]);
    const chosenCount = chosen.length + custom.length;
    const marketCount = chosen.filter((i) => placeOf(i) === 'market').length + custom.filter((c) => c.place === 'market').length;

    const apply = async () => {
        if (!data || chosenCount === 0) return;
        const items: ApplyItem[] = [
            ...chosen.map((i) => ({ name: i.name, place: placeOf(i), quantity: i.quantity, detail: i.detail, category: i.category })),
            ...custom.map((c) => ({ name: c.name, place: c.place })),
        ];
        setApplying(true);
        setApplyError('');
        try {
            setResult(await applyMonthlyList(month, items));
            setCustom([]);
            await load(true);
        } catch {
            setApplyError(t('errors.apply'));
        } finally {
            setApplying(false);
        }
    };

    const addCustom = (e: React.FormEvent) => {
        e.preventDefault();
        const name = newName.trim();
        if (!name) return;
        setCustom((list) => [...list, { id: Date.now(), name, place: newPlace }]);
        setNewName('');
    };

    const row = (item: Suggestion) => {
        const checked = selected.has(item.key);
        const target = placeOf(item) === 'market' ? 'store' : 'market';
        return (
            <li key={item.key} className="flex items-center gap-2 py-2">
                <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    disabled={!canEdit}
                    onClick={() => toggle(item.key)}
                    className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left disabled:cursor-default"
                >
                    <span className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2',
                        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
                    )}>
                        {checked && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 text-caption font-medium text-foreground">
                        {item.name}
                        {item.quantity ? <span className="font-normal text-muted-foreground"> ×{item.quantity}</span> : null}
                        {item.detail ? <span className="font-normal text-muted-foreground"> ({item.detail})</span> : null}
                    </span>
                </button>
                {canEdit && (
                    <button
                        type="button"
                        onClick={() => move(item)}
                        className="shrink-0 rounded-input p-2 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                        aria-label={t('moveTo', { place: placeLabel(target) })}
                        title={t('moveTo', { place: placeLabel(target) })}
                    >
                        <ArrowLeftRight className="h-4 w-4" />
                    </button>
                )}
            </li>
        );
    };

    const placeSection = (place: Place) => {
        const items = visible.filter((i) => placeOf(i) === place);
        const extra = custom.filter((c) => c.place === place);
        if (items.length === 0 && extra.length === 0) return null;
        // Grouped by what was ticked at first, so a product does not jump
        // around when it is ticked or unticked.
        const usual = items.filter((i) => i.status === 'due');
        const others = items.filter((i) => i.status !== 'due');
        const count = items.filter((i) => selected.has(i.key)).length + extra.length;
        return (
            <Section
                key={place}
                title={placeLabel(place)}
                action={<span className="text-micro text-muted-foreground">{t('selectedCount', { count })}</span>}
            >
                <div className="space-y-3">
                    {(usual.length > 0 || extra.length > 0) && (
                        <ul className="divide-y divide-border">
                            {usual.map(row)}
                            {extra.map((c) => (
                                <li key={c.id} className="flex items-center gap-3 py-2">
                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-primary bg-primary text-primary-foreground">
                                        <Check className="h-3.5 w-3.5" />
                                    </span>
                                    <span className="min-w-0 flex-1 text-caption font-medium text-foreground">{c.name}</span>
                                    <button
                                        type="button"
                                        onClick={() => setCustom((list) => list.filter((x) => x.id !== c.id))}
                                        className="shrink-0 rounded-input p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                        aria-label={t('remove', { name: c.name })}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    {others.length > 0 && (
                        <div>
                            <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">{t('others')}</p>
                            <ul className="divide-y divide-border">{others.map(row)}</ul>
                        </div>
                    )}
                </div>
            </Section>
        );
    };

    const applyButton = (
        <Button onClick={() => void apply()} disabled={applying || chosenCount === 0} className="w-full whitespace-nowrap">
            {applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShoppingBasket className="mr-2 h-4 w-4" />}
            {t('apply', { count: chosenCount })}
        </Button>
    );

    const historyCard = data && (
        <HistoryCard
            history={data.history}
            open={showImport}
            onToggle={() => setShowImport((o) => !o)}
            onChanged={() => void load()}
            defaultMonth={shiftMonth(month, -1)}
        />
    );

    const hasItems = visible.length > 0;
    const showList = hasItems || custom.length > 0;
    // Everything suggested is already on the list (just applied, or added by hand).
    const allDone = !showList && (data?.items.length ?? 0) > 0;

    return (
        <div className="mx-auto max-w-2xl space-y-4">
            <Link to="/shopping" className="inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground">
                <ChevronLeft className="h-4 w-4" />
                {t('back')}
            </Link>
            <div>
                <h2 className="text-title font-bold text-foreground">{t('title')}</h2>
                <p className="text-caption text-muted-foreground">{t('subtitle')}</p>
            </div>

            <MonthPicker month={month} onChange={setMonth} max={shiftMonth(thisMonth(), 1)} />

            {result && (
                <div className="flex items-start gap-2 rounded-card bg-emerald-50 px-4 py-3 text-caption text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                    <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="flex-1">
                        {t('result.added', { count: result.added })}
                        {result.market > 0 && ` ${t('result.market', { count: result.market })}`}
                        {result.skipped > 0 && ` ${t('result.skipped', { count: result.skipped })}`}
                        {' '}
                        <Link to="/shopping" className="font-semibold underline">{t('result.open')}</Link>
                    </span>
                </div>
            )}

            {loading && !data ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : loadError ? (
                <p className="flex items-center gap-1 text-caption text-destructive"><AlertCircle className="h-4 w-4" />{t('errors.load')}</p>
            ) : data && (
                <>
                    {allDone ? (
                        <Section title={t('allDone.title')}>
                            <Empty>{t('allDone.text')}</Empty>
                        </Section>
                    ) : !showList ? (
                        <>
                            <Section title={t('empty.title')}>
                                <Empty>{t('empty.text')}</Empty>
                            </Section>
                            {canEdit && data.history.length === 0 && historyCard}
                        </>
                    ) : (
                        <>
                            {canEdit && (
                                <div className="space-y-2 rounded-card border border-border bg-card p-4 shadow-surface">
                                    <p className="text-caption text-foreground">
                                        {t('summary', { count: chosenCount })}
                                        {marketCount > 0 && <span className="text-muted-foreground"> · {t('summaryMarket', { count: marketCount })}</span>}
                                    </p>
                                    {applyButton}
                                    {applyError && <p className="flex items-center gap-1 text-micro text-destructive"><AlertCircle className="h-4 w-4" />{applyError}</p>}
                                </div>
                            )}
                            {placeSection('store')}
                            {placeSection('market')}
                        </>
                    )}

                    {canEdit && (
                        <form onSubmit={addCustom} className="space-y-2 rounded-card border border-border bg-card p-4 shadow-surface">
                            <label htmlFor="monthly-new" className="block text-caption font-semibold text-foreground">{t('addOther')}</label>
                            <div className="flex gap-2">
                                <input
                                    id="monthly-new"
                                    className="input-nexus min-w-0 flex-1 text-caption"
                                    value={newName}
                                    maxLength={120}
                                    placeholder={t('addPlaceholder')}
                                    onChange={(e) => setNewName(e.target.value)}
                                />
                                <Button type="submit" size="icon" aria-label={t('addOther')} disabled={!newName.trim()}>
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </div>
                            <div className="flex gap-2" role="radiogroup" aria-label={t('where')}>
                                {(['store', 'market'] as Place[]).map((p) => (
                                    <button
                                        key={p}
                                        type="button"
                                        role="radio"
                                        aria-checked={newPlace === p}
                                        onClick={() => setNewPlace(p)}
                                        className={cn(
                                            'flex items-center gap-1 rounded-pill border px-3 py-1 text-micro font-medium',
                                            newPlace === p ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted-foreground'
                                        )}
                                    >
                                        {p === 'store' ? <Store className="h-3.5 w-3.5" /> : <ShoppingBasket className="h-3.5 w-3.5" />}
                                        {placeLabel(p)}
                                    </button>
                                ))}
                            </div>
                        </form>
                    )}

                    {canEdit && showList && chosenCount > 0 && applyButton}

                    {canEdit && (showList || data.history.length > 0) && historyCard}
                </>
            )}
        </div>
    );
};

/** Older lists: paste them once (notes, WhatsApp), see and remove imported months. */
const HistoryCard: React.FC<{
    history: Array<{ month: string; count: number }>;
    open: boolean;
    onToggle: () => void;
    onChanged: () => void;
    defaultMonth: string;
}> = ({ history, open, onToggle, onChanged, defaultMonth }) => {
    const { t } = useTranslation('monthlyList');
    const [text, setText] = useState('');
    const [month, setMonth] = useState(defaultMonth);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState('');
    const [confirming, setConfirming] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        setDone('');
        try {
            const result = await importLists(text, month);
            setDone(t('import.done', {
                months: result.months.map((m) => t('import.monthCount', { month: monthLabel(m.month), count: m.count })).join(', '),
            }));
            setText('');
            onChanged();
        } catch (err) {
            const code = err instanceof Error ? err.message : '';
            setError(['missing_month', 'no_items', 'too_long'].includes(code) ? t(`import.errors.${code}`) : t('errors.generic'));
        } finally {
            setBusy(false);
        }
    };

    const remove = async (m: string) => {
        setBusy(true);
        try {
            await deleteListMonth(m);
            setConfirming(null);
            onChanged();
        } catch {
            setError(t('errors.generic'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="rounded-card border border-border bg-card p-4 shadow-surface">
            <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-2 text-left" aria-expanded={open}>
                <span className="flex items-center gap-2 text-caption font-semibold text-foreground">
                    <ClipboardList className="h-4 w-4 text-primary" />
                    {t('import.title')}
                </span>
                {history.length > 0 && <span className="text-micro text-muted-foreground">{t('import.monthsCount', { count: history.length })}</span>}
            </button>

            {open && (
                <div className="mt-3 space-y-4">
                    {history.length > 0 && (
                        <ul className="divide-y divide-border">
                            {history.map((h) => (
                                <li key={h.month} className="flex items-center justify-between gap-2 py-1.5 text-caption">
                                    <span className="capitalize text-foreground">{monthLabel(h.month)}</span>
                                    <span className="flex items-center gap-2">
                                        <span className="text-micro text-muted-foreground">{t('import.items', { count: h.count })}</span>
                                        {confirming === h.month ? (
                                            <>
                                                <button type="button" disabled={busy} onClick={() => void remove(h.month)} className="rounded-input px-2 py-1 text-micro font-semibold text-destructive hover:bg-destructive/10">
                                                    {t('import.confirmDelete')}
                                                </button>
                                                <button type="button" onClick={() => setConfirming(null)} className="rounded-input px-2 py-1 text-micro text-muted-foreground hover:bg-surface-2">
                                                    {t('import.cancel')}
                                                </button>
                                            </>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => setConfirming(h.month)}
                                                className="rounded-input p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                                aria-label={t('import.delete', { month: monthLabel(h.month) })}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        )}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}

                    <form onSubmit={submit} className="space-y-3">
                        <p className="text-micro text-muted-foreground">{t('import.hint')}</p>
                        <Textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            rows={8}
                            aria-label={t('import.textLabel')}
                            placeholder={t('import.placeholder')}
                            className="text-caption"
                        />
                        <div>
                            <label htmlFor="import-month" className="mb-1 block text-micro text-muted-foreground">{t('import.monthLabel')}</label>
                            <input id="import-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="input-nexus w-full text-caption" />
                        </div>
                        {error && <p className="flex items-center gap-1 text-micro text-destructive"><AlertCircle className="h-4 w-4 shrink-0" />{error}</p>}
                        {done && <p className="flex items-start gap-1 text-micro text-emerald-700 dark:text-emerald-400"><CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />{done}</p>}
                        <Button type="submit" variant="secondary" disabled={busy || !text.trim()} className="whitespace-nowrap">
                            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {t('import.submit')}
                        </Button>
                    </form>
                </div>
            )}
        </section>
    );
};

export default MonthlyList;
