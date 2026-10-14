import { query } from '../db';
import { generateToken } from '../middleware/auth';
import { parseDisabledModules } from '../routes/userSettings';
import { displayEmailSql } from './households';

export interface SessionUser {
    id: string;
    email: string;
    name: string;
    role: string;
    is_owner: boolean;
    currency: string;
    language: string;
    week_start_day: number | null;
    avatar_url: string | null;
    disabled_modules: string[];
}

/**
 * A fresh session for an account, exactly as /login and /refresh build it: a
 * token scoped to the account's current family and the user payload the app
 * stores. Returns null when the account no longer exists.
 */
export const sessionFor = async (userId: string): Promise<{ token: string; user: SessionUser } | null> => {
    const result = await query(
        `SELECT id, ${displayEmailSql('users')} AS email, name, role, currency, language, week_start_day, avatar_url, disabled_modules, family_owner_id
         FROM users WHERE id = $1`,
        [userId]
    );
    const user = result.rows[0];
    if (!user) return null;

    const ownerId: string = user.family_owner_id ?? user.id;
    const isOwner = !user.family_owner_id;

    // disabled_modules is family-wide: read it from the owner's row (own row if owner).
    const disabled_modules = isOwner
        ? parseDisabledModules(user.disabled_modules)
        : parseDisabledModules((await query('SELECT disabled_modules FROM users WHERE id = $1', [ownerId])).rows[0]?.disabled_modules);

    return {
        token: generateToken(user.id, ownerId),
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            is_owner: isOwner,
            currency: user.currency || 'EUR',
            language: user.language || 'fr',
            week_start_day: user.week_start_day ?? null,
            avatar_url: user.avatar_url ?? null,
            disabled_modules,
        },
    };
};
