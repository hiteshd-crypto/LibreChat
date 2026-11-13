import { logger, isValidObjectIdString, SystemCapabilities } from '@librechat/data-schemas';
import type {
  IUser,
  RecordAuditEntryInput,
  RecordAuditEntryOptions,
} from '@librechat/data-schemas';
import type { TAdminUserBalance, TAdminUserBalanceUpdateBody } from 'librechat-data-provider';
import type { Response } from 'express';
import type { HasCapabilityFn, CapabilityUser } from '~/middleware/capabilities';
import type { ServerRequest } from '~/types/http';
import { buildAuditContext } from './context';

interface BalanceRecord {
  tokenCredits: number;
}

function displayName(user: Pick<IUser, 'name' | 'username' | 'email'>): string {
  return user.name || user.username || user.email || 'Unknown';
}

type BalanceSetResult =
  | { status: 'updated'; balance: BalanceRecord }
  | { status: 'conflict'; current: BalanceRecord | null };

interface UserIdParams {
  userId?: string;
}

export interface AdminBalanceDeps {
  /** Used to scope a DEPARTMENT_HEAD caller's `getBalance` to their own department's members. */
  hasCapability: HasCapabilityFn;
  getUserById: (userId: string, fieldsToSelect?: string | string[] | null) => Promise<IUser | null>;
  findBalanceByUser: (user: string) => Promise<BalanceRecord | null>;
  upsertBalanceFields: (
    user: string,
    fields: { tokenCredits: number },
  ) => Promise<BalanceRecord | null>;
  /** Overwrites only if the stored balance still equals `expected` (`null` = no record existed). */
  setBalanceIfUnchanged: (
    user: string,
    expected: number | null,
    tokenCredits: number,
  ) => Promise<BalanceSetResult>;
  /** Role-tree descendant check, used for the DEPARTMENT_HEAD self-or-descendant scope. */
  isDescendantOf: (childRoleKey: string, ancestorRoleKey: string) => Promise<boolean>;
  recordAuditEntry?: (
    input: RecordAuditEntryInput,
    options?: RecordAuditEntryOptions,
  ) => Promise<void>;
}

type BalanceHandler = (req: ServerRequest, res: Response) => Promise<Response>;

export interface AdminBalanceHandlers {
  getBalance: BalanceHandler;
  setBalance: BalanceHandler;
}

function isCredits(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}

function toBalance(userId: string, record: BalanceRecord | null): TAdminUserBalance {
  return { userId, tokenCredits: record?.tokenCredits ?? 0, hasRecord: record != null };
}

/**
 * Administrative read/overwrite of a user's `tokenCredits`. Deliberately separate from the
 * transaction path: it never records a transaction and never touches deduction logic.
 */
export function createAdminBalanceHandlers(deps: AdminBalanceDeps): AdminBalanceHandlers {
  const {
    hasCapability,
    getUserById,
    findBalanceByUser,
    upsertBalanceFields,
    setBalanceIfUnchanged,
    isDescendantOf,
    recordAuditEntry,
  } = deps;

  function parseUserId(req: ServerRequest): string | null {
    const { userId } = req.params as UserIdParams;
    return userId && isValidObjectIdString(userId) ? userId : null;
  }

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

  async function emitBalanceEditAudit(args: {
    req: ServerRequest;
    targetUserId: string;
    targetUser: IUser;
    previousTokenCredits: number;
    newTokenCredits: number;
    mode: 'overwrite' | 'cas';
  }): Promise<void> {
    if (!recordAuditEntry) {
      return;
    }
    const actor = resolveActor(args.req);
    if (!actor) {
      return;
    }
    try {
      await recordAuditEntry({
        action: 'balance.edited',
        outcome: 'success',
        actor: { type: 'user', id: actor.userId, name: actor.actorName },
        target: {
          type: 'user',
          id: args.targetUserId,
          name: displayName(args.targetUser),
        },
        metadata: {
          previousTokenCredits: args.previousTokenCredits,
          newTokenCredits: args.newTokenCredits,
          mode: args.mode,
        },
        context: buildAuditContext(args.req),
        tenantId: actor.tenantId,
      });
    } catch (err) {
      logger.error('[adminBalance] balance.edited audit write failed', err);
    }
  }

  /**
   * A DEPARTMENT_HEAD (non-ACCESS_ADMIN) caller may only view their own balance or a
   * current member of their own department's branch (self-or-descendant in the role
   * tree) — never edit (PATCH is gated ACCESS_ADMIN-only at the route level) and
   * never another department's users.
   */
  async function canViewBalance(
    req: ServerRequest,
    targetRole: string | undefined,
  ): Promise<boolean> {
    const user = req.user;
    if (!user) {
      return false;
    }
    const capabilityUser: CapabilityUser = {
      id: user._id?.toString() ?? user.id ?? '',
      role: user.role ?? '',
      tenantId: user.tenantId,
      idOnTheSource: user.idOnTheSource ?? null,
    };
    if (await hasCapability(capabilityUser, SystemCapabilities.ACCESS_ADMIN)) {
      return true;
    }
    if (!(await hasCapability(capabilityUser, SystemCapabilities.DEPARTMENT_HEAD))) {
      return false;
    }
    if (!targetRole) {
      return false;
    }
    if (targetRole === capabilityUser.role) {
      return true;
    }
    return isDescendantOf(targetRole, capabilityUser.role);
  }

  async function getBalance(req: ServerRequest, res: Response) {
    try {
      const userId = parseUserId(req);
      if (!userId) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }
      const user = await getUserById(userId, '_id role');
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (!(await canViewBalance(req, user.role))) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const record = await findBalanceByUser(userId);
      return res.status(200).json(toBalance(userId, record));
    } catch (error) {
      logger.error('[adminBalance] getBalance error:', error);
      return res.status(500).json({ error: 'Failed to load user balance' });
    }
  }

  async function setBalance(req: ServerRequest, res: Response) {
    try {
      const userId = parseUserId(req);
      if (!userId) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }
      const { tokenCredits, expectedTokenCredits } = (req.body ??
        {}) as Partial<TAdminUserBalanceUpdateBody>;
      if (!isCredits(tokenCredits)) {
        return res.status(400).json({ error: 'tokenCredits must be a non-negative number' });
      }
      if (
        expectedTokenCredits !== undefined &&
        expectedTokenCredits !== null &&
        !isCredits(expectedTokenCredits)
      ) {
        return res
          .status(400)
          .json({ error: 'expectedTokenCredits must be null or a non-negative number' });
      }
      const user = await getUserById(userId, '_id name username email');
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (expectedTokenCredits === undefined) {
        const previousRecord = await findBalanceByUser(userId);
        const record = await upsertBalanceFields(userId, { tokenCredits });
        await emitBalanceEditAudit({
          req,
          targetUserId: userId,
          targetUser: user,
          previousTokenCredits: previousRecord?.tokenCredits ?? 0,
          newTokenCredits: tokenCredits,
          mode: 'overwrite',
        });
        return res.status(200).json(toBalance(userId, record));
      }
      const result = await setBalanceIfUnchanged(userId, expectedTokenCredits, tokenCredits);
      if (result.status === 'conflict') {
        return res.status(409).json({
          error: 'The balance changed since it was loaded',
          balance: toBalance(userId, result.current),
        });
      }
      await emitBalanceEditAudit({
        req,
        targetUserId: userId,
        targetUser: user,
        previousTokenCredits: expectedTokenCredits ?? 0,
        newTokenCredits: tokenCredits,
        mode: 'cas',
      });
      return res.status(200).json(toBalance(userId, result.balance));
    } catch (error) {
      logger.error('[adminBalance] setBalance error:', error);
      return res.status(500).json({ error: 'Failed to update user balance' });
    }
  }

  return { getBalance, setBalance };
}
