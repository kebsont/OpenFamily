import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Home, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { householdName, switchToAccount, type LinkedAccount } from '../../lib/households';
import { useLinkedAccounts } from '../../hooks/useLinkedAccounts';

/**
 * Header pill showing which household is open, with a menu to switch to the
 * other ones. Renders nothing for anyone without linked accounts, so the app
 * looks exactly as before for every other member of the family.
 */
export const HouseholdSwitcher: React.FC<{ className?: string }> = ({ className }) => {
    const { t } = useTranslation('households');
    const { accounts, current, others } = useLinkedAccounts();
    const [open, setOpen] = useState(false);
    const [switching, setSwitching] = useState<string | null>(null);
    const [error, setError] = useState('');
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    if (accounts.length < 2 || !current) return null;

    const nameOf = (account: LinkedAccount) =>
        householdName(account, (name) => t('familyOf', { name }));

    const unreadElsewhere = others.reduce((sum, a) => sum + (a.unread_count || 0), 0);
    // Households run from one login share one e-mail: show it only when it differs.
    const showEmails = new Set(accounts.map((a) => a.email)).size > 1;

    const handleSwitch = async (userId: string) => {
        setSwitching(userId);
        setError('');
        try {
            await switchToAccount(userId); // reloads the app on success
        } catch {
            setError(t('switchError'));
            setSwitching(null);
        }
    };

    return (
        <div ref={ref} className={cn('relative', className)}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={t('switcherLabel', { name: nameOf(current) })}
                className="relative flex h-10 max-w-[13rem] items-center gap-1.5 rounded-input border border-border bg-card px-2.5 text-caption font-medium text-foreground transition-colors hover:bg-surface-2 sm:max-w-[16rem]"
            >
                <Home className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate">{nameOf(current)}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {unreadElsewhere > 0 && (
                    <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-destructive" aria-hidden="true" />
                )}
            </button>

            {open && (
                <div
                    role="menu"
                    className="absolute left-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-card border border-border bg-card shadow-surface-hover"
                >
                    <div className="border-b border-border px-4 py-3">
                        <p className="text-caption font-semibold text-foreground">{t('menuTitle')}</p>
                    </div>
                    <div className="max-h-80 overflow-y-auto py-1">
                        {accounts.map((account) => (
                            <button
                                key={account.id}
                                type="button"
                                role="menuitem"
                                disabled={account.is_current || switching !== null}
                                onClick={() => void handleSwitch(account.id)}
                                className={cn(
                                    'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                                    account.is_current ? 'cursor-default' : 'hover:bg-surface-2'
                                )}
                            >
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-caption font-medium text-foreground">
                                        {nameOf(account)}
                                    </span>
                                    {showEmails && (
                                        <span className="block truncate text-micro text-muted-foreground">{account.email}</span>
                                    )}
                                </span>
                                {account.is_current ? (
                                    <Check className="h-4 w-4 shrink-0 text-primary" aria-label={t('current')} />
                                ) : switching === account.id ? (
                                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                                ) : account.unread_count > 0 ? (
                                    <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                                        {account.unread_count > 99 ? '99+' : account.unread_count}
                                    </span>
                                ) : null}
                            </button>
                        ))}
                    </div>
                    {error && <p className="px-4 pb-2 text-micro text-destructive">{error}</p>}
                    <div className="border-t border-border px-4 py-2">
                        <Link
                            to="/settings#households"
                            onClick={() => setOpen(false)}
                            className="block text-center text-micro text-primary hover:text-primary/80"
                        >
                            {t('manage')}
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
};
