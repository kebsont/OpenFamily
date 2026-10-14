import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, X } from 'lucide-react';
import { APP_NAME, needsHomeScreenInstall } from '../../lib/pwa';

const DISMISSED_KEY = 'openfamily.iosInstallDismissed';

const wasDismissed = (): boolean => {
    try {
        return localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
        return false;
    }
};

/**
 * On an iPhone, in Safari: how to put the app on the home screen, the only way
 * to get it full screen and with notifications. Hidden in the installed app,
 * on other phones, and once dismissed.
 */
export const IosInstallBanner: React.FC = () => {
    const { t } = useTranslation('pwa');
    const [visible, setVisible] = useState(() => needsHomeScreenInstall() && !wasDismissed());
    if (!visible) return null;

    const dismiss = () => {
        try {
            localStorage.setItem(DISMISSED_KEY, '1');
        } catch {
            // Private browsing: it simply shows again next time.
        }
        setVisible(false);
    };

    return (
        <div className="mb-4 flex items-start gap-3 rounded-card border border-primary/30 bg-primary-soft px-4 py-3" role="note">
            <Share className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
                <p className="text-caption font-semibold text-foreground">{t('banner.title', { app: APP_NAME })}</p>
                <p className="mt-0.5 text-micro text-muted-foreground">{t('banner.steps')}</p>
                <button type="button" onClick={dismiss} className="mt-2 text-micro font-semibold text-primary">
                    {t('banner.dismiss')}
                </button>
            </div>
            <button
                type="button"
                onClick={dismiss}
                className="-m-1 shrink-0 rounded-input p-1 text-muted-foreground hover:text-foreground"
                aria-label={t('banner.close')}
            >
                <X className="h-4 w-4" />
            </button>
        </div>
    );
};
