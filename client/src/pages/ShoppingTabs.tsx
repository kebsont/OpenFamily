import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';

/**
 * The month's big shopping list (supermarket, market) and the corner shop's
 * daily small purchases are two different things: two tabs on the same page.
 */
export const ShoppingTabs: React.FC<{ active: 'month' | 'boutique' }> = ({ active }) => {
    const { t } = useTranslation('boutique');
    const tab = (id: 'month' | 'boutique', to: string, label: string) => (
        <Link
            to={to}
            role="tab"
            aria-selected={active === id}
            className={cn(
                'flex-1 whitespace-nowrap rounded-input px-3 py-2 text-center text-caption font-medium transition-colors',
                active === id ? 'bg-card text-foreground shadow-surface' : 'text-muted-foreground hover:text-foreground'
            )}
        >
            {label}
        </Link>
    );
    return (
        <div className="flex gap-1 rounded-card bg-surface-2 p-1" role="tablist">
            {tab('month', '/shopping', t('tabs.month'))}
            {tab('boutique', '/shopping/boutique', t('tabs.boutique'))}
        </div>
    );
};
