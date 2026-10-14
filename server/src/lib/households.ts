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

/**
 * SQL selecting the family scopes (owner ids) an account may use: its own,
 * plus those of the accounts linked with it. $1 is the account id. Anything a
 * device registered under another scope belongs to someone else.
 */
export const REACHABLE_SCOPES_SQL = `
    SELECT DISTINCT COALESCE(u.family_owner_id, u.id)
    FROM users u
    WHERE u.id = $1
       OR u.id IN (
           SELECT la.user_id FROM linked_accounts la
           WHERE la.group_id = (SELECT group_id FROM linked_accounts WHERE user_id = $1)
       )`;
