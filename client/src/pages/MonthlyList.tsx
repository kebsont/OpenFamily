import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, CheckCircle, ClipboardList, Loader2, Plus, Trash2, X } from 'lucide-react';
import { Button, Textarea } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useWebSocketUpdates } from '../hooks/useWebSocketUpdates';
import { api } from '../lib/api';
import {
    addLines,
    deleteItem,
    deleteListMonth,
    getMonth,
    getSuggestions,
    importLists,
    lineText,
    updateItem,
    type ListItem,
    type MonthList,
    type Suggestion,
} from '../lib/monthlyList';
import { shiftMonth, thisMonth } from '../lib/purchases';
import { cn } from '../lib/utils';
import { intlLocale } from '../i18n/format';
import { MonthPicker, monthLabel } from './purchases/ui';
import { ShoppingTabs } from './ShoppingTabs';

/** A line of the general shopping list (recipes, menus…), shown under the note. */
interface GeneralItem {
    id: string;
    name: string;
    quantity?: number | null;
    is_checked: boolean;
}

const monthName = (month: string) => {
    const [y, m] = month.split('-').map(Number);
    return new Intl.DateTimeFormat(intlLocale(), { month: 'long' }).format(new Date(y, m - 1, 1));
};

/**
 * The shopping list of the month, written like a note: one product per line,
 * Enter for the next one, ticked in the shop. Earlier months stay as they
 * were (the arrows go back through them). For the current month, the usual
 * products are one tap away.
 */
const MonthlyList: React.FC = () => {
    const { t } = useTranslation('monthlyList');
    const { user } = useAuth();
    const canEdit = Boolean(user?.is_owner) || (user?.role ?? '').toLowerCase() !== 'enfant';
    const current = thisMonth();

    const [month, setMonth] = useState(current);
    const [list, setList] = useState<MonthList | null>(null);
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [general, setGeneral] = useState<GeneralItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [error, setError] = useState('');
    const [draft, setDraft] = useState('');
    const [adding, setAdding] = useState(false);
    const [editing, setEditing] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [showMore, setShowMore] = useState(false);
    const [showImport, setShowImport] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const upcoming = month >= current;

    const loadSuggestions = useCallback(async () => {
        if (month < thisMonth()) {
            setSuggestions([]);
            return;
        }
        try {
            setSuggestions((await getSuggestions(month)).items);
        } catch {
            setSuggestions([]);
        }
    }, [month]);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadFailed(false);
        try {
            const [next, others] = await Promise.all([
                getMonth(month),
                month === thisMonth()
                    ? api.get<{ success: boolean; data: GeneralItem[] }>('/api/shopping').then((r) => r.data).catch(() => [])
                    : Promise.resolve([] as GeneralItem[]),
            ]);
            setList(next);
            setGeneral(others.filter((i) => !i.is_checked));
            setShowImport((open) => open || next.history.length === 0);
        } catch {
            setLoadFailed(true);
        } finally {
            setLoading(false);
        }
        void loadSuggestions();
    }, [month, loadSuggestions]);

    useEffect(() => {
        setEditing(null);
        setShowMore(false);
        void load();
    }, [load]);

    // Another phone of the household ticked or added something.
    useWebSocketUpdates('shopping', () => {
        if (!editing) void load();
    });

    const items = list?.items ?? [];
    const done = items.filter((i) => i.checked).length;

    const add = async (text: string) => {
        if (!text.trim()) return;
        setAdding(true);
        setError('');
        try {
            const next = await addLines(month, text);
            setList((l) => (l ? { ...l, items: next } : l));
            setDraft('');
            void loadSuggestions();
        } catch {
            setError(t('errors.save'));
        } finally {
            setAdding(false);
            inputRef.current?.focus();
        }
    };

    const onDraftKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Enter adds the line and keeps the keyboard open, like a note.
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void add(draft);
        }
    };

    const onDraftChange = (value: string) => {
        // Several lines pasted at once (from Notes, WhatsApp): all added.
        if (value.includes('\n')) void add(value);
        else setDraft(value);
    };

    const replaceItem = (item: ListItem) =>
        setList((l) => (l ? { ...l, items: l.items.map((i) => (i.id === item.id ? item : i)) } : l));

    const toggle = async (item: ListItem) => {
        replaceItem({ ...item, checked: !item.checked });
        try {
            await updateItem(item.id, { checked: !item.checked });
        } catch {
            replaceItem(item);
            setError(t('errors.save'));
        }
    };

    const remove = async (item: ListItem) => {
        setList((l) => (l ? { ...l, items: l.items.filter((i) => i.id !== item.id) } : l));
        try {
            await deleteItem(item.id);
            void loadSuggestions();
        } catch {
            void load();
            setError(t('errors.save'));
        }
    };

    const startEdit = (item: ListItem) => {
        if (!canEdit) return;
        setEditing(item.id);
        setEditText(lineText(item));
    };

    const saveEdit = async (item: ListItem) => {
        const text = editText.trim();
        setEditing(null);
        if (!text || text === lineText(item)) return;
        try {
            replaceItem(await updateItem(item.id, { text }));
        } catch (err) {
            setError(err instanceof Error && err.message === 'duplicate' ? t('errors.duplicate', { name: text }) : t('errors.save'));
        }
    };

    const toggleGeneral = async (item: GeneralItem) => {
        setGeneral((list) => list.filter((i) => i.id !== item.id));
        try {
            await api.put(`/api/shopping/${item.id}`, { is_checked: true });
        } catch {
            void load();
        }
    };

    const removeGeneral = async (item: GeneralItem) => {
        setGeneral((list) => list.filter((i) => i.id !== item.id));
        try {
            await api.delete(`/api/shopping/${item.id}`);
        } catch {
            void load();
        }
    };

    const usual = suggestions.filter((s) => s.status === 'due');
    const others = suggestions.filter((s) => s.status === 'not_yet' || s.status === 'occasional');
    const chip = (s: Suggestion) => (
        <button
            key={s.key}
            type="button"
            disabled={adding}
            onClick={() => void add(lineText(s))}
            className="flex items-center gap-1 rounded-pill border border-border bg-card px-3 py-1.5 text-caption text-foreground transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary"
        >
            <Plus className="h-3.5 w-3.5" />
            {s.name}
        </button>
    );

    const line = (item: ListItem) => (
        <li key={item.id} className="flex items-center gap-3 py-2">
            <button
                type="button"
                role="checkbox"
                aria-checked={item.checked}
                aria-label={item.name}
                disabled={!canEdit}
                onClick={() => void toggle(item)}
                className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                    item.checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
                )}
            >
                {item.checked && <Check className="h-3.5 w-3.5" />}
            </button>
            {editing === item.id ? (
                <input
                    autoFocus
                    className="input-nexus min-w-0 flex-1 py-1 text-body"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onBlur={() => void saveEdit(item)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') setEditing(null);
                    }}
                    aria-label={t('edit', { name: item.name })}
                />
            ) : (
                <button
                    type="button"
                    onClick={() => startEdit(item)}
                    className={cn(
                        'min-w-0 flex-1 text-left text-body',
                        item.checked ? 'text-muted-foreground line-through' : 'text-foreground'
                    )}
                >
                    {lineText(item)}
                </button>
            )}
            {canEdit && editing !== item.id && (
                <button
                    type="button"
                    onClick={() => void remove(item)}
                    className="shrink-0 rounded-input p-1.5 text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
                    aria-label={t('remove', { name: item.name })}
                >
                    <X className="h-4 w-4" />
                </button>
            )}
        </li>
    );

    return (
        <div className="mx-auto max-w-2xl space-y-4">
            <ShoppingTabs active="month" />

            <MonthPicker month={month} onChange={setMonth} max={shiftMonth(current, 1)} />
            {items.length > 0 && <p className="-mt-2 text-right text-caption text-muted-foreground">{t('progress', { done, total: items.length })}</p>}

            {error && (
                <p className="flex items-center gap-1 text-caption text-destructive" role="alert">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {error}
                </p>
            )}

            {loading && !list ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : loadFailed || !list ? (
                <p className="flex items-center gap-1 text-caption text-destructive"><AlertCircle className="h-4 w-4" />{t('errors.load')}</p>
            ) : (
                <>
                    {canEdit && upcoming && items.length === 0 && usual.length > 0 && (
                        <div className="space-y-3 rounded-card border border-primary/30 bg-primary-soft p-4">
                            <p className="text-caption text-foreground">{t('usual.startHint')}</p>
                            <Button onClick={() => void add(usual.map(lineText).join('\n'))} disabled={adding} className="w-full whitespace-nowrap">
                                {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                                {t('usual.start', { count: usual.length })}
                            </Button>
                        </div>
                    )}

                    <section className="rounded-card border border-border bg-card px-4 py-2 shadow-surface">
                        {items.length > 0 ? (
                            <ul className="divide-y divide-border">{items.map(line)}</ul>
                        ) : (
                            <p className="py-3 text-caption text-muted-foreground">{t('emptyNote', { month: monthName(month) })}</p>
                        )}
                        {canEdit && (
                            <div className="flex items-start gap-3 border-t border-border py-2">
                                <span className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center text-muted-foreground">
                                    {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                </span>
                                <textarea
                                    ref={inputRef}
                                    rows={1}
                                    value={draft}
                                    onChange={(e) => onDraftChange(e.target.value)}
                                    onKeyDown={onDraftKey}
                                    placeholder={t('addPlaceholder')}
                                    aria-label={t('addPlaceholder')}
                                    enterKeyHint="enter"
                                    autoCapitalize="sentences"
                                    className="min-h-9 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-body text-foreground outline-none placeholder:text-muted-foreground"
                                />
                            </div>
                        )}
                    </section>
                    {canEdit && items.length === 0 && <p className="text-micro text-muted-foreground">{t('addHint')}</p>}

                    {canEdit && upcoming && (usual.length > 0 || others.length > 0) && !(items.length === 0 && usual.length > 0) && (
                        <section className="space-y-3 rounded-card border border-border bg-card p-4 shadow-surface">
                            <div className="flex items-center justify-between gap-2">
                                <h3 className="text-caption font-semibold text-foreground">{t('usual.title')}</h3>
                                {usual.length > 1 && (
                                    <button type="button" disabled={adding} onClick={() => void add(usual.map(lineText).join('\n'))} className="text-caption font-semibold text-primary">
                                        {t('usual.addAll', { count: usual.length })}
                                    </button>
                                )}
                            </div>
                            {usual.length > 0 && <div className="flex flex-wrap gap-2">{usual.map(chip)}</div>}
                            {others.length > 0 && (
                                <>
                                    <button type="button" onClick={() => setShowMore((v) => !v)} className="text-caption text-muted-foreground underline">
                                        {showMore ? t('usual.less') : t('usual.more')}
                                    </button>
                                    {showMore && <div className="flex flex-wrap gap-2">{others.map(chip)}</div>}
                                </>
                            )}
                        </section>
                    )}

                    {general.length > 0 && (
                        <section className="rounded-card border border-border bg-card px-4 py-3 shadow-surface">
                            <h3 className="mb-1 text-caption font-semibold text-foreground">{t('extra.title')}</h3>
                            <ul className="divide-y divide-border">
                                {general.map((item) => (
                                    <li key={item.id} className="flex items-center gap-3 py-2">
                                        <button
                                            type="button"
                                            role="checkbox"
                                            aria-checked={false}
                                            aria-label={item.name}
                                            disabled={!canEdit}
                                            onClick={() => void toggleGeneral(item)}
                                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-input"
                                        />
                                        <span className="min-w-0 flex-1 text-body text-foreground">
                                            {item.name}{item.quantity ? ` ${Number(item.quantity)}` : ''}
                                        </span>
                                        {canEdit && (
                                            <button
                                                type="button"
                                                onClick={() => void removeGeneral(item)}
                                                className="shrink-0 rounded-input p-1.5 text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
                                                aria-label={t('remove', { name: item.name })}
                                            >
                                                <X className="h-4 w-4" />
                                            </button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    {canEdit && (
                        <HistoryCard
                            history={list.history}
                            open={showImport}
                            onToggle={() => setShowImport((o) => !o)}
                            onChanged={() => void load()}
                            defaultMonth={shiftMonth(current, -1)}
                        />
                    )}

                    <Link to="/shopping/all" className="block text-center text-caption text-muted-foreground underline">
                        {t('detailed')}
                    </Link>
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
