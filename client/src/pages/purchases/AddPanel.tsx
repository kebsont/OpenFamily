import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Camera, CheckCircle, Loader2, ShoppingBag, Zap } from 'lucide-react';
import { Button, Input } from '../../components/ui';
import { useCategories } from '../../hooks/useCategories';
import {
    createPurchase,
    prepareReceiptImage,
    scanReceipt,
    todayIso,
    type PurchaseInput,
} from '../../lib/purchases';
import { ReceiptEditor, tidyStore, type ReceiptValues } from './ReceiptEditor';
import { NativeSelect } from './ui';

type Mode = 'menu' | 'scanning' | 'review' | 'electricity' | 'quick';

/** Shops offered for a small expense; anything else is typed. */
const QUICK_STORES = ['Boutique', 'Marché', 'Quincaillerie', 'Auchan'];

const AI_ERRORS = ['AI_NOT_CONFIGURED', 'AI_DISABLED', 'AI_UNAUTHORIZED', 'AI_MODEL_NOT_FOUND', 'AI_UNREACHABLE', 'AI_INVALID_RESPONSE', 'AI_PROVIDER_ERROR', 'invalid_images'];
const SAVE_ERRORS = ['invalid_kind', 'missing_store', 'invalid_date', 'invalid_total', 'invalid_kwh', 'invalid_category'];

const amount = (value: string): number => Number(value.replace(/\s/g, '').replace(',', '.'));

export const AddPanel: React.FC<{ initialMode?: 'scan' | 'electricity' | 'quick'; onSaved: () => void }> = ({ initialMode, onSaved }) => {
    const { t } = useTranslation(['purchases', 'budget']);
    const { categories } = useCategories();
    const fileRef = useRef<HTMLInputElement>(null);
    const [mode, setMode] = useState<Mode>(initialMode === 'electricity' || initialMode === 'quick' ? initialMode : 'menu');
    const [draft, setDraft] = useState<ReceiptValues | null>(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [done, setDone] = useState('');

    // Electricity and small-expense forms.
    const [date, setDate] = useState(todayIso());
    const [total, setTotal] = useState('');
    const [kwh, setKwh] = useState('');
    const [store, setStore] = useState('Boutique');
    const [otherStore, setOtherStore] = useState('');
    const [what, setWhat] = useState('');

    const budget = categories.budget;
    const pick = (...wanted: string[]) => wanted.find((c) => budget.includes(c)) ?? budget[budget.length - 1] ?? 'Autre';
    const [category, setCategory] = useState('');
    const defaultCategory = (m: Mode, shop = store) =>
        m === 'electricity' ? pick('Logement', 'Maison', 'Autre') : shop === 'Quincaillerie' ? pick('Maison', 'Autre') : pick('Alimentation', 'Autre');
    const effectiveCategory = category && budget.includes(category) ? category : defaultCategory(mode);
    const budgetOptions = budget.map((c) => ({ value: c, label: t(`budget:categories.${c}`, { defaultValue: c }) }));

    const errorText = (err: unknown, known: string[]) => {
        const code = err instanceof Error ? err.message : '';
        return known.includes(code) ? t(`errors.${code}`) : t('errors.generic');
    };

    const reset = (message = '') => {
        setMode('menu');
        setDraft(null);
        setError('');
        setTotal('');
        setKwh('');
        setWhat('');
        setOtherStore('');
        setCategory('');
        setDate(todayIso());
        setDone(message);
    };

    const save = async (input: PurchaseInput, message: string) => {
        setSaving(true);
        setError('');
        try {
            await createPurchase(input);
            reset(message);
            onSaved();
        } catch (err) {
            setError(errorText(err, SAVE_ERRORS));
        } finally {
            setSaving(false);
        }
    };

    const onPhotos = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        setDone('');
        setError('');
        setMode('scanning');
        try {
            const images = await Promise.all(Array.from(files).slice(0, 3).map(prepareReceiptImage));
            const result = await scanReceipt(images);
            setDraft({
                store: tidyStore(result.store) || 'Auchan',
                purchased_on: result.purchased_on || todayIso(),
                total: result.total,
                category: pick('Alimentation', 'Autre'),
                items: result.items,
            });
            setMode('review');
        } catch (err) {
            setError(err instanceof Error && err.message === 'image' ? t('errors.photo') : errorText(err, AI_ERRORS));
            setMode('menu');
        } finally {
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    const actionCard = (icon: React.ReactNode, title: string, hint: string, onClick: () => void) => (
        <button
            type="button"
            onClick={onClick}
            className="flex w-full items-center gap-3 rounded-card border border-border bg-card p-4 text-left shadow-surface transition-colors hover:bg-surface-2"
        >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card bg-primary-soft text-primary">{icon}</span>
            <span className="min-w-0">
                <span className="block text-caption font-semibold text-foreground">{title}</span>
                <span className="block text-micro text-muted-foreground">{hint}</span>
            </span>
        </button>
    );

    const formShell = (title: string, children: React.ReactNode, onSubmit: (e: React.FormEvent) => void) => (
        <form onSubmit={onSubmit} className="space-y-3 rounded-card border border-border bg-card p-4 shadow-surface">
            <h3 className="text-caption font-semibold text-foreground">{title}</h3>
            {children}
            {error && (
                <p className="flex items-center gap-1 text-micro text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />{error}
                </p>
            )}
            <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={saving} className="whitespace-nowrap">
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t('actions.save')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => reset()} className="whitespace-nowrap">{t('actions.cancel')}</Button>
            </div>
        </form>
    );

    return (
        <div className="space-y-3">
            {done && (
                <p className="flex items-center gap-2 rounded-input bg-emerald-50 px-3 py-2 text-micro text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                    <CheckCircle className="h-4 w-4 shrink-0" />{done}
                </p>
            )}

            <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => void onPhotos(e.target.files)}
            />

            {mode === 'menu' && (
                <>
                    {error && (
                        <p className="flex items-start gap-2 rounded-input bg-destructive/10 px-3 py-2 text-micro text-destructive">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}
                        </p>
                    )}
                    {actionCard(<Camera className="h-5 w-5" />, t('add.scanTitle'), t('add.scanHint'), () => fileRef.current?.click())}
                    {actionCard(<Zap className="h-5 w-5" />, t('add.electricityTitle'), t('add.electricityHint'), () => { setDone(''); setMode('electricity'); })}
                    {actionCard(<ShoppingBag className="h-5 w-5" />, t('add.quickTitle'), t('add.quickHint'), () => { setDone(''); setMode('quick'); })}
                </>
            )}

            {mode === 'scanning' && (
                <div className="flex flex-col items-center gap-3 rounded-card border border-border bg-card p-8 text-center shadow-surface">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-caption font-medium text-foreground">{t('add.reading')}</p>
                    <p className="text-micro text-muted-foreground">{t('add.readingHint')}</p>
                </div>
            )}

            {mode === 'review' && draft && (
                <div className="rounded-card border border-border bg-card p-4 shadow-surface">
                    <h3 className="mb-3 text-caption font-semibold text-foreground">{t('editor.title')}</h3>
                    <ReceiptEditor
                        initial={draft}
                        saving={saving}
                        error={error}
                        onSave={(input) => void save(input, t('add.savedReceipt'))}
                        onCancel={() => reset()}
                    />
                </div>
            )}

            {mode === 'electricity' && formShell(t('add.electricityTitle'), (
                <div className="grid grid-cols-2 gap-3">
                    <Input label={t('fields.amount')} id="elec-amount" inputMode="decimal" value={total} required
                        placeholder="5000" onChange={(e) => setTotal(e.target.value)} />
                    <Input label={t('fields.kwh')} id="elec-kwh" inputMode="decimal" value={kwh}
                        placeholder="40" onChange={(e) => setKwh(e.target.value)} />
                    <Input label={t('fields.date')} id="elec-date" type="date" value={date} required
                        onChange={(e) => setDate(e.target.value)} />
                    <NativeSelect label={t('fields.budgetCategory')} id="elec-category" value={effectiveCategory}
                        onChange={setCategory} options={budgetOptions} />
                    <p className="col-span-2 text-micro text-muted-foreground">{t('add.kwhHint')}</p>
                </div>
            ), (e) => {
                e.preventDefault();
                void save({
                    kind: 'electricity', store: 'Woyofal', purchased_on: date, total: amount(total),
                    kwh: kwh.trim() ? amount(kwh) : null, category: effectiveCategory,
                }, t('add.savedElectricity'));
            })}

            {mode === 'quick' && formShell(t('add.quickTitle'), (
                <div className="space-y-3">
                    <div>
                        <p className="mb-1.5 text-caption font-medium text-foreground">{t('fields.where')}</p>
                        <div className="flex flex-wrap gap-2">
                            {[...QUICK_STORES, ''].map((s) => (
                                <button
                                    key={s || 'other'}
                                    type="button"
                                    onClick={() => setStore(s)}
                                    className={`rounded-full border px-3 py-1.5 text-micro font-medium ${store === s
                                        ? 'border-primary bg-primary-soft text-primary'
                                        : 'border-border bg-card text-foreground hover:bg-surface-2'}`}
                                >
                                    {s ? t(`stores.${s}`, { defaultValue: s }) : t('stores.other')}
                                </button>
                            ))}
                        </div>
                        {store === '' && (
                            <Input className="mt-2" id="quick-other" placeholder={t('fields.otherStore')} value={otherStore}
                                maxLength={60} required onChange={(e) => setOtherStore(e.target.value)} />
                        )}
                    </div>
                    <Input label={t('fields.what')} id="quick-what" placeholder={t('fields.whatPlaceholder')} value={what}
                        maxLength={300} onChange={(e) => setWhat(e.target.value)} />
                    <div className="grid grid-cols-2 gap-3">
                        <Input label={t('fields.amount')} id="quick-amount" inputMode="decimal" value={total} required
                            onChange={(e) => setTotal(e.target.value)} />
                        <Input label={t('fields.date')} id="quick-date" type="date" value={date} required
                            onChange={(e) => setDate(e.target.value)} />
                    </div>
                    <NativeSelect label={t('fields.budgetCategory')} id="quick-category"
                        value={category && budget.includes(category) ? category : defaultCategory('quick', store)}
                        onChange={setCategory} options={budgetOptions} />
                </div>
            ), (e) => {
                e.preventDefault();
                void save({
                    kind: 'quick', store: store || otherStore.trim(), purchased_on: date, total: amount(total),
                    note: what.trim() || null,
                    category: category && budget.includes(category) ? category : defaultCategory('quick', store),
                }, t('add.savedQuick'));
            })}
        </div>
    );
};
