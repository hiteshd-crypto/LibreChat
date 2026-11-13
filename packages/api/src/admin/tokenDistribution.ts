import { logger, isValidObjectIdString, SystemCapabilities } from '@librechat/data-schemas';
import type {
  TTokenGrantDescendantsResponse,
  TTokenGrantPreviewRequest,
  TTokenGrantPreviewResponse,
  TTokenGrantConfirmRequest,
  TTokenGrantConfirmResponse,
} from 'librechat-data-provider';
import type {
  IUser,
  AuditAction,
  AuditContext,
  RecordAuditEntryInput,
  RecordAuditEntryOptions,
} from '@librechat/data-schemas';
import type { Response } from 'express';
import type { HasCapabilityFn, CapabilityUser } from '~/middleware/capabilities';
import type { ServerRequest } from '~/types/http';
import { isPositiveAmount, computeEvenAllocation, round6 } from './grantMath';
import { buildAuditContext } from './context';

type GrantParticipantInput = { userId: string; expectedBalance: number; newBalance: number };
type GrantTransactionResult =
  | { status: 'committed'; balances: Record<string, number> }
  | { status: 'unsupported' }
  | { status: 'stale'; stale: Array<{ userId: string; expected: number; current: number }> };

export interface AdminTokenDistributionDeps {
  /** Used for the DEPARTMENT_HEAD self-only guard: a caller lacking ACCESS_ADMIN
   * may only ever act as root-of-self. */
  hasCapability: HasCapabilityFn;
  getUserById: (userId: string, fieldsToSelect?: string | string[] | null) => Promise<IUser | null>;
  getDescendantRoleKeys: (roleKey: string) => Promise<string[]>;
  listUsersByRoles: (roleKeys: string[]) => Promise<IUser[]>;
  getBalancesByUserIds: (userIds: string[]) => Promise<Map<string, number>>;
  commitGrantTransaction: (
    participants: GrantParticipantInput[],
  ) => Promise<GrantTransactionResult>;
  /** Fire-and-forget: recomputes a participant's own spend-threshold alert right
   * after their balance rises, so they self-heal promptly instead of waiting for
   * their next chat spend. */
  checkUserOwnThreshold?: (userId: string) => Promise<boolean>;
  /** Optional audit emission. Failure is logged but does not roll back an already-committed grant
   * unless `auditFailClosed` is set — see `packages/api/src/admin/grants.ts` for the same default. */
  recordAuditEntry?: (
    input: RecordAuditEntryInput,
    options?: RecordAuditEntryOptions,
  ) => Promise<void>;
  auditFailClosed?: boolean;
}

type Handler = (req: ServerRequest, res: Response) => Promise<Response>;

export interface AdminTokenDistributionHandlers {
  getDescendants: Handler;
  previewGrant: Handler;
  confirmGrant: Handler;
}

function displayName(user: Pick<IUser, 'name' | 'username' | 'email'>): string {
  return user.name || user.username || user.email;
}

/**
 * Hierarchical token distribution: an admin-only grant that evenly splits a lump sum (fractional,
 * rounded to 6 decimals, applied identically to every participant) across a root user and a
 * selected set of that root's descendants in the existing role hierarchy. Recipients are always
 * independently re-validated against the live role tree, both on preview and on confirm — the
 * client-side descendant list is a UX convenience only, never a security boundary. Preview never
 * mutates a balance; confirm commits every participant atomically (true multi-document
 * transaction) and aborts without writing anything if any participant's balance has drifted
 * since the preview was generated.
 */
export function createAdminTokenDistributionHandlers(
  deps: AdminTokenDistributionDeps,
): AdminTokenDistributionHandlers {
  const {
    hasCapability,
    getUserById,
    getDescendantRoleKeys,
    listUsersByRoles,
    getBalancesByUserIds,
    commitGrantTransaction,
    checkUserOwnThreshold,
    recordAuditEntry,
    auditFailClosed,
  } = deps;

  /**
   * The gate that makes it safe to widen this router's `ACCESS_ADMIN`-only gate
   * to also admit `DEPARTMENT_HEAD`: a caller lacking `ACCESS_ADMIN` may only
   * ever act as root-of-self, so the client's existing unmodified GrantDialog
   * flow (which resolves `rootUserId` from the logged-in user) stays safe to
   * expose to a Department Head without a single line of its own changing.
   */
  async function requireSelfRootIfNotAdmin(
    req: ServerRequest,
    rootUserId: unknown,
  ): Promise<ValidationError | null> {
    const user = req.user;
    if (!user) {
      return { status: 401, body: { error: 'Not authenticated' } };
    }
    const capabilityUser: CapabilityUser = {
      id: user._id?.toString() ?? user.id ?? '',
      role: user.role ?? '',
      tenantId: user.tenantId,
      idOnTheSource: user.idOnTheSource ?? null,
    };
    if (await hasCapability(capabilityUser, SystemCapabilities.ACCESS_ADMIN)) {
      return null;
    }
    if (rootUserId === capabilityUser.id) {
      return null;
    }
    return { status: 403, body: { error: 'Forbidden' } };
  }

  async function emitGrantAudit(args: {
    actor: { userId: string; actorName: string; tenantId?: string };
    rootUserId: string;
    rootName: string;
    recipientUserIds: string[];
    perParticipantAmount: number;
    totalAmount: number;
    context?: AuditContext;
  }): Promise<void> {
    if (!recordAuditEntry) {
      return;
    }
    const isSelf = args.actor.userId === args.rootUserId;
    const action: AuditAction = isSelf ? 'balance.self_grant' : 'balance.departmental_distribution';
    const input: RecordAuditEntryInput = {
      action,
      outcome: 'success',
      actor: { type: 'user', id: args.actor.userId, name: args.actor.actorName },
      target: { type: 'user', id: args.rootUserId, name: args.rootName },
      metadata: {
        kind: isSelf ? 'self_grant' : 'hierarchical_grant',
        recipientCount: args.recipientUserIds.length,
        totalAmount: args.totalAmount,
        perParticipantAmount: args.perParticipantAmount,
        recipients: args.recipientUserIds.join(','),
      },
      context: args.context,
      tenantId: args.actor.tenantId,
    };
    if (auditFailClosed) {
      await recordAuditEntry(input, { failClosed: true });
      return;
    }
    try {
      await recordAuditEntry(input);
    } catch (err) {
      logger.error('[adminTokenDistribution] audit write failed', err);
    }
  }

  /** `req.user` is already loaded from the JWT, so this is a no-DB-round-trip actor lookup. */
  function resolveActor(
    req: ServerRequest,
  ): { userId: string; actorName: string; tenantId?: string } | null {
    const user = req.user;
    if (!user) {
      return null;
    }
    const userId = user._id?.toString() ?? user.id;
    if (!userId) {
      return null;
    }
    return { userId, actorName: displayName(user), tenantId: user.tenantId };
  }

  interface ValidationError {
    status: number;
    body: Record<string, unknown>;
  }

  /**
   * Shared validation for both preview and confirm: parses/validates the request shape, re-reads
   * the root user, re-resolves the current descendant set from the live role tree, and rejects
   * any recipient that isn't currently in it (or is the root, or is duplicated). Always a fresh
   * read — never trusts anything the caller computed earlier.
   */
  async function resolveParticipants(
    rootUserId: unknown,
    recipientUserIds: unknown,
    totalAmount: unknown,
  ): Promise<
    | {
        error: ValidationError;
      }
    | {
        error?: undefined;
        rootUser: IUser;
        participantIds: string[];
        namesById: Map<string, string>;
        perParticipantAmount: number;
      }
  > {
    if (typeof rootUserId !== 'string' || !isValidObjectIdString(rootUserId)) {
      return { error: { status: 400, body: { error: 'rootUserId must be a valid user ID' } } };
    }
    if (
      !Array.isArray(recipientUserIds) ||
      !recipientUserIds.every((id) => typeof id === 'string' && isValidObjectIdString(id))
    ) {
      return {
        error: {
          status: 400,
          body: { error: 'recipientUserIds must be an array of valid user IDs' },
        },
      };
    }
    if (!isPositiveAmount(totalAmount)) {
      return { error: { status: 400, body: { error: 'totalAmount must be a positive number' } } };
    }
    if (recipientUserIds.includes(rootUserId)) {
      return {
        error: { status: 400, body: { error: 'The root user cannot also be a recipient' } },
      };
    }
    const uniqueRecipients = new Set(recipientUserIds);
    if (uniqueRecipients.size !== recipientUserIds.length) {
      return {
        error: { status: 400, body: { error: 'Recipient list contains duplicate user IDs' } },
      };
    }

    const rootUser = await getUserById(rootUserId, '_id name username email role');
    if (!rootUser) {
      return { error: { status: 404, body: { error: 'Root user not found' } } };
    }
    if (!rootUser.role) {
      return {
        error: { status: 400, body: { error: 'The root user has no role in the hierarchy' } },
      };
    }

    const descendantRoleKeys = await getDescendantRoleKeys(rootUser.role);
    const descendants =
      descendantRoleKeys.length > 0 ? await listUsersByRoles(descendantRoleKeys) : [];
    const namesById = new Map<string, string>([[rootUserId, displayName(rootUser)]]);
    for (const user of descendants) {
      namesById.set(user._id.toString(), displayName(user));
    }

    const invalidRecipients = recipientUserIds.filter((id) => !namesById.has(id));
    if (invalidRecipients.length > 0) {
      return {
        error: {
          status: 400,
          body: {
            error: "One or more recipients are not the root user's current descendants",
            invalidRecipients,
          },
        },
      };
    }

    const participantIds = [rootUserId, ...recipientUserIds];
    const perParticipantAmount = computeEvenAllocation(totalAmount, participantIds.length);
    return { rootUser, participantIds, namesById, perParticipantAmount };
  }

  async function getDescendants(req: ServerRequest, res: Response) {
    try {
      const { rootUserId } = req.params as { rootUserId?: string };
      if (!rootUserId || !isValidObjectIdString(rootUserId)) {
        return res.status(400).json({ error: 'rootUserId must be a valid user ID' });
      }
      const selfGuardError = await requireSelfRootIfNotAdmin(req, rootUserId);
      if (selfGuardError) {
        return res.status(selfGuardError.status).json(selfGuardError.body);
      }
      const rootUser = await getUserById(rootUserId, '_id role');
      if (!rootUser) {
        return res.status(404).json({ error: 'Root user not found' });
      }
      if (!rootUser.role) {
        return res.status(200).json({ descendants: [] } satisfies TTokenGrantDescendantsResponse);
      }
      const descendantRoleKeys = await getDescendantRoleKeys(rootUser.role);
      const descendants =
        descendantRoleKeys.length > 0 ? await listUsersByRoles(descendantRoleKeys) : [];
      return res.status(200).json({
        descendants: descendants.map((user) => ({
          userId: user._id.toString(),
          name: displayName(user),
          email: user.email,
        })),
      } satisfies TTokenGrantDescendantsResponse);
    } catch (error) {
      logger.error('[adminTokenDistribution] getDescendants error:', error);
      return res.status(500).json({ error: 'Failed to load eligible recipients' });
    }
  }

  async function previewGrant(req: ServerRequest, res: Response) {
    try {
      const { rootUserId, recipientUserIds, totalAmount } = (req.body ??
        {}) as Partial<TTokenGrantPreviewRequest>;

      const selfGuardError = await requireSelfRootIfNotAdmin(req, rootUserId);
      if (selfGuardError) {
        return res.status(selfGuardError.status).json(selfGuardError.body);
      }

      const resolved = await resolveParticipants(rootUserId, recipientUserIds, totalAmount);
      if (resolved.error) {
        return res.status(resolved.error.status).json(resolved.error.body);
      }
      const { participantIds, namesById, perParticipantAmount } = resolved;

      const balances = await getBalancesByUserIds(participantIds);
      const rows = participantIds.map((userId) => {
        const currentBalance = balances.get(userId) ?? 0;
        return {
          userId,
          name: namesById.get(userId) ?? userId,
          currentBalance,
          newBalance: round6(currentBalance + perParticipantAmount),
        };
      });

      return res
        .status(200)
        .json({ perParticipantAmount, rows } satisfies TTokenGrantPreviewResponse);
    } catch (error) {
      logger.error('[adminTokenDistribution] previewGrant error:', error);
      return res.status(500).json({ error: 'Failed to preview the token grant' });
    }
  }

  async function confirmGrant(req: ServerRequest, res: Response) {
    try {
      const actor = resolveActor(req);
      if (!actor) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { rootUserId, recipientUserIds, totalAmount, expectedBalances } = (req.body ??
        {}) as Partial<TTokenGrantConfirmRequest>;

      const selfGuardError = await requireSelfRootIfNotAdmin(req, rootUserId);
      if (selfGuardError) {
        return res.status(selfGuardError.status).json(selfGuardError.body);
      }

      const resolved = await resolveParticipants(rootUserId, recipientUserIds, totalAmount);
      if (resolved.error) {
        return res.status(resolved.error.status).json(resolved.error.body);
      }
      const { rootUser, participantIds, namesById, perParticipantAmount } = resolved;

      if (
        expectedBalances == null ||
        typeof expectedBalances !== 'object' ||
        Array.isArray(expectedBalances) ||
        !participantIds.every(
          (id) => isPositiveAmount(expectedBalances[id]) || expectedBalances[id] === 0,
        )
      ) {
        return res.status(400).json({
          error: 'expectedBalances must include a non-negative number for every participant',
        });
      }

      const participants: GrantParticipantInput[] = participantIds.map((userId) => ({
        userId,
        expectedBalance: expectedBalances[userId],
        newBalance: round6(expectedBalances[userId] + perParticipantAmount),
      }));

      const result = await commitGrantTransaction(participants);

      if (result.status === 'unsupported') {
        return res.status(409).json({
          error:
            'This deployment does not support atomic multi-user token grants (no MongoDB replica set). Nothing was changed.',
        });
      }
      if (result.status === 'stale') {
        return res.status(409).json({
          error:
            'One or more balances changed since the preview was generated. Generate a new preview.',
          stale: result.stale,
        });
      }

      await emitGrantAudit({
        actor,
        rootUserId: rootUser._id.toString(),
        rootName: displayName(rootUser),
        recipientUserIds: participantIds.filter((id) => id !== rootUserId),
        perParticipantAmount,
        totalAmount: totalAmount as number,
        context: buildAuditContext(req),
      });

      participantIds.forEach((userId) => void checkUserOwnThreshold?.(userId));

      return res.status(200).json({
        rows: participantIds.map((userId) => ({
          userId,
          name: namesById.get(userId) ?? userId,
          previousBalance: expectedBalances[userId],
          newBalance: result.balances[userId],
        })),
        committedAt: new Date().toISOString(),
      } satisfies TTokenGrantConfirmResponse);
    } catch (error) {
      logger.error('[adminTokenDistribution] confirmGrant error:', error);
      return res.status(500).json({ error: 'Failed to commit the token grant' });
    }
  }

  return { getDescendants, previewGrant, confirmGrant };
}
