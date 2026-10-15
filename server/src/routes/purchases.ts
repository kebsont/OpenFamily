// Purchases ("Achats"): what each household actually buys, where, for how much.
//
// Three kinds of purchase, all scoped to the household (req.userId):
// - receipt: a till receipt (e.g. Auchan) with its lines, usually read from a
//   photo by the family's AI provider (POST /scan returns a draft that the
//   person checks before saving: nothing is stored from the photo itself);
// - quick: a small expense typed by hand (corner shop, market, DIY…);
// - electricity: a prepaid electricity top-up (Woyofal): amount and kWh.
//
// Every purchase writes one budget entry, so the Budget page stays complete.
// GET /analysis compares a month with the previous one (stores, categories,
// products, electricity, small shops). GET /combined adds the households of a
// person who runs several of them (linked accounts) side by side; it answers
// only to that person.

import express, { Router } from 'express';
import type { PoolClient } from 'pg';
import { getClient, query } from '../db';
import { authMiddleware, AuthRequest, requireParent } from '../middleware/auth';
import { broadcast } from '../lib/broadcaster';
import { getFamilyCategories } from './categories';
import { aiComplete } from '../services/ai';
import { handleAiError, requireConfiguredAi } from './ai';
import { guessAisle, MARKET_CATEGORY, productKey } from '../lib/products';

const router = Router();
router.use(authMiddleware);

const KINDS = ['receipt', 'quick', 'electricity'] as const;
type Kind = (typeof KINDS)[number];

const MAX_TOTAL = 99_999_999; // budget_entries.amount is DECIMAL(10,2)
const MAX_ITEMS = 300;
const MAX_IMAGES = 3;
const MAX_IMAGE_BASE64 = 6_000_000; // ≈ 4.5 MB per picture once decoded
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Cleaning helpers ────────────────────────────────────────────────────────

const text = (value: unknown, max: number): string =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

const num = (value: unknown): number | null => {
    const n = typeof value === 'string' ? Number(value.replace(/\s/g, '').replace(',', '.')) : Number(value);
    return Number.isFinite(n) ? n : null;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

const validDate = (value: unknown): string | null => {
    if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return null;
    const d = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value;
};

// Grouping key for "the same product" across receipts, lists and stores.
export { productKey };

const pickCategory = (value: unknown, allowed: string[]): string => {
    const wanted = text(value, 50).toLowerCase();
    const match = allowed.find((c) => c.toLowerCase() === wanted);
    if (match) return match;
    return allowed.find((c) => c.toLowerCase() === 'autre') ?? allowed[allowed.length - 1] ?? 'Autre';
};

export interface CleanItem {
    name: string;
    product: string;
    product_key: string;
    category: string;
    quantity: number;
    unit_price: number | null;
    line_total: number;
}

/** Validates receipt lines from the AI or from the app; drops what cannot be a line. */
export const cleanItems = (raw: unknown, itemCategories: string[]): CleanItem[] => {
    if (!Array.isArray(raw)) return [];
    const items: CleanItem[] = [];
    for (const entry of raw.slice(0, MAX_ITEMS)) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        const name = text(e.name, 200);
        if (!name) continue;

        let quantity = num(e.quantity);
        if (quantity === null || quantity <= 0 || quantity > 100_000) quantity = 1;
        let unitPrice = num(e.unit_price);
        if (unitPrice !== null && (unitPrice < 0 || unitPrice > MAX_TOTAL)) unitPrice = null;
        let lineTotal = num(e.line_total);
        if (lineTotal === null && unitPrice !== null) lineTotal = quantity * unitPrice;
        if (lineTotal === null || Math.abs(lineTotal) > MAX_TOTAL) continue;

        const product = text(e.product, 120) || name.slice(0, 120);
        items.push({
            name,
            product,
            product_key: productKey(product) || productKey(name) || 'produit',
            category: pickCategory(e.category, itemCategories),
            quantity: Math.round(quantity * 1000) / 1000,
            unit_price: unitPrice === null ? null : round2(unitPrice),
            line_total: round2(lineTotal),
        });
    }
    return items;
};

const monthBounds = (month: string) => {
    const [y, m] = month.split('-').map(Number);
    const iso = (year: number, mon: number) => `${year}-${String(mon).padStart(2, '0')}-01`;
    const shift = (delta: number) => {
        const d = new Date(Date.UTC(y, m - 1 + delta, 1));
        return { year: d.getUTCFullYear(), mon: d.getUTCMonth() + 1 };
    };
    const prev = shift(-1);
    const next = shift(1);
    return {
        start: iso(y, m),
        next: iso(next.year, next.mon),
        prevStart: iso(prev.year, prev.mon),
        prevMonth: `${prev.year}-${String(prev.mon).padStart(2, '0')}`,
        trendStart: (() => { const t = shift(-5); return iso(t.year, t.mon); })(),
    };
};

const currentMonth = () => new Date().toISOString().slice(0, 7);
const readMonth = (value: unknown): string | null => {
    if (value === undefined || value === '') return currentMonth();
    return typeof value === 'string' && MONTH_PATTERN.test(value) ? value : null;
};

/** The budget line a purchase writes: store, plus what or how much when known. */
const budgetDescription = (kind: Kind, store: string, note: string | null, kwh: number | null): string => {
    if (kind === 'electricity') return kwh !== null ? `${store} · ${kwh} kWh` : store;
    if (kind === 'quick' && note) return `${store} · ${note}`.slice(0, 500);
    return store;
};

interface CleanPurchase {
    kind: Kind;
    store: string;
    purchased_on: string;
    total: number;
    kwh: number | null;
    category: string;
    note: string | null;
    items: CleanItem[];
}

/** Body → purchase, or the error code to answer with. */
const readPurchase = async (ownerId: string, body: unknown): Promise<CleanPurchase | { error: string }> => {
    const b = (body ?? {}) as Record<string, unknown>;
    const kind = KINDS.includes(b.kind as Kind) ? (b.kind as Kind) : null;
    if (!kind) return { error: 'invalid_kind' };

    const store = text(b.store, 60) || (kind === 'electricity' ? 'Woyofal' : '');
    if (!store) return { error: 'missing_store' };

    const purchasedOn = validDate(b.purchased_on);
    if (!purchasedOn) return { error: 'invalid_date' };

    const total = num(b.total);
    if (total === null || total < 0 || total > MAX_TOTAL) return { error: 'invalid_total' };

    let kwh: number | null = null;
    if (kind === 'electricity' && b.kwh !== undefined && b.kwh !== null && b.kwh !== '') {
        kwh = num(b.kwh);
        if (kwh === null || kwh < 0 || kwh > 1_000_000) return { error: 'invalid_kwh' };
        kwh = round2(kwh);
    }

    const categories = await getFamilyCategories(ownerId);
    const category = text(b.category, 50);
    if (!categories.budget.includes(category)) return { error: 'invalid_category' };

    const note = text(b.note, 300) || null;
    const items = kind === 'receipt' ? cleanItems(b.items, categories.shopping) : [];

    return { kind, store, purchased_on: purchasedOn, total: round2(total), kwh, category, note, items };
};

const insertItems = async (client: PoolClient, purchaseId: string, items: CleanItem[]) => {
    if (items.length === 0) return;
    const values: unknown[] = [];
    const rows = items.map((item, index) => {
        const base = values.length;
        values.push(purchaseId, index, item.name, item.product, item.product_key, item.category,
            item.quantity, item.unit_price, item.line_total);
        return `(${Array.from({ length: 9 }, (_, i) => `$${base + i + 1}`).join(', ')})`;
    });
    await client.query(
        `INSERT INTO purchase_items (purchase_id, position, name, product, product_key, category, quantity, unit_price, line_total)
         VALUES ${rows.join(', ')}`,
        values
    );
};

const PURCHASE_COLUMNS = `p.id, p.kind, p.store, to_char(p.purchased_on, 'YYYY-MM-DD') AS purchased_on,
    p.total::float8 AS total, p.kwh::float8 AS kwh, p.category, p.note, p.budget_entry_id, p.created_at,
    p.paid, to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on, p.bought_by`;

const loadPurchase = async (ownerId: string, id: string) => {
    const result = await query(
        `SELECT ${PURCHASE_COLUMNS}, u.name AS created_by_name
         FROM purchases p LEFT JOIN users u ON u.id = p.created_by
         WHERE p.id = $1 AND p.user_id = $2`,
        [id, ownerId]
    );
    const purchase = result.rows[0];
    if (!purchase) return null;
    const items = await query(
        `SELECT id, position, name, product, category, quantity::float8 AS quantity,
                unit_price::float8 AS unit_price, line_total::float8 AS line_total
         FROM purchase_items WHERE purchase_id = $1 ORDER BY position`,
        [id]
    );
    return { ...purchase, items: items.rows };
};

// ─── Reading a receipt photo ─────────────────────────────────────────────────

const RECEIPT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['store', 'date', 'total', 'items'],
    properties: {
        store: { type: 'string' },
        date: { type: 'string' },
        total: { type: 'number' },
        items: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'product', 'category', 'quantity', 'unit_price', 'line_total'],
                properties: {
                    name: { type: 'string' },
                    product: { type: 'string' },
                    category: { type: 'string' },
                    quantity: { type: 'number' },
                    unit_price: { type: 'number' },
                    line_total: { type: 'number' },
                },
            },
        },
    },
};

const receiptPrompt = (categories: string[], knownProducts: string[]) => `Tu lis des tickets de caisse photographiés au Sénégal (souvent Auchan, aussi d'autres magasins).
Montants en francs CFA (XOF), sans décimales en général ; un espace ou un point peut séparer les milliers (1 500 = 1500).
Réponds uniquement avec le JSON demandé :
- store : le nom du magasin tel qu'imprimé (ex. « Auchan »), sans l'adresse ;
- date : la date d'achat au format AAAA-MM-JJ (les tickets l'impriment en JJ/MM/AAAA), ou "" si illisible ;
- total : le montant total payé (« TOTAL », « NET A PAYER »), 0 si illisible ;
- items : une entrée par ligne d'article, dans l'ordre du ticket :
  - name : le libellé tel qu'imprimé ;
  - product : un nom de produit court et générique en français, sans marque ni contenance quand ce n'est pas utile pour comparer (ex. « Riz parfumé », « Lait concentré », « Huile », « Savon »)${knownProducts.length
    ? ` ; quand l'article est l'un des produits que la famille note sur ses listes de courses, reprends exactement leur nom : ${knownProducts.join(', ')}`
    : ''} ;
  - category : une de ces catégories exactement : ${categories.join(', ')} ;
  - quantity : la quantité ou le poids (1 si non indiqué) ;
  - unit_price : le prix unitaire (0 si non indiqué) ;
  - line_total : le montant de la ligne. Une remise ou un bon de réduction est une ligne à montant négatif.
N'invente rien : ignore les lignes de paiement, de rendu monnaie, de TVA et les en-têtes. Si la photo n'est pas un ticket de caisse, renvoie items vide et total 0.`;

// POST /scan: photo(s) of one receipt → a draft to check. Nothing is saved.
// Parsed here, after authentication, with a limit sized for phone pictures.
router.post('/scan', requireParent, express.json({ limit: '20mb' }), async (req: AuthRequest, res) => {
    try {
        const rawImages = (req.body ?? {}).images;
        if (!Array.isArray(rawImages) || rawImages.length === 0 || rawImages.length > MAX_IMAGES) {
            return res.status(400).json({ success: false, error: 'invalid_images' });
        }
        const images = [];
        for (const image of rawImages) {
            const mediaType = typeof image?.mediaType === 'string' ? image.mediaType : '';
            const data = typeof image?.data === 'string' ? image.data.replace(/^data:[^;]+;base64,/, '') : '';
            if (!IMAGE_TYPES.has(mediaType) || !data || data.length > MAX_IMAGE_BASE64 || !/^[A-Za-z0-9+/=\s]+$/.test(data)) {
                return res.status(400).json({ success: false, error: 'invalid_images' });
            }
            images.push({ mediaType: mediaType as 'image/jpeg' | 'image/png' | 'image/webp', data: data.replace(/\s/g, '') });
        }

        const settings = await requireConfiguredAi(req, res);
        if (!settings) return;

        const categories = await getFamilyCategories(req.userId!);
        // The market aisle is for the shopping list, not for receipt lines.
        const aisles = categories.shopping.filter((c) => c !== MARKET_CATEGORY);
        // The names the household writes on its lists, so a receipt line reads
        // "Huile" when the list says "Huile" and both can be compared.
        const known = await query(
            `SELECT (array_agg(name ORDER BY month DESC))[1] AS name
             FROM monthly_list_items WHERE user_id = $1
             GROUP BY product_key ORDER BY COUNT(*) DESC, MAX(month) DESC LIMIT 150`,
            [req.userId]
        );
        const knownProducts = (known.rows as Array<{ name: string }>).map((r) => r.name.replace(/[,;]/g, ' ').trim()).filter(Boolean);
        const raw = await aiComplete(settings, {
            system: receiptPrompt(aisles, knownProducts),
            user: images.length > 1
                ? `Voici les ${images.length} photos d'un même ticket, dans l'ordre. Lis-le en entier.`
                : 'Voici la photo du ticket.',
            jsonSchema: RECEIPT_SCHEMA,
            images,
            maxTokens: 8192,
        });

        const items = cleanItems(raw.items, aisles);
        const printedTotal = num(raw.total);
        const linesTotal = round2(items.reduce((sum, item) => sum + item.line_total, 0));
        const total = printedTotal !== null && printedTotal > 0 && printedTotal <= MAX_TOTAL ? round2(printedTotal) : linesTotal;

        return res.json({
            success: true,
            data: {
                store: text(raw.store, 60),
                purchased_on: validDate(raw.date),
                total,
                lines_total: linesTotal,
                // The printed total and the sum of the lines should agree; when
                // they do not, a line was misread or skipped: the app says so.
                totals_match: Math.abs(total - linesTotal) <= Math.max(1, total * 0.005),
                items: items.map(({ product_key: _key, ...item }) => item),
            },
        });
    } catch (error) {
        return handleAiError(res, error, 'purchase_scan');
    }
});

// ─── CRUD ────────────────────────────────────────────────────────────────────

// GET / — one month of purchases, newest first.
router.get('/', async (req: AuthRequest, res) => {
    const month = readMonth(req.query.month);
    if (!month) return res.status(400).json({ success: false, error: 'invalid_month' });
    const { start, next } = monthBounds(month);
    try {
        const result = await query(
            `SELECT ${PURCHASE_COLUMNS},
                    (SELECT COUNT(*)::int FROM purchase_items i WHERE i.purchase_id = p.id) AS item_count
             FROM purchases p
             WHERE p.user_id = $1 AND p.purchased_on >= $2 AND p.purchased_on < $3
             ORDER BY p.purchased_on DESC, p.created_at DESC`,
            [req.userId, start, next]
        );
        return res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('List purchases error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /analysis — a month next to the previous one, plus a six-month trend.
router.get('/analysis', async (req: AuthRequest, res) => {
    const month = readMonth(req.query.month);
    if (!month) return res.status(400).json({ success: false, error: 'invalid_month' });
    try {
        return res.json({ success: true, data: await analyse(req.userId!, month) });
    } catch (error) {
        console.error('Purchases analysis error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /combined — every household of a person who runs several, side by side.
router.get('/combined', async (req: AuthRequest, res) => {
    const month = readMonth(req.query.month);
    if (!month) return res.status(400).json({ success: false, error: 'invalid_month' });
    try {
        const group = await query(
            `SELECT la.user_id, la.label, COALESCE(u.family_owner_id, u.id) AS scope, o.name AS owner_name, la.created_at
             FROM linked_accounts la
             JOIN users u ON u.id = la.user_id
             JOIN users o ON o.id = COALESCE(u.family_owner_id, u.id)
             WHERE la.group_id = (SELECT group_id FROM linked_accounts WHERE user_id = $1)
             ORDER BY la.created_at`,
            [req.actualUserId]
        );
        if (group.rows.length < 2) {
            return res.status(403).json({ success: false, error: 'not_linked' });
        }

        const seen = new Set<string>();
        const households = [];
        for (const row of group.rows as Array<{ user_id: string; label: string | null; scope: string; owner_name: string }>) {
            if (seen.has(row.scope)) continue;
            seen.add(row.scope);
            const analysis = await analyse(row.scope, month);
            households.push({
                id: row.user_id,
                label: row.label,
                owner_name: row.owner_name,
                is_current: row.scope === req.userId,
                month: analysis.month,
                previous: analysis.previous,
                stores: analysis.stores,
                electricity: analysis.electricity.summary,
            });
        }
        return res.json({ success: true, data: { month, households } });
    } catch (error) {
        console.error('Combined purchases error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ─── Corner shop ("Boutique") ───────────────────────────────────────────────
//
// The small things bought almost every day at the corner shop (bread,
// pepper, charcoal…), by the lady of the house or the maid, often on credit
// and paid later. They are quick purchases at the store "Boutique", with who
// bought them and whether they are paid yet.

const BOUTIQUE = 'Boutique';
const isBoutique = `p.kind = 'quick' AND LOWER(p.store) = 'boutique'`;

/** Budget category of a corner-shop product: food unless it obviously is not. */
const boutiqueCategory = (what: string, budget: string[]): string => {
    const has = (c: string) => budget.find((b) => b.toLowerCase() === c.toLowerCase());
    const aisle = guessAisle(productKey(what), ['Alimentation', 'Menage', 'Bebe', 'Sante']);
    const wanted = aisle === 'Menage' ? has('Maison') : aisle === 'Bebe' ? has('Enfants') : aisle === 'Sante' ? has('Santé') : undefined;
    return wanted ?? has('Alimentation') ?? budget.find((b) => b === 'Autre') ?? budget[0] ?? 'Autre';
};

// GET /boutique?month=YYYY-MM — the month's corner-shop purchases, what is
// still owed (all months), and what is bought most (for one-tap entry).
router.get('/boutique', async (req: AuthRequest, res) => {
    try {
        const month = typeof req.query.month === 'string' && MONTH_PATTERN.test(req.query.month) ? req.query.month : null;
        if (!month) return res.status(400).json({ success: false, error: 'invalid_month' });
        const { start, next } = monthBounds(month);
        const [items, unpaid, recent] = await Promise.all([
            query(
                `SELECT p.id, p.note AS what, p.total::float8 AS total, to_char(p.purchased_on, 'YYYY-MM-DD') AS purchased_on,
                        p.paid, to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on, p.bought_by
                 FROM purchases p
                 WHERE p.user_id = $1 AND ${isBoutique} AND p.purchased_on >= $2 AND p.purchased_on < $3
                 ORDER BY p.purchased_on DESC, p.created_at DESC`,
                [req.userId, start, next]
            ),
            query(
                `SELECT COALESCE(SUM(p.total), 0)::float8 AS total, COUNT(*)::int AS count,
                        to_char(MIN(p.purchased_on), 'YYYY-MM-DD') AS since
                 FROM purchases p WHERE p.user_id = $1 AND ${isBoutique} AND NOT p.paid`,
                [req.userId]
            ),
            query(
                `SELECT p.note AS what, p.total::float8 AS total
                 FROM purchases p
                 WHERE p.user_id = $1 AND ${isBoutique} AND p.note IS NOT NULL
                   AND p.purchased_on >= CURRENT_DATE - 60
                 ORDER BY p.purchased_on DESC, p.created_at DESC LIMIT 500`,
                [req.userId]
            ),
        ]);

        // Most bought first, each with its last name and price.
        const frequent = new Map<string, { what: string; price: number; count: number }>();
        for (const row of recent.rows as Array<{ what: string; total: number }>) {
            const key = productKey(row.what);
            if (!key) continue;
            const entry = frequent.get(key);
            if (entry) entry.count += 1;
            else frequent.set(key, { what: row.what, price: row.total, count: 1 });
        }

        const list = items.rows as Array<{ total: number }>;
        return res.json({
            success: true,
            data: {
                month,
                items: items.rows,
                month_total: round2(list.reduce((sum, i) => sum + i.total, 0)),
                unpaid: unpaid.rows[0],
                frequent: [...frequent.values()].sort((a, b) => b.count - a.count).slice(0, 8),
            },
        });
    } catch (error) {
        console.error('Boutique list error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /boutique { what, total, paid?, bought_by?, purchased_on? }
router.post('/boutique', requireParent, async (req: AuthRequest, res) => {
    try {
        const what = text(req.body?.what, 120);
        if (!what) return res.status(400).json({ success: false, error: 'missing_what' });
        const categories = await getFamilyCategories(req.userId!);
        const p = await readPurchase(req.userId!, {
            kind: 'quick',
            store: BOUTIQUE,
            purchased_on: req.body?.purchased_on,
            total: req.body?.total,
            category: boutiqueCategory(what, categories.budget),
            note: what,
        });
        if ('error' in p) return res.status(400).json({ success: false, error: p.error });
        const id = await createPurchase(req.userId!, req.actualUserId!, p, {
            paid: req.body?.paid !== false,
            boughtBy: text(req.body?.bought_by, 40) || null,
        });
        broadcast(req.userId!, { type: 'update', entity: 'budget', action: 'created' });
        return res.json({ success: true, data: await loadPurchase(req.userId!, id) });
    } catch (error) {
        console.error('Boutique add error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /boutique/settle — the corner-shop tab is paid: everything owed is.
router.post('/boutique/settle', requireParent, async (req: AuthRequest, res) => {
    try {
        const result = await query(
            `UPDATE purchases p SET paid = true, paid_on = CURRENT_DATE, updated_at = now()
             WHERE p.user_id = $1 AND ${isBoutique} AND NOT p.paid
             RETURNING p.total::float8 AS total`,
            [req.userId]
        );
        const rows = result.rows as Array<{ total: number }>;
        broadcast(req.userId!, { type: 'update', entity: 'budget', action: 'updated' });
        return res.json({ success: true, data: { count: rows.length, total: round2(rows.reduce((s, r) => s + r.total, 0)) } });
    } catch (error) {
        console.error('Boutique settle error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// PUT /:id/paid { paid } — one purchase paid, or back on credit.
router.put('/:id/paid', requireParent, async (req: AuthRequest, res) => {
    if (!UUID_PATTERN.test(req.params.id)) return res.status(404).json({ success: false, error: 'not_found' });
    try {
        const paid = req.body?.paid === true;
        const result = await query(
            `UPDATE purchases SET paid = $1, paid_on = CASE WHEN $1 THEN CURRENT_DATE ELSE NULL END, updated_at = now()
             WHERE id = $2 AND user_id = $3 RETURNING id`,
            [paid, req.params.id, req.userId]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'not_found' });
        broadcast(req.userId!, { type: 'update', entity: 'budget', action: 'updated' });
        return res.json({ success: true, data: await loadPurchase(req.userId!, req.params.id) });
    } catch (error) {
        console.error('Purchase paid error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /:id — one purchase with its lines.
router.get('/:id', async (req: AuthRequest, res) => {
    if (!UUID_PATTERN.test(req.params.id)) return res.status(404).json({ success: false, error: 'not_found' });
    try {
        const purchase = await loadPurchase(req.userId!, req.params.id);
        if (!purchase) return res.status(404).json({ success: false, error: 'not_found' });
        return res.json({ success: true, data: purchase });
    } catch (error) {
        console.error('Get purchase error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * Saves a purchase and its budget entry in one transaction; returns its id.
 * `credit` is for the corner shop: bought now, paid later, by whom.
 */
const createPurchase = async (
    ownerId: string,
    actualUserId: string,
    p: CleanPurchase,
    credit: { paid: boolean; boughtBy: string | null } = { paid: true, boughtBy: null }
): Promise<string> => {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        const entry = await client.query(
            `INSERT INTO budget_entries (user_id, category, amount, description, date, is_expense)
             VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
            [ownerId, p.category, p.total, budgetDescription(p.kind, p.store, p.note, p.kwh), p.purchased_on]
        );
        const created = await client.query(
            `INSERT INTO purchases (user_id, kind, store, purchased_on, total, kwh, category, note, budget_entry_id, created_by,
                                    paid, paid_on, bought_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $11 THEN $4::date ELSE NULL END, $12) RETURNING id`,
            [ownerId, p.kind, p.store, p.purchased_on, p.total, p.kwh, p.category, p.note, entry.rows[0].id, actualUserId,
                credit.paid, credit.boughtBy]
        );
        const id = created.rows[0].id as string;
        await insertItems(client, id, p.items);
        await client.query('COMMIT');
        return id;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
};

// POST / — save a purchase (and its budget entry) in one transaction.
router.post('/', requireParent, async (req: AuthRequest, res) => {
    try {
        const p = await readPurchase(req.userId!, req.body);
        if ('error' in p) return res.status(400).json({ success: false, error: p.error });
        const id = await createPurchase(req.userId!, req.actualUserId!, p);
        broadcast(req.userId!, { type: 'update', entity: 'budget', action: 'created' });
        return res.json({ success: true, data: await loadPurchase(req.userId!, id) });
    } catch (error) {
        console.error('Create purchase error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// PUT /:id — replace a purchase (lines included) and its budget entry.
router.put('/:id', requireParent, async (req: AuthRequest, res) => {
    if (!UUID_PATTERN.test(req.params.id)) return res.status(404).json({ success: false, error: 'not_found' });
    try {
        const p = await readPurchase(req.userId!, req.body);
        if ('error' in p) return res.status(400).json({ success: false, error: p.error });

        const client = await getClient();
        try {
            await client.query('BEGIN');
            const existing = await client.query(
                'SELECT budget_entry_id FROM purchases WHERE id = $1 AND user_id = $2 FOR UPDATE',
                [req.params.id, req.userId]
            );
            if (existing.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'not_found' });
            }
            const description = budgetDescription(p.kind, p.store, p.note, p.kwh);
            let entryId = existing.rows[0].budget_entry_id as string | null;
            const updated = entryId
                ? await client.query(
                      `UPDATE budget_entries SET category = $1, amount = $2, description = $3, date = $4
                       WHERE id = $5 AND user_id = $6 RETURNING id`,
                      [p.category, p.total, description, p.purchased_on, entryId, req.userId]
                  )
                : { rows: [] as unknown[] };
            if (updated.rows.length === 0) {
                // Deleted from the Budget page in the meantime: write it again.
                entryId = (await client.query(
                    `INSERT INTO budget_entries (user_id, category, amount, description, date, is_expense)
                     VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
                    [req.userId, p.category, p.total, description, p.purchased_on]
                )).rows[0].id;
            }
            await client.query(
                `UPDATE purchases SET kind = $1, store = $2, purchased_on = $3, total = $4, kwh = $5,
                        category = $6, note = $7, budget_entry_id = $8, updated_at = now()
                 WHERE id = $9 AND user_id = $10`,
                [p.kind, p.store, p.purchased_on, p.total, p.kwh, p.category, p.note, entryId, req.params.id, req.userId]
            );
            await client.query('DELETE FROM purchase_items WHERE purchase_id = $1', [req.params.id]);
            await insertItems(client, req.params.id, p.items);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }

        broadcast(req.userId!, { type: 'update', entity: 'budget', action: 'updated' });
        return res.json({ success: true, data: await loadPurchase(req.userId!, req.params.id) });
    } catch (error) {
        console.error('Update purchase error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// DELETE /:id — the purchase, its lines and its budget entry.
router.delete('/:id', requireParent, async (req: AuthRequest, res) => {
    if (!UUID_PATTERN.test(req.params.id)) return res.status(404).json({ success: false, error: 'not_found' });
    try {
        const removed = await query(
            'DELETE FROM purchases WHERE id = $1 AND user_id = $2 RETURNING budget_entry_id',
            [req.params.id, req.userId]
        );
        if (removed.rows.length === 0) return res.status(404).json({ success: false, error: 'not_found' });
        const entryId = removed.rows[0].budget_entry_id as string | null;
        if (entryId) {
            await query('DELETE FROM budget_entries WHERE id = $1 AND user_id = $2', [entryId, req.userId]);
        }
        broadcast(req.userId!, { type: 'update', entity: 'budget', action: 'deleted' });
        return res.json({ success: true });
    } catch (error) {
        console.error('Delete purchase error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ─── Analysis ────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const byMonth = (rows: Row[], month: string) => rows.filter((r) => r.month === month);
const sum = (rows: Row[], field = 'total') => round2(rows.reduce((s, r) => s + Number(r[field] ?? 0), 0));

/** One household's month next to the previous month. */
export async function analyse(ownerId: string, month: string) {
    const { start, next, prevStart, prevMonth, trendStart } = monthBounds(month);
    const MONTH = `to_char(p.purchased_on, 'YYYY-MM')`;

    const [stores, categories, aisles, products, electricity, smallShops, trend] = await Promise.all([
        query(
            `SELECT ${MONTH} AS month, p.store, p.kind, SUM(p.total)::float8 AS total, COUNT(*)::int AS count
             FROM purchases p WHERE p.user_id = $1 AND p.purchased_on >= $2 AND p.purchased_on < $3
             GROUP BY 1, 2, 3`,
            [ownerId, prevStart, next]
        ),
        query(
            `SELECT ${MONTH} AS month, p.category, SUM(p.total)::float8 AS total
             FROM purchases p WHERE p.user_id = $1 AND p.purchased_on >= $2 AND p.purchased_on < $3
             GROUP BY 1, 2`,
            [ownerId, prevStart, next]
        ),
        query(
            `SELECT ${MONTH} AS month, i.category, SUM(i.line_total)::float8 AS total
             FROM purchase_items i JOIN purchases p ON p.id = i.purchase_id
             WHERE p.user_id = $1 AND p.purchased_on >= $2 AND p.purchased_on < $3
             GROUP BY 1, 2`,
            [ownerId, prevStart, next]
        ),
        query(
            `SELECT ${MONTH} AS month, i.product_key,
                    (array_agg(i.product ORDER BY p.purchased_on DESC))[1] AS product,
                    SUM(i.quantity)::float8 AS quantity, SUM(i.line_total)::float8 AS total,
                    COUNT(DISTINCT p.id)::int AS purchases
             FROM purchase_items i JOIN purchases p ON p.id = i.purchase_id
             WHERE p.user_id = $1 AND p.purchased_on >= $2 AND p.purchased_on < $3 AND i.line_total > 0
             GROUP BY 1, 2`,
            [ownerId, prevStart, next]
        ),
        query(
            `SELECT ${MONTH} AS month, p.id, to_char(p.purchased_on, 'YYYY-MM-DD') AS date,
                    p.total::float8 AS total, p.kwh::float8 AS kwh
             FROM purchases p
             WHERE p.user_id = $1 AND p.kind = 'electricity' AND p.purchased_on >= $2 AND p.purchased_on < $3
             ORDER BY p.purchased_on`,
            [ownerId, prevStart, next]
        ),
        query(
            `SELECT p.store, COALESCE(NULLIF(lower(p.note), ''), '') AS what,
                    (array_agg(p.note ORDER BY p.purchased_on DESC))[1] AS label,
                    COUNT(*)::int AS count, SUM(p.total)::float8 AS total
             FROM purchases p
             WHERE p.user_id = $1 AND p.kind = 'quick' AND p.purchased_on >= $2 AND p.purchased_on < $3
             GROUP BY 1, 2
             ORDER BY total DESC`,
            [ownerId, start, next]
        ),
        query(
            `SELECT ${MONTH} AS month, p.kind, SUM(p.total)::float8 AS total, SUM(COALESCE(p.kwh, 0))::float8 AS kwh
             FROM purchases p WHERE p.user_id = $1 AND p.purchased_on >= $2 AND p.purchased_on < $3
             GROUP BY 1, 2`,
            [ownerId, trendStart, next]
        ),
    ]);

    // Side by side: this month and the previous one, keyed by name.
    const pair = (rows: Row[], key: string) => {
        const names = new Set(rows.map((r) => String(r[key])));
        return [...names]
            .map((name) => ({
                name,
                total: sum(byMonth(rows, month).filter((r) => String(r[key]) === name)),
                previous: sum(byMonth(rows, prevMonth).filter((r) => String(r[key]) === name)),
            }))
            .filter((r) => r.total !== 0 || r.previous !== 0)
            .sort((a, b) => b.total - a.total || b.previous - a.previous);
    };

    const storeRows = stores.rows as Row[];
    const kindTotal = (m: string, kind: Kind) => sum(byMonth(storeRows, m).filter((r) => r.kind === kind));
    const totals = (m: string) => ({
        total: sum(byMonth(storeRows, m)),
        receipts: kindTotal(m, 'receipt'),
        quick: kindTotal(m, 'quick'),
        electricity: kindTotal(m, 'electricity'),
        count: byMonth(storeRows, m).reduce((s, r) => s + Number(r.count), 0),
    });

    const productRows = products.rows as Row[];
    const productList = [...new Set(productRows.map((r) => String(r.product_key)))]
        .map((key) => {
            const now = byMonth(productRows, month).find((r) => r.product_key === key);
            const before = byMonth(productRows, prevMonth).find((r) => r.product_key === key);
            const avg = (r?: Row) => (r && Number(r.quantity) > 0 ? round2(Number(r.total) / Number(r.quantity)) : null);
            return {
                product: String((now ?? before)!.product),
                quantity: now ? Number(now.quantity) : 0,
                total: now ? round2(Number(now.total)) : 0,
                purchases: now ? Number(now.purchases) : 0,
                avg_price: avg(now),
                previous_quantity: before ? Number(before.quantity) : 0,
                previous_total: before ? round2(Number(before.total)) : 0,
                previous_avg_price: avg(before),
            };
        })
        .filter((p) => p.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 30);

    const elecRows = electricity.rows as Row[];
    const elecSummary = (m: string) => {
        const rows = byMonth(elecRows, m);
        const amount = sum(rows);
        const kwh = round2(rows.reduce((s, r) => s + Number(r.kwh ?? 0), 0));
        // Price per kWh only from top-ups whose kWh are known.
        const priced = rows.filter((r) => Number(r.kwh ?? 0) > 0);
        const pricedAmount = sum(priced);
        const pricedKwh = priced.reduce((s, r) => s + Number(r.kwh), 0);
        return { amount, kwh, count: rows.length, price_per_kwh: pricedKwh > 0 ? round2(pricedAmount / pricedKwh) : null };
    };

    const trendRows = trend.rows as Row[];
    const trendMonths: string[] = [];
    {
        const [y, m] = month.split('-').map(Number);
        for (let i = 5; i >= 0; i--) {
            const d = new Date(Date.UTC(y, m - 1 - i, 1));
            trendMonths.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
        }
    }

    return {
        month: { id: month, ...totals(month) },
        previous: { id: prevMonth, ...totals(prevMonth) },
        stores: pair(storeRows, 'store'),
        categories: pair(categories.rows as Row[], 'category'),
        aisles: pair(aisles.rows as Row[], 'category'),
        products: productList,
        electricity: {
            summary: { month: elecSummary(month), previous: elecSummary(prevMonth) },
            top_ups: byMonth(elecRows, month).map((r) => ({ id: r.id, date: r.date, total: Number(r.total), kwh: r.kwh === null ? null : Number(r.kwh) })),
        },
        small_shops: (smallShops.rows as Row[]).map((r) => ({
            store: String(r.store),
            what: r.label ? String(r.label) : '',
            count: Number(r.count),
            total: round2(Number(r.total)),
        })),
        trend: trendMonths.map((m) => {
            const rows = byMonth(trendRows, m);
            return {
                month: m,
                total: sum(rows),
                receipts: sum(rows.filter((r) => r.kind === 'receipt')),
                quick: sum(rows.filter((r) => r.kind === 'quick')),
                electricity: sum(rows.filter((r) => r.kind === 'electricity')),
                kwh: round2(rows.reduce((s, r) => s + Number(r.kwh ?? 0), 0)),
            };
        }),
    };
}

export default router;
