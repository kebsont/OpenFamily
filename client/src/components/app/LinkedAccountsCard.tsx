import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, Home, Link2, Loader2, Pencil, Plus, Repeat, X } from 'lucide-react';
import { Card, CardContent, Button, Input } from '../ui';
import {
    createHousehold,
    householdName,
    linkAccount,
    renameHousehold,
    switchToAccount,
    unlinkAccount,
    type LinkedAccount,
} from '../../lib/households';
import { useLinkedAccounts } from '../../hooks/useLinkedAccounts';

const KNOWN_ERRORS = [
    'invalid_credentials', 'cannot_link_self', 'too_many_attempts', 'invalid_label', 'missing_fields',
    'missing_label', 'too_many_households', 'managed_household', 'has_managed',
];

type Form = 'none' | 'create' | 'link';

/**
 * Settings card: the households one person runs from a single login. Create a
 * household (it opens right away), name each one, switch, and, for someone who
 * already has a separate account per household, link those accounts. Each
 * household stays a separate family: its members never see the others.
 */
export const LinkedAccountsCard: React.FC = () => {
    const { t } = useTranslation('households');
    const { accounts, current, others } = useLinkedAccounts();
    const linked = accounts.length > 1;
    // Households run from one login all show the same e-mail: only list
    // e-mails when they actually tell the households apart.
    const showEmails = new Set(accounts.map((a) => a.email)).size > 1;

    const [form, setForm] = useState<Form>('none');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [label, setLabel] = useState('');
    const [currentLabel, setCurrentLabel] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const [editing, setEditing] = useState<string | null>(null);
    const [draft, setDraft] = useState('');

    // Coming from the header menu ("Manage"): bring this card into view.
    useEffect(() => {
        if (window.location.hash === '#households') {
            document.getElementById('households')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, []);

    const nameOf = (account: LinkedAccount) => householdName(account, (name) => t('familyOf', { name }));

    const errorText = (err: unknown) => {
        const code = err instanceof Error ? err.message : '';
        return KNOWN_ERRORS.includes(code) ? t(`errors.${code}`) : t('errors.generic');
    };

    const openForm = (next: Form) => {
        setForm(next);
        setError('');
        setPassword('');
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSubmitting(true);
        try {
            const { created } = await createHousehold({
                label: label.trim(),
                currentLabel: currentLabel.trim() || undefined,
            });
            await switchToAccount(created); // opens the new household (reloads)
        } catch (err) {
            setError(errorText(err));
            setSubmitting(false);
        }
    };

    const handleLink = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSubmitting(true);
        try {
            await linkAccount({
                email: email.trim(),
                password,
                label: label.trim() || undefined,
                currentLabel: currentLabel.trim() || undefined,
            });
            setEmail('');
            setLabel('');
            setCurrentLabel('');
            setForm('none');
        } catch (err) {
            setError(errorText(err));
        } finally {
            setPassword('');
            setSubmitting(false);
        }
    };

    const startEditing = (account: LinkedAccount) => {
        setEditing(account.id);
        setDraft(account.label ?? '');
        setError('');
    };

    const saveLabel = async (account: LinkedAccount) => {
        setBusy(account.id);
        setError('');
        try {
            await renameHousehold(account.id, draft.trim());
            setEditing(null);
        } catch (err) {
            setError(errorText(err));
        } finally {
            setBusy(null);
        }
    };

    const handleUnlink = async (account: LinkedAccount) => {
        if (!window.confirm(t('unlinkConfirm', { name: nameOf(account) }))) return;
        setBusy(account.id);
        setError('');
        try {
            await unlinkAccount(account.id);
        } catch (err) {
            setError(errorText(err));
        } finally {
            setBusy(null);
        }
    };

    const handleSwitch = async (account: LinkedAccount) => {
        setBusy(account.id);
        setError('');
        try {
            await switchToAccount(account.id); // reloads on success
        } catch {
            setError(t('switchError'));
            setBusy(null);
        }
    };

    const renderRow = (account: LinkedAccount) => {
        const isEditing = editing === account.id;
        return (
            <li key={account.id} className="rounded-input border border-border bg-card px-3 py-2.5">
                {isEditing ? (
                    <form
                        className="flex items-center gap-2"
                        onSubmit={(e) => {
                            e.preventDefault();
                            void saveLabel(account);
                        }}
                    >
                        <Input
                            autoFocus
                            value={draft}
                            maxLength={60}
                            placeholder={t('labelPlaceholder')}
                            aria-label={t('labelField')}
                            onChange={(e) => setDraft(e.target.value)}
                        />
                        <Button type="submit" size="icon" variant="secondary" aria-label={t('save')} disabled={busy !== null}>
                            {busy === account.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        </Button>
                        <Button type="button" size="icon" variant="ghost" aria-label={t('cancel')} onClick={() => setEditing(null)}>
                            <X className="h-4 w-4" />
                        </Button>
                    </form>
                ) : (
                    <>
                        <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                                <p className="flex items-center gap-2 text-caption font-medium text-foreground">
                                    <span className="truncate">{nameOf(account)}</span>
                                    {account.is_current && (
                                        <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary">
                                            {t('current')}
                                        </span>
                                    )}
                                </p>
                                {showEmails && <p className="truncate text-micro text-muted-foreground">{account.email}</p>}
                            </div>
                            <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                aria-label={t('rename')}
                                title={t('rename')}
                                disabled={busy !== null}
                                onClick={() => startEditing(account)}
                                className="-mr-1 -mt-1 shrink-0"
                            >
                                <Pencil className="h-4 w-4" />
                            </Button>
                        </div>
                        {!account.is_current && (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    disabled={busy !== null}
                                    onClick={() => void handleSwitch(account)}
                                >
                                    {busy === account.id ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                        <Repeat className="mr-2 h-4 w-4" />
                                    )}
                                    {t('switch')}
                                </Button>
                                {/* A household created here has no login of its own: it cannot be unlinked. */}
                                {!account.managed && (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        disabled={busy !== null}
                                        onClick={() => void handleUnlink(account)}
                                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    >
                                        {t('unlink')}
                                    </Button>
                                )}
                            </div>
                        )}
                    </>
                )}
            </li>
        );
    };

    // Asked once, the first time: the name the switcher will show for this household.
    const currentLabelInput = !current?.label && (
        <Input
            label={t('currentLabelField')}
            id="household-current-label"
            placeholder={t('labelPlaceholder')}
            maxLength={60}
            value={currentLabel}
            onChange={(e) => setCurrentLabel(e.target.value)}
        />
    );

    const formButtons = (submitLabel: string, icon: React.ReactNode) => (
        <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={submitting} className="whitespace-nowrap">
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : icon}
                {submitLabel}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => openForm('none')} className="whitespace-nowrap">
                {t('cancel')}
            </Button>
        </div>
    );

    return (
        <Card>
            <CardContent className="p-6">
                <div id="households" className="flex scroll-mt-24 items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-primary-soft text-primary">
                        <Home className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h3 className="text-caption font-semibold text-foreground">{t('title')}</h3>
                        <p className="mt-1 text-micro text-muted-foreground">{t('subtitle')}</p>

                        {error && (
                            <p className="mt-3 flex items-center gap-1 text-micro text-destructive">
                                <AlertCircle className="h-4 w-4 shrink-0" />
                                {error}
                            </p>
                        )}

                        {linked && current && (
                            <ul className="mt-4 space-y-2">
                                {renderRow(current)}
                                {others.map(renderRow)}
                            </ul>
                        )}

                        {form === 'create' && (
                            <form onSubmit={(e) => void handleCreate(e)} className="mt-4 space-y-3 rounded-input border border-border bg-surface-2/60 p-4">
                                <p className="text-micro text-muted-foreground">{t('createHelp')}</p>
                                <Input
                                    autoFocus
                                    label={t('newLabelField')}
                                    id="household-new-label"
                                    placeholder={t('newLabelPlaceholder')}
                                    maxLength={60}
                                    value={label}
                                    onChange={(e) => setLabel(e.target.value)}
                                    required
                                />
                                {currentLabelInput}
                                {formButtons(t('createSubmit'), <Plus className="mr-2 h-4 w-4" />)}
                            </form>
                        )}

                        {form === 'link' && (
                            <form onSubmit={(e) => void handleLink(e)} className="mt-4 space-y-3 rounded-input border border-border bg-surface-2/60 p-4">
                                <p className="text-micro text-muted-foreground">{t('linkHelp')}</p>
                                <Input
                                    type="email"
                                    autoComplete="off"
                                    label={t('emailField')}
                                    id="household-link-email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                />
                                <Input
                                    type="password"
                                    autoComplete="off"
                                    label={t('passwordField')}
                                    id="household-link-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                />
                                <Input
                                    label={t('otherLabelField')}
                                    id="household-link-label"
                                    placeholder={t('labelPlaceholder')}
                                    maxLength={60}
                                    value={label}
                                    onChange={(e) => setLabel(e.target.value)}
                                />
                                {currentLabelInput}
                                {formButtons(t('link'), <Link2 className="mr-2 h-4 w-4" />)}
                            </form>
                        )}

                        {form === 'none' && (
                            <div className="mt-4 space-y-3">
                                <Button type="button" size="sm" variant="secondary" onClick={() => openForm('create')}>
                                    <Plus className="mr-2 h-4 w-4" />
                                    {t('create')}
                                </Button>
                                <p className="text-micro text-muted-foreground">
                                    {t('linkExistingPrompt')}{' '}
                                    <button
                                        type="button"
                                        onClick={() => openForm('link')}
                                        className="font-medium text-primary hover:text-primary/80"
                                    >
                                        {t('linkExisting')}
                                    </button>
                                </p>
                            </div>
                        )}

                        <p className="mt-4 text-micro text-muted-foreground">{t('privacyNote')}</p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};
