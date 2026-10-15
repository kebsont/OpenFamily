// Monthly shopping list ("Courses"): one list per month, written like a note
// (one product per line) and ticked in the shop. Past months stay as they
// were: that is the history.
//
// What the household listed and bought before also suggests the usual
// products of a new month. History comes from three places, all scoped to the
// household (req.userId):
// - the monthly lists themselves (monthly_list_items), including older lists
//   pasted once from notes or WhatsApp;
// - receipt lines (purchases), so what was bought counts even off the list;
// - small expenses with what was bought (corner shop, market).
//
// A product bought every month is suggested every month. One bought every two
// or three months is suggested once that time has passed since the last time.
// Products bought several times at the corner shop last month are suggested
// for the big run, except daily fresh ones.

import { Router } from 'express';
import { getClient, query } from '../db';
import { authMiddleware, AuthRequest, requireParent } from '../middleware/auth';
import { broadcast } from '../lib/broadcaster';
import { getFamilyCategories } from './categories';
import {
    displayName, guessAisle, isDailyFresh, listNameKey, looksLikeMarket, MARKET_CATEGORY, parseLine, parseLists, productKey,
    type ListLine,
} from '../lib/products';

const router = Router();
router.use(authMiddleware);

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const WINDOW = 6; // months of history looked at
const MAX_TEXT = 60_000;
const MAX_IMPORT_MONTHS = 24;
const MAX_LINES = 200; // lines added at once
const MAX_ITEMS = 400; // lines in one month
const MAX_OCCASIONAL = 40;

type Place = 'store' | 'market';
type Status = 'due' | 'not_yet' | 'occasional' | 'planned' | 'in_list';

const monthIndex = (month: string): number => {
    const [y, m] = month.split('-').map(Number);
    return y * 12 + (m - 1);
};
const monthId = (index: number): string => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
const firstDay = (index: number): string => `${monthId(index)}-01`;

const text = (value: unknown, max: number): string =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

const isCornerShop = (store: string) => /^boutique/i.test(store.trim());
const isMarket = (store: string) => /^march[eé]/i.test(store.trim());

export interface Suggestion {
    key: string;
    name: string;
    detail: string | null;
    quantity: number | null;
    place: Place;
    category: string;
    status: Status;
    /** Months of the window in which it was listed or bought. */
    months: number;
    /** Months of the window with any data at all. */
    total_months: number;
    /** Usual number of months between two purchases (null: seen once). */
    interval: number | null;
    last: string | null;
    /** Times bought at the corner shop last month. */
    corner: number;
}

interface Acc {
    key: string;
    listName?: string;
    receiptName?: string;
    quickName?: string;
    detail: string | null;
    quantity: number | null;
    months: Set<number>;
    planned: boolean;
    receipts: number;
    marketBuys: number;
    corner: number;
    categories: Map<string, number>;
}

const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Spellings of one product that differ only by trailing words ("Fromage vache
 * qui rit" / "Fromage vache qui rit et Kiri") are counted together, under the
 * shorter one. Only prefixes of two words or more: "Pâte dentifrice" is not
 * "Pâtes".
 */
const canonicalKeys = (keys: Iterable<string>): Map<string, string> => {
    const all = [...new Set(keys)];
    const roots = all.filter((k) => k.split(' ').length >= 2);
    const map = new Map<string, string>();
    for (const key of all) {
        let best = key;
        for (const root of roots) {
            if (root !== key && key.startsWith(`${root} `) && root.length < best.length) best = root;
        }
        map.set(key, best);
    }
    return map;
};

export async function buildSuggestions(ownerId: string, month: string) {
    const target = monthIndex(month);
    const from = firstDay(target - WINDOW);
    const until = firstDay(target); // exclusive for purchases

    const [lists, receipts, quick, places, pending, history, categories] = await Promise.all([
        query(
            `SELECT to_char(month, 'YYYY-MM') AS month, name, product_key, quantity::float8 AS quantity, detail
             FROM monthly_list_items WHERE user_id = $1 AND month >= $2 AND month <= $3
             ORDER BY month, created_at`,
            [ownerId, from, until]
        ),
        query(
            `SELECT to_char(p.purchased_on, 'YYYY-MM') AS month, p.store, pi.product, pi.category
             FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
             WHERE p.user_id = $1 AND p.kind = 'receipt' AND pi.line_total > 0
               AND p.purchased_on >= $2 AND p.purchased_on < $3`,
            [ownerId, from, until]
        ),
        query(
            `SELECT to_char(purchased_on, 'YYYY-MM') AS month, store, note
             FROM purchases
             WHERE user_id = $1 AND kind = 'quick' AND note IS NOT NULL AND note <> ''
               AND purchased_on >= $2 AND purchased_on < $3`,
            [ownerId, from, until]
        ),
        query('SELECT product_key, place FROM product_places WHERE user_id = $1', [ownerId]),
        query('SELECT name FROM shopping_items WHERE user_id = $1 AND is_checked IS NOT TRUE', [ownerId]),
        query(
            `SELECT to_char(month, 'YYYY-MM') AS month, COUNT(*)::int AS count
             FROM monthly_list_items WHERE user_id = $1
             GROUP BY month ORDER BY month DESC LIMIT 24`,
            [ownerId]
        ),
        getFamilyCategories(ownerId),
    ]);

    type ListRow = { month: string; name: string; product_key: string; quantity: number | null; detail: string | null };
    type ReceiptRow = { month: string; store: string; product: string; category: string };
    type QuickRow = { month: string; store: string; note: string };
    const listRows = lists.rows as ListRow[];
    const receiptRows = (receipts.rows as ReceiptRow[]).map((r) => ({ ...r, key: productKey(r.product) })).filter((r) => r.key);
    const quickRows = (quick.rows as QuickRow[]).map((r) => ({ ...r, key: productKey(r.note) })).filter((r) => r.key);

    const canonical = canonicalKeys([
        ...listRows.map((r) => r.product_key),
        ...receiptRows.map((r) => r.key),
        ...quickRows.map((r) => r.key),
    ]);
    const products = new Map<string, Acc>();
    const acc = (raw: string): Acc => {
        const key = canonical.get(raw) ?? raw;
        let entry = products.get(key);
        if (!entry) {
            entry = {
                key, detail: null, quantity: null, months: new Set(), planned: false,
                receipts: 0, marketBuys: 0, corner: 0, categories: new Map(),
            };
            products.set(key, entry);
        }
        return entry;
    };
    const dataMonths = new Set<number>();

    for (const row of listRows) {
        const index = monthIndex(row.month);
        const entry = acc(row.product_key);
        // The shortest spelling names the product; the quantity is the one of
        // the latest list, the detail the latest one written.
        if (!entry.listName || canonical.get(row.product_key) === row.product_key) entry.listName = row.name;
        if (row.detail) entry.detail = row.detail;
        entry.quantity = row.quantity === null ? null : Number(row.quantity);
        if (index === target) {
            entry.planned = true;
        } else {
            entry.months.add(index);
            dataMonths.add(index);
        }
    }

    const storeCounts = new Map<string, number>();
    for (const row of receiptRows) {
        const index = monthIndex(row.month);
        const entry = acc(row.key);
        entry.receiptName ??= displayName(row.product);
        entry.months.add(index);
        entry.receipts += 1;
        entry.categories.set(row.category, (entry.categories.get(row.category) ?? 0) + 1);
        dataMonths.add(index);
        storeCounts.set(row.store, (storeCounts.get(row.store) ?? 0) + 1);
    }

    for (const row of quickRows) {
        const index = monthIndex(row.month);
        const entry = acc(row.key);
        entry.quickName ??= displayName(row.note);
        entry.months.add(index);
        dataMonths.add(index);
        if (isMarket(row.store)) entry.marketBuys += 1;
        if (isCornerShop(row.store) && index === target - 1) entry.corner += 1;
    }

    const placePrefs = new Map((places.rows as Array<{ product_key: string; place: Place }>).map((r) => [r.product_key, r.place]));
    const pendingKeys = new Set((pending.rows as Array<{ name: string }>).map((r) => {
        const key = listNameKey(r.name);
        return canonical.get(key) ?? key;
    }));
    const shelfAisles = categories.shopping.filter((c) => c !== MARKET_CATEGORY);
    const totalMonths = dataMonths.size;

    const items: Suggestion[] = [];
    for (const entry of products.values()) {
        const sorted = [...entry.months].sort((a, b) => a - b);
        const last = sorted.length ? sorted[sorted.length - 1] : null;
        const gaps = sorted.slice(1).map((m, i) => m - sorted[i]);
        const interval = gaps.length ? Math.max(1, Math.round(median(gaps))) : null;
        const since = last === null ? null : target - last;

        // Due: its usual interval has passed, and it is still bought regularly
        // (half the months or more) or only just late. A product bought two
        // months in a row back in June is not ticked in November.
        const share = totalMonths ? entry.months.size / totalMonths : 0;
        let status: Status;
        if (entry.planned) status = 'planned';
        else if (pendingKeys.has(entry.key)) status = 'in_list';
        else if (entry.corner >= 2 && !isDailyFresh(entry.key)) status = 'due';
        else if (interval !== null && since !== null && since >= interval && (share >= 0.5 || since <= interval + 1)) status = 'due';
        else if (interval !== null && since !== null && since < interval) status = 'not_yet';
        else status = 'occasional';

        const place: Place = placePrefs.get(entry.key)
            ?? (entry.marketBuys > entry.receipts ? 'market'
                : entry.receipts > 0 ? 'store'
                    : looksLikeMarket(entry.key) ? 'market' : 'store');

        const topCategory = [...entry.categories.entries()]
            .filter(([c]) => shelfAisles.includes(c))
            .sort((a, b) => b[1] - a[1])[0]?.[0];

        items.push({
            key: entry.key,
            name: entry.listName ?? entry.receiptName ?? entry.quickName ?? entry.key,
            detail: entry.detail,
            quantity: entry.quantity,
            place,
            category: topCategory ?? guessAisle(entry.key, shelfAisles),
            status,
            months: entry.months.size,
            total_months: totalMonths,
            interval,
            last: last === null ? null : monthId(last),
            corner: entry.corner,
        });
    }

    const rank: Record<Status, number> = { due: 0, not_yet: 1, occasional: 2, planned: 3, in_list: 3 };
    items.sort((a, b) =>
        rank[a.status] - rank[b.status]
        || b.corner - a.corner
        || b.months - a.months
        || (b.last ?? '').localeCompare(a.last ?? '')
        || a.name.localeCompare(b.name, 'fr'));

    // Occasional products: the most frequent and recent ones, so the list stays readable.
    let occasional = 0;
    const kept = items.filter((item) => item.status !== 'occasional' || ++occasional <= MAX_OCCASIONAL);

    const topStore = [...storeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return {
        month,
        store_label: topStore,
        total_months: totalMonths,
        history: history.rows as Array<{ month: string; count: number }>,
        items: kept,
    };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const readMonth = (value: unknown): string | null =>
    typeof value === 'string' && MONTH_PATTERN.test(value) ? value : null;

// GET /suggestions?month=YYYY-MM
router.get('/suggestions', async (req: AuthRequest, res) => {
    try {
        const month = readMonth(req.query.month);
        if (!month) return res.status(400).json({ success: false, error: 'invalid_month' });
        return res.json({ success: true, data: await buildSuggestions(req.userId!, month) });
    } catch (error) {
        console.error('Monthly list suggestions error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

const ITEM_COLUMNS = `id, to_char(month, 'YYYY-MM') AS month, name, quantity::float8 AS quantity, detail, checked, position`;

const monthItems = async (ownerId: string, month: string) =>
    (await query(
        `SELECT ${ITEM_COLUMNS} FROM monthly_list_items
         WHERE user_id = $1 AND month = $2 ORDER BY position, created_at`,
        [ownerId, `${month}-01`]
    )).rows;

const history = async (ownerId: string) =>
    (await query(
        `SELECT to_char(month, 'YYYY-MM') AS month, COUNT(*)::int AS count
         FROM monthly_list_items WHERE user_id = $1
         GROUP BY month ORDER BY month DESC LIMIT 24`,
        [ownerId]
    )).rows;

const changed = (ownerId: string) => broadcast(ownerId, { type: 'update', entity: 'shopping', action: 'updated' });

// GET /month?month=YYYY-MM — that month's list, in the order it was written.
router.get('/month', async (req: AuthRequest, res) => {
    try {
        const month = readMonth(req.query.month);
        if (!month) return res.status(400).json({ success: false, error: 'invalid_month' });
        const [items, months] = await Promise.all([monthItems(req.userId!, month), history(req.userId!)]);
        return res.json({ success: true, data: { month, items, history: months } });
    } catch (error) {
        console.error('Monthly list read error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /items { month, text } — one product per line, added at the end. A
// product already on the list is not added twice.
router.post('/items', requireParent, async (req: AuthRequest, res) => {
    try {
        const month = readMonth(req.body?.month);
        if (!month) return res.status(400).json({ success: false, error: 'invalid_month' });
        const raw: string = typeof req.body?.text === 'string' ? req.body.text.slice(0, MAX_TEXT) : '';
        const lines = raw.split(/\r?\n/).map((line) => parseLine(line)).filter((l): l is ListLine => l !== null).slice(0, MAX_LINES);
        if (lines.length === 0) return res.status(400).json({ success: false, error: 'no_items' });

        const client = await getClient();
        try {
            await client.query('BEGIN');
            // One writer at a time per household and month keeps positions in order.
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${req.userId}:${month}`]);
            const existing = await client.query(
                'SELECT product_key, position FROM monthly_list_items WHERE user_id = $1 AND month = $2',
                [req.userId, `${month}-01`]
            );
            const keys = new Set((existing.rows as Array<{ product_key: string }>).map((r) => r.product_key));
            let position = Math.max(0, ...(existing.rows as Array<{ position: number }>).map((r) => r.position));
            if (keys.size + lines.length > MAX_ITEMS) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'too_many' });
            }
            for (const line of lines) {
                if (keys.has(line.key)) continue;
                keys.add(line.key);
                position += 1;
                await client.query(
                    `INSERT INTO monthly_list_items (user_id, month, name, product_key, quantity, detail, checked, position)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [req.userId, `${month}-01`, line.name, line.key, line.quantity, line.detail, line.checked, position]
                );
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }

        changed(req.userId!);
        return res.json({ success: true, data: { month, items: await monthItems(req.userId!, month) } });
    } catch (error) {
        console.error('Monthly list add error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// PUT /items/:id { checked?, text? } — tick in the shop, or fix a line.
router.put('/items/:id', requireParent, async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        if (!UUID_PATTERN.test(id)) return res.status(404).json({ success: false, error: 'not_found' });
        const sets: string[] = [];
        const values: unknown[] = [];
        if (typeof req.body?.checked === 'boolean') {
            values.push(req.body.checked);
            sets.push(`checked = $${values.length}`);
        }
        if (req.body?.text !== undefined) {
            const line = parseLine(text(req.body.text, 200));
            if (!line) return res.status(400).json({ success: false, error: 'no_items' });
            const duplicate = await query(
                `SELECT 1 FROM monthly_list_items o
                 JOIN monthly_list_items m ON m.id = $2 AND m.user_id = $1
                 WHERE o.user_id = $1 AND o.month = m.month AND o.product_key = $3 AND o.id <> m.id`,
                [req.userId, id, line.key]
            );
            if (duplicate.rows.length > 0) return res.status(409).json({ success: false, error: 'duplicate' });
            values.push(line.name, line.key, line.quantity, line.detail);
            const n = values.length;
            sets.push(`name = $${n - 3}`, `product_key = $${n - 2}`, `quantity = $${n - 1}`, `detail = $${n}`);
        }
        if (sets.length === 0) return res.status(400).json({ success: false, error: 'nothing_to_change' });
        values.push(id, req.userId);
        const result = await query(
            `UPDATE monthly_list_items SET ${sets.join(', ')}
             WHERE id = $${values.length - 1} AND user_id = $${values.length}
             RETURNING ${ITEM_COLUMNS}`,
            values
        ).catch((error: { code?: string }) => {
            if (error?.code === '23505') return null; // the same product is already on that list
            throw error;
        });
        if (result === null) return res.status(409).json({ success: false, error: 'duplicate' });
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'not_found' });
        changed(req.userId!);
        return res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('Monthly list update error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// DELETE /items/:id
router.delete('/items/:id', requireParent, async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        if (!UUID_PATTERN.test(id)) return res.status(404).json({ success: false, error: 'not_found' });
        const result = await query('DELETE FROM monthly_list_items WHERE id = $1 AND user_id = $2', [id, req.userId]);
        if (!result.rowCount) return res.status(404).json({ success: false, error: 'not_found' });
        changed(req.userId!);
        return res.json({ success: true });
    } catch (error) {
        console.error('Monthly list delete error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /import { text, month? } — older lists pasted from notes or WhatsApp.
// Titles such as "Courses du mois de Juillet" split the text by month; lines
// before any title go to `month`. Ticks ("[x]") are kept; a month that
// already has a list keeps it and gets the missing lines at the end.
router.post('/import', requireParent, async (req: AuthRequest, res) => {
    try {
        const raw = typeof req.body?.text === 'string' ? req.body.text : '';
        if (!raw.trim()) return res.status(400).json({ success: false, error: 'no_items' });
        if (raw.length > MAX_TEXT) return res.status(400).json({ success: false, error: 'too_long' });
        const fallback = req.body?.month === undefined || req.body?.month === '' ? null : readMonth(req.body.month);
        if (req.body?.month && !fallback) return res.status(400).json({ success: false, error: 'invalid_month' });

        const parsed = parseLists(raw, new Date(), fallback ? `${fallback}-01` : null);
        if (parsed.some((list) => list.month === null)) {
            return res.status(400).json({ success: false, error: 'missing_month' });
        }
        const lists = parsed.slice(0, MAX_IMPORT_MONTHS);
        if (lists.length === 0) return res.status(400).json({ success: false, error: 'no_items' });

        const client = await getClient();
        try {
            await client.query('BEGIN');
            for (const list of lists) {
                await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${req.userId}:${list.month!.slice(0, 7)}`]);
                const existing = await client.query(
                    'SELECT product_key, position FROM monthly_list_items WHERE user_id = $1 AND month = $2',
                    [req.userId, list.month]
                );
                const keys = new Set((existing.rows as Array<{ product_key: string }>).map((r) => r.product_key));
                let position = Math.max(0, ...(existing.rows as Array<{ position: number }>).map((r) => r.position));
                for (const item of list.items) {
                    if (keys.has(item.key)) continue;
                    keys.add(item.key);
                    position += 1;
                    await client.query(
                        `INSERT INTO monthly_list_items (user_id, month, name, product_key, quantity, detail, checked, position)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                        [req.userId, list.month, item.name, item.key, item.quantity, item.detail, item.checked, position]
                    );
                }
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }

        changed(req.userId!);
        return res.json({
            success: true,
            data: { months: lists.map((l) => ({ month: l.month!.slice(0, 7), count: l.items.length })) },
        });
    } catch (error) {
        console.error('Monthly list import error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// DELETE /history/:month — forget one month of lists (a wrong import).
router.delete('/history/:month', requireParent, async (req: AuthRequest, res) => {
    try {
        const month = readMonth(req.params.month);
        if (!month) return res.status(400).json({ success: false, error: 'invalid_month' });
        const result = await query(
            'DELETE FROM monthly_list_items WHERE user_id = $1 AND month = $2',
            [req.userId, `${month}-01`]
        );
        changed(req.userId!);
        return res.json({ success: true, data: { deleted: result.rowCount ?? 0 } });
    } catch (error) {
        console.error('Monthly list delete error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export default router;
