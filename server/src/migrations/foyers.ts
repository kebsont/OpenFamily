// Migrations of the "foyers" fork (several households under one account).
//
// Kept apart from coreMigrations so upstream releases merge without conflicts:
// upstream appends to registry.ts, this fork appends here. Same rules as
// registry.ts: append only, never edit or reuse an id once it has run.

import type { Migration } from './runner';

export const foyersMigrations: readonly Migration[] = [
    {
        // Linked accounts: a person who owns (or belongs to) several households
        // links their accounts once, by proving they know each password, and
        // then switches between them in one tap. Accounts that share a group_id
        // can switch to one another; nobody else gains any access. label is the
        // name this person gives each household in the switcher ("Second house").
        id: 'foyers/0001-linked-accounts',
        statements: [
            `CREATE TABLE linked_accounts (
                user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                group_id UUID NOT NULL,
                label VARCHAR(60),
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )`,
            'CREATE INDEX idx_linked_accounts_group ON linked_accounts(group_id)',
        ],
    },
    {
        // One login for several households. A household created from the
        // switcher is owned by a "managed" account: it has no usable password
        // and a placeholder e-mail, so it can only be opened by switching from
        // the account in managed_by. To its members it shows that person's
        // name, photo and e-mail.
        id: 'foyers/0002-managed-households',
        statements: [
            'ALTER TABLE linked_accounts ADD COLUMN managed_by UUID REFERENCES users(id) ON DELETE SET NULL',
            'CREATE INDEX idx_linked_accounts_managed_by ON linked_accounts(managed_by)',
        ],
    },
    {
        // Purchases: what the family actually bought, where and for how much.
        // A till receipt keeps its lines (read from a photo, then checked), so
        // spending, quantities and prices can be compared month to month. Small
        // expenses (corner shop, DIY) and prepaid electricity top-ups (amount
        // and kWh) are purchases too. Each purchase also writes one budget
        // entry (budget_entry_id), so the Budget page stays complete without
        // typing anything twice.
        id: 'foyers/0003-purchases',
        statements: [
            `CREATE TABLE purchases (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                kind VARCHAR(20) NOT NULL CHECK (kind IN ('receipt', 'quick', 'electricity')),
                store VARCHAR(60) NOT NULL,
                purchased_on DATE NOT NULL,
                total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
                kwh NUMERIC(10, 2) CHECK (kwh IS NULL OR kwh >= 0),
                category VARCHAR(50) NOT NULL,
                note TEXT,
                budget_entry_id UUID REFERENCES budget_entries(id) ON DELETE SET NULL,
                created_by UUID REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )`,
            'CREATE INDEX idx_purchases_user_date ON purchases(user_id, purchased_on)',
            `CREATE TABLE purchase_items (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
                position INTEGER NOT NULL DEFAULT 0,
                name VARCHAR(200) NOT NULL,
                product VARCHAR(120) NOT NULL,
                product_key VARCHAR(120) NOT NULL,
                category VARCHAR(50) NOT NULL,
                quantity NUMERIC(10, 3) NOT NULL DEFAULT 1,
                unit_price NUMERIC(12, 2),
                line_total NUMERIC(12, 2) NOT NULL
            )`,
            'CREATE INDEX idx_purchase_items_purchase ON purchase_items(purchase_id)',
            'CREATE INDEX idx_purchase_items_product ON purchase_items(product_key)',
        ],
    },
    {
        // Monthly lists: each month's big shopping list (applied from the app
        // or pasted from older notes), the history the next month's list is
        // suggested from. product_places remembers, per household, whether a
        // product is bought at the supermarket or at the market.
        id: 'foyers/0004-monthly-lists',
        statements: [
            `CREATE TABLE monthly_list_items (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                month DATE NOT NULL,
                name VARCHAR(120) NOT NULL,
                product_key VARCHAR(120) NOT NULL,
                quantity NUMERIC(10, 2),
                detail VARCHAR(200),
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (user_id, month, product_key)
            )`,
            `CREATE TABLE product_places (
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                product_key VARCHAR(120) NOT NULL,
                place VARCHAR(10) NOT NULL CHECK (place IN ('store', 'market')),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (user_id, product_key)
            )`,
        ],
    },
    {
        // Households created before the internal address was renamed get the
        // neutral form too (account-<id>@accounts.invalid). Nobody signs in
        // with it; it is never shown, but it no longer says what it is for.
        id: 'foyers/0005-neutral-placeholder-emails',
        statements: [
            `UPDATE users SET email = 'account-' || id::text || '@accounts.invalid'
             WHERE email LIKE 'foyer-%@foyers.invalid'`,
        ],
    },
];
