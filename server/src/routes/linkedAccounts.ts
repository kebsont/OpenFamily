// Linked accounts: one person, several households.
//
// A person who runs several households keeps one account per household (each
// household stays a separate OpenFamily family, so its members never see the
// others). Linking those accounts lets them switch between households in one
// tap instead of signing out and in again.
//
// Rules:
// - linking needs the e-mail AND password of the other account, so it grants
//   nothing a person could not already do by signing in;
// - accounts sharing a group_id can switch to each other, nobody else gains
//   anything: a family member who is not in the group sees no difference;
// - a switch issues the target account's normal session, so every existing
//   permission check (owner, parent, child) applies unchanged.
//
// One login for several households: POST /households opens a new household
// owned by a "managed" account. It has no usable password and a placeholder
// e-mail, so nobody can sign in to it; it is only reached by switching from
// the account that created it (managed_by). Its members see that person's
// name, photo and e-mail, kept in step at each switch.

import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import { getClient, query } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { normalizeEmail } from '../lib/normalize';
import { sessionFor } from '../lib/session';
import { displayEmailSql, MANAGED_EMAIL_DOMAIN } from '../lib/households';

const router = Router();
router.use(authMiddleware);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABEL_MAX = 60;
const MAX_HOUSEHOLDS = 10;

// Linking checks a password: same brute-force protection as /login. Failed
// attempts only (a successful link is not an attack).
const linkWindowMs = Number.parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '900000', 10);
const linkMax = Number.parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10', 10);
const linkRateLimiter = rateLimit({
    windowMs: Number.isNaN(linkWindowMs) ? 900000 : linkWindowMs,
    max: Number.isNaN(linkMax) ? 10 : linkMax,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { success: false, error: 'too_many_attempts' },
});

// Compared against when the e-mail matches no account, so a miss costs the
// same time as a wrong password.
let dummyHash: string | null = null;
const getDummyHash = async (): Promise<string> => {
    if (!dummyHash) dummyHash = await bcrypt.hash('openfamily-linked-accounts-dummy', 12);
    return dummyHash;
};

/** Trimmed label, null when empty, undefined when the value is not a string or too long. */
const cleanLabel = (value: unknown): string | null | undefined => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (trimmed.length > LABEL_MAX) return undefined;
    return trimmed.length > 0 ? trimmed : null;
};

const groupOf = async (userId: string): Promise<string | null> => {
    const result = await query('SELECT group_id FROM linked_accounts WHERE user_id = $1', [userId]);
    return (result.rows[0]?.group_id as string | undefined) ?? null;
};

/** True when both accounts are distinct members of the same group. */
const sameGroup = async (a: string, b: string): Promise<boolean> => {
    if (a === b) return false;
    const result = await query(
        `SELECT 1 FROM linked_accounts x
         JOIN linked_accounts y ON y.group_id = x.group_id
         WHERE x.user_id = $1 AND y.user_id = $2`,
        [a, b]
    );
    return result.rows.length > 0;
};

const listFor = async (userId: string) => {
    const result = await query(
        `SELECT u.id, u.name, ${displayEmailSql('u')} AS email, la.label,
                (la.managed_by IS NOT NULL) AS managed,
                (u.family_owner_id IS NULL) AS is_owner,
                o.name AS family_owner_name,
                (u.id = $1) AS is_current,
                (SELECT COUNT(*)::int FROM notifications n
                  WHERE n.user_id = COALESCE(u.family_owner_id, u.id) AND n.is_read = false) AS unread_count
         FROM linked_accounts la
         JOIN users u ON u.id = la.user_id
         LEFT JOIN users o ON o.id = COALESCE(u.family_owner_id, u.id)
         WHERE la.group_id = (SELECT group_id FROM linked_accounts WHERE user_id = $1)
         ORDER BY la.created_at, u.name`,
        [userId]
    );
    return result.rows;
};

// GET / — the accounts this one can switch to (empty when not linked).
router.get('/', async (req: AuthRequest, res) => {
    try {
        const accounts = await listFor(req.actualUserId!);
        // A group left with only this account (the others were deleted) is no group.
        return res.json({ success: true, data: { accounts: accounts.length > 1 ? accounts : [] } });
    } catch (error) {
        console.error('Linked accounts list error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST / — link another account, proven by its e-mail and password.
// Errors are 400 on purpose: a 401 would sign the current session out.
router.post('/', linkRateLimiter, async (req: AuthRequest, res) => {
    const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };
    const label = cleanLabel((req.body ?? {}).label);
    const currentLabel = cleanLabel((req.body ?? {}).currentLabel);

    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
        return res.status(400).json({ success: false, error: 'missing_fields' });
    }
    if (label === undefined || currentLabel === undefined) {
        return res.status(400).json({ success: false, error: 'invalid_label' });
    }

    const me = req.actualUserId!;
    try {
        const found = await query('SELECT id, password_hash FROM users WHERE LOWER(email) = $1', [normalizeEmail(email)]);
        const target = found.rows[0] as { id: string; password_hash: string } | undefined;
        const valid = await bcrypt.compare(password, target?.password_hash ?? (await getDummyHash()));
        if (!target || !valid) {
            // Counted by the limiter: skipSuccessfulRequests only skips 2xx/3xx.
            return res.status(400).json({ success: false, error: 'invalid_credentials' });
        }
        if (target.id === me) {
            return res.status(400).json({ success: false, error: 'cannot_link_self' });
        }

        const client = await getClient();
        try {
            await client.query('BEGIN');
            // Serialise concurrent links touching these accounts.
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['linked_accounts']);

            const groups = await client.query(
                'SELECT user_id, group_id FROM linked_accounts WHERE user_id = ANY($1::uuid[])',
                [[me, target.id]]
            );
            const mine = groups.rows.find((r) => r.user_id === me)?.group_id as string | undefined;
            const theirs = groups.rows.find((r) => r.user_id === target.id)?.group_id as string | undefined;

            let groupId: string;
            if (mine && theirs) {
                groupId = mine;
                if (mine !== theirs) {
                    // Two keychains of the same person: merge them.
                    await client.query('UPDATE linked_accounts SET group_id = $1 WHERE group_id = $2', [mine, theirs]);
                }
            } else if (mine) {
                groupId = mine;
                await client.query('INSERT INTO linked_accounts (user_id, group_id) VALUES ($1, $2)', [target.id, groupId]);
            } else if (theirs) {
                groupId = theirs;
                await client.query('INSERT INTO linked_accounts (user_id, group_id) VALUES ($1, $2)', [me, groupId]);
            } else {
                groupId = (await client.query('SELECT uuid_generate_v4() AS id')).rows[0].id as string;
                await client.query(
                    'INSERT INTO linked_accounts (user_id, group_id) VALUES ($1, $3), ($2, $3)',
                    [me, target.id, groupId]
                );
            }

            if (label !== null) {
                await client.query('UPDATE linked_accounts SET label = $1 WHERE user_id = $2', [label, target.id]);
            }
            if (currentLabel !== null) {
                await client.query('UPDATE linked_accounts SET label = $1 WHERE user_id = $2', [currentLabel, me]);
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }

        return res.json({ success: true, data: { accounts: await listFor(me) } });
    } catch (error) {
        console.error('Link account error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /households — open a new household run from this login. A managed
// account owns it (see the header comment); the new household starts empty,
// its owner shows this person's name and photo, and the switcher lists it.
router.post('/households', async (req: AuthRequest, res) => {
    const label = cleanLabel((req.body ?? {}).label);
    const currentLabel = cleanLabel((req.body ?? {}).currentLabel);
    if (label === undefined || currentLabel === undefined) {
        return res.status(400).json({ success: false, error: 'invalid_label' });
    }
    if (!label) {
        return res.status(400).json({ success: false, error: 'missing_label' });
    }

    const me = req.actualUserId!;
    try {
        // Unusable on purpose: the secret is thrown away, the address is reserved.
        const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
        const email = `account-${crypto.randomUUID()}@${MANAGED_EMAIL_DOMAIN}`;

        let createdId = '';
        const client = await getClient();
        try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['linked_accounts']);

            const mine = (await client.query(
                'SELECT group_id, managed_by FROM linked_accounts WHERE user_id = $1',
                [me]
            )).rows[0] as { group_id: string; managed_by: string | null } | undefined;
            // The household is run by the account that holds the login.
            const manager = mine?.managed_by ?? me;

            if (mine) {
                const size = (await client.query(
                    'SELECT COUNT(*)::int AS n FROM linked_accounts WHERE group_id = $1',
                    [mine.group_id]
                )).rows[0].n as number;
                if (size >= MAX_HOUSEHOLDS) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, error: 'too_many_households' });
                }
            }

            const created = await client.query(
                `INSERT INTO users (email, password_hash, name, role, currency, language, week_start_day, avatar_url)
                 SELECT $1, $2, name, 'parent', currency, language, week_start_day, avatar_url FROM users WHERE id = $3
                 RETURNING id`,
                [email, passwordHash, me]
            );
            createdId = created.rows[0].id as string;

            let groupId = mine?.group_id;
            if (!groupId) {
                groupId = (await client.query('SELECT uuid_generate_v4() AS id')).rows[0].id as string;
                await client.query(
                    'INSERT INTO linked_accounts (user_id, group_id, label) VALUES ($1, $2, $3)',
                    [me, groupId, currentLabel]
                );
            } else if (currentLabel !== null) {
                await client.query('UPDATE linked_accounts SET label = $1 WHERE user_id = $2', [currentLabel, me]);
            }
            await client.query(
                'INSERT INTO linked_accounts (user_id, group_id, label, managed_by) VALUES ($1, $2, $3, $4)',
                [createdId, groupId, label, manager]
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }

        return res.json({ success: true, data: { accounts: await listFor(me), created: createdId } });
    } catch (error) {
        console.error('Create household error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// PUT /:userId/label — rename a household in the switcher (this account or a linked one).
router.put('/:userId/label', async (req: AuthRequest, res) => {
    const target = req.params.userId;
    const label = cleanLabel((req.body ?? {}).label);
    if (!UUID_PATTERN.test(target)) {
        return res.status(404).json({ success: false, error: 'not_found' });
    }
    if (label === undefined) {
        return res.status(400).json({ success: false, error: 'invalid_label' });
    }

    const me = req.actualUserId!;
    try {
        const allowed = target === me ? (await groupOf(me)) !== null : await sameGroup(me, target);
        if (!allowed) {
            return res.status(404).json({ success: false, error: 'not_found' });
        }
        await query('UPDATE linked_accounts SET label = $1 WHERE user_id = $2', [label, target]);
        return res.json({ success: true, data: { accounts: await listFor(me) } });
    } catch (error) {
        console.error('Linked account label error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// DELETE /:userId — take an account out of the group (this one or a linked one).
router.delete('/:userId', async (req: AuthRequest, res) => {
    const target = req.params.userId;
    if (!UUID_PATTERN.test(target)) {
        return res.status(404).json({ success: false, error: 'not_found' });
    }

    const me = req.actualUserId!;
    try {
        const groupId = await groupOf(me);
        const allowed = target === me ? groupId !== null : await sameGroup(me, target);
        if (!allowed || !groupId) {
            return res.status(404).json({ success: false, error: 'not_found' });
        }

        // A household created from the switcher has no login of its own, and
        // the account that runs such households cannot leave them behind:
        // either way somebody's household would become unreachable.
        const ties = (await query(
            `SELECT (managed_by IS NOT NULL) AS managed,
                    EXISTS (SELECT 1 FROM linked_accounts m WHERE m.managed_by = $1) AS manages
             FROM linked_accounts WHERE user_id = $1`,
            [target]
        )).rows[0] as { managed: boolean; manages: boolean } | undefined;
        if (ties?.managed) {
            return res.status(400).json({ success: false, error: 'managed_household' });
        }
        if (ties?.manages) {
            return res.status(400).json({ success: false, error: 'has_managed' });
        }

        await query('DELETE FROM linked_accounts WHERE user_id = $1', [target]);
        // A group of one is no group: drop the leftover.
        await query(
            `DELETE FROM linked_accounts WHERE group_id = $1
             AND (SELECT COUNT(*) FROM linked_accounts WHERE group_id = $1) = 1`,
            [groupId]
        );

        const accounts = target === me ? [] : await listFor(me);
        return res.json({ success: true, data: { accounts: accounts.length > 1 ? accounts : [] } });
    } catch (error) {
        console.error('Unlink account error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /switch — continue as a linked account. Optionally carries this
// device's push subscription so the device also gets that household's
// reminders (it keeps the ones of the household it comes from).
router.post('/switch', async (req: AuthRequest, res) => {
    const { userId, push } = (req.body ?? {}) as {
        userId?: unknown;
        push?: { endpoint?: unknown; keys?: { auth?: unknown; p256dh?: unknown } };
    };
    if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) {
        return res.status(400).json({ success: false, error: 'invalid_account' });
    }

    const me = req.actualUserId!;
    try {
        if (!(await sameGroup(me, userId))) {
            return res.status(403).json({ success: false, error: 'not_linked' });
        }

        // One person, one profile: a household run from this login shows the
        // name, photo and preferences the person last set, wherever they set them.
        const managedPair = await query(
            `SELECT 1 FROM linked_accounts t, linked_accounts s
             WHERE t.user_id = $2 AND s.user_id = $1
               AND (t.managed_by IS NOT NULL OR s.managed_by = t.user_id)`,
            [me, userId]
        );
        if (managedPair.rows.length > 0) {
            await query(
                `UPDATE users t
                 SET name = s.name, avatar_url = s.avatar_url, currency = s.currency,
                     language = s.language, week_start_day = s.week_start_day
                 FROM users s
                 WHERE s.id = $1 AND t.id = $2`,
                [me, userId]
            );
        }

        const session = await sessionFor(userId);
        if (!session) {
            return res.status(404).json({ success: false, error: 'not_found' });
        }

        const endpoint = push?.endpoint;
        const auth = push?.keys?.auth;
        const p256dh = push?.keys?.p256dh;
        if (
            typeof endpoint === 'string' && endpoint.startsWith('https://') && endpoint.length <= 2048 &&
            typeof auth === 'string' && auth.length <= 512 &&
            typeof p256dh === 'string' && p256dh.length <= 512
        ) {
            const owner = await query('SELECT COALESCE(family_owner_id, id) AS owner_id FROM users WHERE id = $1', [userId]);
            const ownerId = owner.rows[0]?.owner_id as string | undefined;
            if (ownerId) {
                await query(
                    `INSERT INTO push_subscriptions (user_id, endpoint, keys)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (user_id, endpoint) DO UPDATE SET keys = EXCLUDED.keys`,
                    [ownerId, endpoint, JSON.stringify({ auth, p256dh })]
                );
            }
        }

        return res.json({ success: true, data: session });
    } catch (error) {
        console.error('Switch account error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export default router;
