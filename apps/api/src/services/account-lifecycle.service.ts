/* eslint-disable no-control-regex -- These validators intentionally reject control characters in untrusted input. */
import type { PoolClient } from 'pg';
import type { RequestAuthentication } from '../middleware/tenant-context.js';
import { AccessError } from './practice-policy.js';

type Transaction = <T>(
  practiceId: string | null,
  actor: string,
  operation: (client: PoolClient) => Promise<T>,
) => Promise<T>;
export type AccountClosureAction = 'archive' | 'delete';
export type AccountClosureRequest = {
  id: string;
  action: AccountClosureAction;
  status: 'pending';
  requestedAt: string;
};
export type AccountArchiveState = {
  status: 'active' | 'archiving' | 'archived' | 'restoring';
  archiveRequestedAt: string | null;
  archivedAt: string | null;
  restoredAt: string | null;
};
export type PersonalAccountState = {
  account: AccountArchiveState;
  ownedPractices: { id: string; name: string }[];
  closureRequest: AccountClosureRequest | null;
};

export function accountPrincipal(auth: RequestAuthentication) {
  if (
    !auth.isAuthenticated ||
    typeof auth.userId !== 'string' ||
    !/^user_[A-Za-z0-9]+$/.test(auth.userId) ||
    typeof auth.sessionId !== 'string' ||
    !/^sess_[A-Za-z0-9]+$/.test(auth.sessionId)
  ) {
    throw new AccessError('UNAUTHENTICATED', 401, 'Sign in again to continue.');
  }
  return { userId: auth.userId, sessionId: auth.sessionId };
}
export function requireRecentAccountVerification(auth: RequestAuthentication) {
  accountPrincipal(auth);
  const claims = auth.sessionClaims;
  const ages = claims && typeof claims === 'object' && 'fva' in claims ? claims.fva : undefined;
  if (
    !Array.isArray(ages) ||
    typeof ages[0] !== 'number' ||
    !Number.isFinite(ages[0]) ||
    ages[0] < 0 ||
    ages[0] >= 5
  ) {
    throw new AccessError(
      'RECENT_AUTHENTICATION_REQUIRED',
      403,
      'Verify your sign-in again before requesting account closure.',
    );
  }
}
export function parseAccountClosure(input: unknown): {
  action: AccountClosureAction;
  confirmation: string;
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AccessError('INVALID_REQUEST', 400);
  }
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some((key) => !['action', 'confirmation'].includes(key)) ||
    typeof value.action !== 'string' ||
    value.action !== 'delete' ||
    typeof value.confirmation !== 'string' ||
    value.confirmation.length > 7 ||
    /[\u0000-\u001f\u007f]/.test(value.confirmation)
  ) {
    throw new AccessError(
      'INVALID_REQUEST',
      400,
      'Choose an account closure option and check your confirmation.',
    );
  }
  if (!value.confirmation) {
    throw new AccessError(
      'ACCOUNT_CLOSURE_CONFIRMATION_REQUIRED',
      400,
      'Type the confirmation shown before submitting your request.',
    );
  }
  if (value.confirmation !== value.action.toUpperCase()) {
    throw new AccessError(
      'ACCOUNT_CLOSURE_CONFIRMATION_MISMATCH',
      400,
      'Type the confirmation exactly as shown.',
    );
  }
  return { action: value.action as AccountClosureAction, confirmation: value.confirmation };
}
const requestColumns = 'id,action,status,requested_at AS "requestedAt"';
function requestOf(row: Record<string, unknown>): AccountClosureRequest {
  return {
    id: String(row.id),
    action: row.action as AccountClosureAction,
    status: 'pending',
    requestedAt: new Date(String(row.requestedAt)).toISOString(),
  };
}
/** Requests never delete identity, clinical records, memberships or audit history. */
const accountColumns =
  'status,archive_requested_at AS "archiveRequestedAt",archived_at AS "archivedAt",restored_at AS "restoredAt"';
const at = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);
function archiveOf(row?: Record<string, unknown>): AccountArchiveState {
  return {
    status: (row?.status as AccountArchiveState['status']) ?? 'active',
    archiveRequestedAt: at(row?.archiveRequestedAt),
    archivedAt: at(row?.archivedAt),
    restoredAt: at(row?.restoredAt),
  };
}
function validUser(userId: string) {
  if (typeof userId !== 'string' || !/^user_[A-Za-z0-9]+$/.test(userId)) {
    throw new AccessError('ACCOUNT_LIFECYCLE_INVALID_USER', 400);
  }
}
const lockAccount = (client: PoolClient, userId: string) =>
  client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `account-lifecycle:${userId}`,
  ]);
/** Trusted server callers only. Preserve the existing practice/actor context on this same client. */
export async function lockActiveAccount(client: PoolClient, userId: string) {
  validUser(userId);
  await lockAccount(client, userId);
  const previous =
    (await client.query("SELECT current_setting('app.actor_user_id',true) AS actor")).rows[0]
      ?.actor ?? '';
  try {
    await client.query("SELECT set_config('app.actor_user_id',$1,true)", [userId]);
    const row = (
      await client.query('SELECT status FROM personal_account_lifecycle WHERE user_id=$1', [userId])
    ).rows[0];
    if (row && row.status !== 'active') {
      throw new AccessError(
        'ACCOUNT_ARCHIVED',
        403,
        'This account is archived or being archived. Contact support to restore access.',
      );
    }
  } finally {
    await client.query("SELECT set_config('app.actor_user_id',$1,true)", [previous]);
  }
}
export type AccountIdentityProvider = {
  banUser: (userId: string) => Promise<{ id: string; banned: boolean }>;
  unbanUser: (userId: string) => Promise<{ id: string; banned: boolean }>;
};
const identityProvider: AccountIdentityProvider = {
  banUser: async (userId) => (await import('./clerk-directory.js')).clerk.users.banUser(userId),
  unbanUser: async (userId) => (await import('./clerk-directory.js')).clerk.users.unbanUser(userId),
};
/** Archive/unarchive are durable sagas; a provider failure never silently reopens access. */
export function createAccountLifecycleService(
  transaction: Transaction,
  provider: AccountIdentityProvider = identityProvider,
) {
  async function state(auth: RequestAuthentication): Promise<PersonalAccountState> {
    const { userId } = accountPrincipal(auth);
    return transaction(null, userId, async (client) => {
      const owned = await client.query(
        'SELECT id,name FROM practices WHERE owner_user_id=$1 ORDER BY name,id',
        [userId],
      );
      const requests = await client.query(
        `SELECT ${requestColumns} FROM account_closure_requests WHERE actor_user_id=$1 AND status='pending'`,
        [userId],
      );
      const lifecycle = await client.query(
        `SELECT ${accountColumns} FROM personal_account_lifecycle WHERE user_id=$1`,
        [userId],
      );
      return {
        account: archiveOf(lifecycle.rows[0]),
        ownedPractices: owned.rows,
        closureRequest: requests.rows[0] ? requestOf(requests.rows[0]) : null,
      };
    });
  }
  async function requestClosure(
    auth: RequestAuthentication,
    input: unknown,
  ): Promise<AccountClosureRequest> {
    const { userId, sessionId } = accountPrincipal(auth);
    requireRecentAccountVerification(auth);
    const { action } = parseAccountClosure(input);
    return transaction(null, userId, async (client) => {
      // Serialize retries from every session belonging to this actor.
      await lockActiveAccount(client, userId);
      const owned = await client.query(
        'SELECT id FROM practices WHERE owner_user_id=$1 FOR SHARE',
        [userId],
      );
      if (owned.rowCount) {
        throw new AccessError(
          'ACCOUNT_OWNS_PRACTICES',
          409,
          'Transfer ownership of every practice you own before requesting account closure.',
        );
      }
      const pending = await client.query(
        `SELECT ${requestColumns} FROM account_closure_requests WHERE actor_user_id=$1 AND status='pending'`,
        [userId],
      );
      if (pending.rows[0]) {
        if (pending.rows[0].action !== action) {
          throw new AccessError(
            'ACCOUNT_CLOSURE_ALREADY_PENDING',
            409,
            'You already have a pending account closure request. Review it before submitting another.',
          );
        }
        return requestOf(pending.rows[0]);
      }
      const created = await client.query(
        `INSERT INTO account_closure_requests(actor_user_id,requested_session_id,action) VALUES($1,$2,$3) RETURNING ${requestColumns}`,
        [userId, sessionId, action],
      );
      return requestOf(created.rows[0]);
    });
  }
  async function assertUserActive(userId: string) {
    validUser(userId);
    // An ordinary access check must see the committed archiving marker immediately,
    // without waiting behind a slow provider ban holding the coordination lock.
    await transaction(null, userId, async (client) => {
      const current = (
        await client.query('SELECT status FROM personal_account_lifecycle WHERE user_id=$1', [
          userId,
        ])
      ).rows[0];
      if (current && current.status !== 'active') {
        throw new AccessError(
          'ACCOUNT_ARCHIVED',
          403,
          'This account is archived or being archived. Contact support to restore access.',
        );
      }
    });
  }
  async function assertActive(auth: RequestAuthentication) {
    await assertUserActive(accountPrincipal(auth).userId);
  }
  async function archive(
    auth: RequestAuthentication,
    input: unknown,
  ): Promise<AccountArchiveState> {
    const { userId, sessionId } = accountPrincipal(auth);
    requireRecentAccountVerification(auth);
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => key !== 'confirmation') ||
      typeof (input as { confirmation?: unknown }).confirmation !== 'string' ||
      (input as { confirmation: string }).confirmation.length > 7
    ) {
      throw new AccessError('INVALID_REQUEST', 400);
    }
    if ((input as { confirmation: string }).confirmation !== 'ARCHIVE') {
      throw new AccessError(
        'ACCOUNT_CLOSURE_CONFIRMATION_MISMATCH',
        400,
        'Type ARCHIVE exactly to archive your account.',
      );
    }
    const prepared = await transaction(null, userId, async (client) => {
      await lockAccount(client, userId);
      const existing = (
        await client.query(
          `SELECT ${accountColumns} FROM personal_account_lifecycle WHERE user_id=$1`,
          [userId],
        )
      ).rows[0];
      if (existing?.status === 'archived') {
        return archiveOf(existing);
      }
      if (existing?.status === 'restoring') {
        throw new AccessError(
          'ACCOUNT_RESTORE_INCOMPLETE',
          409,
          'Account restoration is in progress. Contact support.',
        );
      }
      if (
        (await client.query('SELECT id FROM practices WHERE owner_user_id=$1 FOR SHARE', [userId]))
          .rowCount
      ) {
        throw new AccessError(
          'ACCOUNT_OWNS_PRACTICES',
          409,
          'Transfer ownership of every practice you own before archiving your account.',
        );
      }
      if (existing?.status !== 'archiving') {
        await client.query(
          "INSERT INTO personal_account_lifecycle(user_id,status,archive_session_id) VALUES($1,'archiving',$2) ON CONFLICT(user_id) DO UPDATE SET status='archiving',archive_session_id=EXCLUDED.archive_session_id,archive_requested_at=now(),archived_at=NULL,updated_at=now()",
          [userId, sessionId],
        );
        await client.query(
          "INSERT INTO personal_account_events(user_id,actor_reference,event) VALUES($1,$2,'archive_requested')",
          [userId, sessionId],
        );
      }
      return archiveOf({ ...existing, status: 'archiving' });
    });
    if (prepared.status === 'archived') {
      return prepared;
    }
    try {
      return await transaction(null, userId, async (client) => {
        await lockAccount(client, userId);
        const current = (
          await client.query(
            `SELECT ${accountColumns} FROM personal_account_lifecycle WHERE user_id=$1`,
            [userId],
          )
        ).rows[0];
        if (current?.status === 'archived') {
          return archiveOf(current);
        }
        if (current?.status !== 'archiving') {
          throw new AccessError('ACCOUNT_ARCHIVE_INCOMPLETE', 503);
        }
        const result = await provider.banUser(userId);
        if (result.id !== userId || result.banned !== true) {
          throw new Error('Provider archive not confirmed');
        }
        const completed = await client.query(
          `UPDATE personal_account_lifecycle SET status='archived',archived_at=now(),updated_at=now() WHERE user_id=$1 RETURNING ${accountColumns}`,
          [userId],
        );
        await client.query(
          "INSERT INTO personal_account_events(user_id,actor_reference,event) VALUES($1,$2,'archive_completed')",
          [userId, sessionId],
        );
        return archiveOf(completed.rows[0]);
      });
    } catch {
      throw new AccessError(
        'ACCOUNT_ARCHIVE_INCOMPLETE',
        503,
        'Application access is blocked. We still need to finish disabling sign-in. Retry the same archive or contact support.',
      );
    }
  }
  /** Operator-only recovery; never register as a public or practice-administrator route.
   * Review the provider ban and identity before invoking; unrelated moderation bans must not be removed.
   */
  async function restoreForOperator(
    userId: string,
    review: { operatorReference: string; confirmation: 'RESTORE' },
  ): Promise<AccountArchiveState> {
    validUser(userId);
    if (
      !review ||
      review.confirmation !== 'RESTORE' ||
      typeof review.operatorReference !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9:._/-]{2,127}$/.test(review.operatorReference)
    ) {
      throw new AccessError('INVALID_REQUEST', 400);
    }
    const prepared = await transaction(null, userId, async (client) => {
      await lockAccount(client, userId);
      const current = (
        await client.query(
          `SELECT ${accountColumns} FROM personal_account_lifecycle WHERE user_id=$1`,
          [userId],
        )
      ).rows[0];
      if (current?.status === 'active' && current.restoredAt) {
        return archiveOf(current);
      }
      if (!current || current.status === 'active') {
        throw new AccessError(
          'ACCOUNT_RESTORE_NOT_AVAILABLE',
          409,
          'No archived account is available to restore.',
        );
      }
      if (current.status !== 'restoring') {
        await client.query(
          "UPDATE personal_account_lifecycle SET status='restoring',updated_at=now() WHERE user_id=$1",
          [userId],
        );
        await client.query(
          "INSERT INTO personal_account_events(user_id,actor_reference,event) VALUES($1,$2,'restore_requested')",
          [userId, review.operatorReference],
        );
      }
    });
    if (prepared?.status === 'active') {
      return prepared;
    }
    try {
      return await transaction(null, userId, async (client) => {
        await lockAccount(client, userId);
        const current = (
          await client.query(
            `SELECT ${accountColumns} FROM personal_account_lifecycle WHERE user_id=$1`,
            [userId],
          )
        ).rows[0];
        if (current?.status === 'active') {
          return archiveOf(current);
        }
        if (current?.status !== 'restoring') {
          throw new AccessError('ACCOUNT_RESTORE_INCOMPLETE', 503);
        }
        const result = await provider.unbanUser(userId);
        if (result.id !== userId || result.banned !== false) {
          throw new Error('Provider restoration not confirmed');
        }
        const restored = await client.query(
          `UPDATE personal_account_lifecycle SET status='active',restored_at=now(),updated_at=now() WHERE user_id=$1 RETURNING ${accountColumns}`,
          [userId],
        );
        await client.query(
          "INSERT INTO personal_account_events(user_id,actor_reference,event) VALUES($1,$2,'restore_completed')",
          [userId, review.operatorReference],
        );
        return archiveOf(restored.rows[0]);
      });
    } catch {
      throw new AccessError(
        'ACCOUNT_RESTORE_INCOMPLETE',
        503,
        'Account access remains blocked until restoration is complete. Contact support.',
      );
    }
  }
  return { state, requestClosure, archive, assertActive, assertUserActive, restoreForOperator };
}
export const accountLifecycle = createAccountLifecycleService(
  async (practiceId, actor, operation) =>
    (await import('../db/practice-transaction.js')).practiceTransaction(
      practiceId,
      actor,
      operation,
    ),
);
export type AccountLifecycle = typeof accountLifecycle;
