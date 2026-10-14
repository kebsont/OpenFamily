import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { useLinkedAccounts } from '../hooks/useLinkedAccounts';
import { useWebSocketUpdates } from '../hooks/useWebSocketUpdates';
import { cn } from '../lib/utils';
import {
    getAnalysis,
    getCombined,
    listPurchases,
    thisMonth,
    type Analysis,
    type CombinedHousehold,
    type Purchase,
} from '../lib/purchases';
import { AddPanel } from './purchases/AddPanel';
import { AnalysisPanel } from './purchases/AnalysisPanel';
import { CombinedPanel } from './purchases/CombinedPanel';
import { HistoryPanel } from './purchases/HistoryPanel';
import { MonthPicker } from './purchases/ui';

type Tab = 'add' | 'history' | 'analysis' | 'combined';

/**
 * Purchases: receipts read from a photo, small expenses, electricity top-ups,
 * and what they say month after month. Each household sees its own; the person
 * who runs several also gets them side by side.
 */
const Purchases: React.FC = () => {
    const { t } = useTranslation('purchases');
    const { user } = useAuth();
    const { accounts } = useLinkedAccounts();
    const canEdit = Boolean(user?.is_owner) || (user?.role ?? '').toLowerCase() !== 'enfant';
    const multiHousehold = accounts.length > 1;

    // ?add=scan|electricity|quick opens the matching form (quick actions).
    const addParam = new URLSearchParams(window.location.search).get('add');
    const initialAdd = addParam === 'scan' || addParam === 'electricity' || addParam === 'quick' ? addParam : undefined;
    const [tab, setTab] = useState<Tab>(canEdit ? 'add' : 'analysis');
    const [month, setMonth] = useState(thisMonth());
    const [purchases, setPurchases] = useState<Purchase[]>([]);
    const [analysis, setAnalysis] = useState<Analysis | null>(null);
    const [combined, setCombined] = useState<CombinedHousehold[] | null>(null);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [list, data] = await Promise.all([listPurchases(month), getAnalysis(month)]);
            setPurchases(list);
            setAnalysis(data);
            if (multiHousehold) {
                setCombined((await getCombined(month)).households);
            }
        } catch {
            // Each panel shows its own empty or error state.
        } finally {
            setLoading(false);
        }
    }, [month, multiHousehold]);

    useEffect(() => {
        void load();
    }, [load]);

    // Every purchase writes a budget entry: a change anywhere refreshes here.
    useWebSocketUpdates('budget', () => void load());

    const tabs: Array<{ id: Tab; label: string }> = [
        ...(canEdit ? [{ id: 'add' as Tab, label: t('tabs.add') }] : []),
        { id: 'history', label: t('tabs.history') },
        { id: 'analysis', label: t('tabs.analysis') },
        ...(multiHousehold ? [{ id: 'combined' as Tab, label: t('tabs.combined') }] : []),
    ];

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-title font-bold text-foreground">{t('title')}</h2>
                <p className="text-caption text-muted-foreground">{t('subtitle')}</p>
            </div>

            <div className="flex gap-1 overflow-x-auto rounded-card bg-surface-2 p-1 scrollbar-hide" role="tablist">
                {tabs.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === item.id}
                        onClick={() => setTab(item.id)}
                        className={cn(
                            'flex-1 whitespace-nowrap rounded-input px-2 py-2 text-caption font-medium transition-colors',
                            tab === item.id ? 'bg-card text-foreground shadow-surface' : 'text-muted-foreground hover:text-foreground'
                        )}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            {tab !== 'add' && <MonthPicker month={month} onChange={setMonth} />}

            {tab === 'add' && (
                <AddPanel
                    initialMode={initialAdd}
                    onSaved={() => {
                        setMonth(thisMonth());
                        void load();
                    }}
                />
            )}
            {tab === 'history' && <HistoryPanel purchases={purchases} loading={loading} canEdit={canEdit} onChanged={() => void load()} />}
            {tab === 'analysis' && <AnalysisPanel data={analysis} loading={loading} />}
            {tab === 'combined' && <CombinedPanel households={combined} loading={loading} />}
        </div>
    );
};

export default Purchases;
