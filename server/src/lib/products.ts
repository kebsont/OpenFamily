// Product names as families write them ("Pommes de terre", "Pomme de terres",
// "Œufs", "Tablette œufs", "Huile 3", "Pâtes (tagliatelles)") and as receipts
// print them. productKey() gives every spelling of one product the same key, so
// lists, receipts and small expenses can be compared month after month.

/** Shopping-list aisle for what is bought at the market (created when needed). */
export const MARKET_CATEGORY = 'Marché';

const MONTHS = [
    'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre',
];

// Words that say how a product is packed, not what it is: "Omo sachet" is Omo,
// "Tablette œufs" is eggs, "Crème fraîche liquide" is crème fraîche.
const QUALIFIERS = new Set([
    'sachet', 'tablette', 'paquet', 'boite', 'bouteille', 'carton', 'bidon',
    'liquide', 'enfant', 'et',
]);

const fold = (value: string): string =>
    value
        .toLowerCase()
        .replace(/œ/g, 'oe')
        .replace(/æ/g, 'ae')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');

// Plural to singular, word by word: "lentilles" → "lentille", "oeufs" → "oeuf".
// Words ending in -is/-us/-ss are left alone ("pois", "jus", "anchois").
const singular = (word: string): string =>
    word.length > 3 && /[sx]$/.test(word) && !/(is|us|ss)$/.test(word) ? word.slice(0, -1) : word;

/** Grouping key for "the same product" across lists, receipts and stores. */
export const productKey = (value: string): string =>
    fold(value)
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean)
        .map(singular)
        .filter((word) => !QUALIFIERS.has(word))
        .join(' ')
        .slice(0, 120);

/** "pomme de terre" → "Pomme de terre" (only the first letter changes). */
export const displayName = (value: string): string => {
    const s = value.replace(/\s+/g, ' ').trim();
    return s ? s.charAt(0).toLocaleUpperCase('fr') + s.slice(1) : s;
};

// What the family usually buys at the market rather than the supermarket. Only
// a first guess: the household moves a product once and the app remembers.
const MARKET_HINTS = [
    'poisson', 'viande', 'légumes', 'crevettes', 'fruits', 'poivrons', 'courges', 'courgettes',
    'oignons verts', 'gombo', 'carottes', 'salade', 'aubergines', 'chou', 'manioc', 'patates',
    'piment frais', 'tomates fraîches', 'mouton', 'bœuf', 'yét', 'kéthiakh', 'tamarin',
].map((hint) => productKey(hint));

const startsWithHint = (key: string, hint: string) => key === hint || key.startsWith(`${hint} `);

// Frozen, canned or dried, the same food comes from the supermarket.
const SHELF_WORDS = /\b(surgele|conserve|boite|poudre|concentree?|moulu|seche?)\b/;

export const looksLikeMarket = (key: string): boolean =>
    !SHELF_WORDS.test(key) && MARKET_HINTS.some((hint) => startsWithHint(key, hint));

// Bought fresh every day or so: buying them at the corner shop is normal, the
// monthly run cannot replace it.
const DAILY_FRESH = ['Pain', 'Baguette', 'Lait caillé', 'Lait frais', 'Glace', 'Glaçons', 'Crédit', 'Journal']
    .map((name) => productKey(name));

export const isDailyFresh = (key: string): boolean => DAILY_FRESH.some((fresh) => startsWithHint(key, fresh));

// First guess of the shopping-list aisle when receipts have not told us yet.
const AISLE_HINTS: Array<[string, string[]]> = ([
    ['Menage', [
        'Omo', 'Javel', 'Eau de javel', 'Madar', 'Lessive', 'Lave', 'Désodorisant', 'PQ', 'Papier toilette',
        'Sopalin', 'Éponges', 'Sacs poubelle', 'Insecticide', 'Détergent', 'Liquide vaisselle', 'Savon',
    ]],
    ['Bebe', ['Couches', 'Lingettes', 'Lait infantile']],
    ['Sante', ['Dentifrice', 'Serviettes hygiéniques', 'Pansements', 'Brosse à dents', 'Mouchoirs']],
] as Array<[string, string[]]>).map(([aisle, hints]) => [aisle, hints.map((hint) => productKey(hint))]);

export const guessAisle = (key: string, allowed: string[]): string => {
    const has = (category: string) => allowed.find((c) => fold(c) === fold(category));
    for (const [aisle, hints] of AISLE_HINTS) {
        if (hints.some((hint) => startsWithHint(key, hint) || key.endsWith(` ${hint}`))) {
            const match = has(aisle);
            if (match) return match;
        }
    }
    return has('Alimentation') ?? allowed[0] ?? 'Autre';
};

// ─── Pasted lists ────────────────────────────────────────────────────────────

export interface ListLine {
    name: string;
    key: string;
    quantity: number | null;
    detail: string | null;
}

export interface ParsedList {
    /** First day of the month, YYYY-MM-01; null when the text did not say. */
    month: string | null;
    items: ListLine[];
}

const MAX_LINES_PER_MONTH = 200;

const monthIn = (folded: string): number | null => {
    const words = folded.split(/[^a-z]+/);
    const index = MONTHS.findIndex((m) => words.includes(m));
    return index === -1 ? null : index + 1;
};

/**
 * "Courses du mois de Juillet", "Courses mois d'octobre", "Octobre 2026"…
 * Returns YYYY-MM-01, or null when the line is an item. Without a year, the
 * month is the latest one that is not after `today`.
 */
export const headerMonth = (line: string, today: Date): string | null => {
    if (/^\s*(?:[-*•–]|\[|☐|☑|✅|\d+[.)]\s)/.test(line)) return null;
    const folded = fold(line);
    const month = monthIn(folded);
    if (month === null) return null;
    const words = folded.split(/[^a-z0-9]+/).filter(Boolean);
    const yearMatch = folded.match(/\b(20\d{2})\b/);
    const looksLikeTitle = /\b(mois|courses|liste|achats)\b/.test(folded) || yearMatch !== null || words.length <= 2;
    if (!looksLikeTitle) return null;
    let year = yearMatch ? Number(yearMatch[1]) : today.getUTCFullYear();
    if (!yearMatch && month > today.getUTCMonth() + 1) year -= 1;
    return `${year}-${String(month).padStart(2, '0')}-01`;
};

/** One line of a list → name, quantity and detail ("Pâtes (tagliatelles)"). */
export const parseLine = (raw: string): ListLine | null => {
    let s = raw
        .replace(/^\s*(?:[-*•–]\s*)?(?:\[[^\]]{0,2}\]\s*|[☐☑✅✔✓]\s*)?(?:\d+[.)]\s+)?/, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!s) return null;

    let detail: string | null = null;
    const paren = s.match(/\(([^)]*)\)/);
    if (paren) {
        detail = paren[1].trim() || null;
        s = s.replace(paren[0], ' ').replace(/\s+/g, ' ').trim();
    }
    const colon = s.indexOf(':');
    if (colon > 0) {
        const after = s.slice(colon + 1).trim();
        if (after) detail = detail ? `${after}, ${detail}` : after;
        s = s.slice(0, colon).trim();
    }

    let quantity: number | null = null;
    const trailing = s.match(/\s+(?:[x×]\s*)?(\d+(?:[.,]\d+)?)$/i);
    const leading = s.match(/^(\d+(?:[.,]\d+)?)\s*[x×]?\s+(?=\D)/i);
    if (trailing) {
        quantity = Number(trailing[1].replace(',', '.'));
        s = s.slice(0, trailing.index).trim();
    } else if (leading) {
        quantity = Number(leading[1].replace(',', '.'));
        s = s.slice(leading[0].length).trim();
    }
    if (quantity !== null && !(quantity > 0 && quantity < 1000)) quantity = null;

    const name = displayName(s).slice(0, 120);
    const key = productKey(name);
    if (!key) return null;
    return { name, key, quantity, detail: detail ? detail.slice(0, 200) : null };
};

/**
 * Text pasted from notes or WhatsApp, one or several months, each under a
 * title such as "Courses du mois de Juillet". Lines before any title go to
 * `fallbackMonth` (or are dropped when there is none). The same product twice
 * in one month counts once.
 */
export const parseLists = (text: string, today: Date, fallbackMonth: string | null): ParsedList[] => {
    const lists: ParsedList[] = [];
    let current: ParsedList | null = null;
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const month = headerMonth(line, today);
        if (month) {
            current = lists.find((l) => l.month === month) ?? null;
            if (!current) {
                current = { month, items: [] };
                lists.push(current);
            }
            continue;
        }
        if (!current) {
            current = { month: fallbackMonth, items: [] };
            lists.push(current);
        }
        const item = parseLine(line);
        if (!item || current.items.length >= MAX_LINES_PER_MONTH) continue;
        if (current.items.some((i) => i.key === item.key)) continue;
        current.items.push(item);
    }
    return lists.filter((l) => l.items.length > 0);
};

/** Key of a name as written in the shopping list ("Pâtes (tagliatelles)" → "pate"). */
export const listNameKey = (name: string): string => parseLine(name)?.key ?? productKey(name);
