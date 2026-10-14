// Shared bits of the "foyers" fork (one person, several households).

/**
 * SQL expression for the e-mail to show for a users row. A managed household
 * account (created from the switcher, see routes/linkedAccounts.ts) has a
 * placeholder address; it shows the e-mail of the person who runs it instead.
 * `alias` is how the users table is named in the surrounding query.
 */
export const displayEmailSql = (alias: string): string =>
    `COALESCE((SELECT p.email FROM linked_accounts la JOIN users p ON p.id = la.managed_by WHERE la.user_id = ${alias}.id), ${alias}.email)`;

/** Placeholder domain of managed accounts: reserved (RFC 2606), never deliverable. */
export const MANAGED_EMAIL_DOMAIN = 'accounts.invalid';
