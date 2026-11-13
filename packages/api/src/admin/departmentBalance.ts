import { logger, isValidObjectIdString, SystemCapabilities } from '@librechat/data-schemas';
import type {
  IUser,
  IDepartment,
  AuditAction,
  RecordAuditEntryInput,
  RecordAuditEntryOptions,
} from '@librechat/data-schemas';
import type { FilterQuery } from 'mongoose';
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

type DisbursementTransactionResult =
  | { status: 'committed'; poolBalance: number; balances: Record<string, number> }
  | { status: 'unsupported' }
  | { status: 'pool_stale'; expectedPoolBalance: number; currentPoolBalance: number }
  | { status: 'pool_insufficient'; poolBalance: number; requested: number }
  | { status: 'stale'; stale: Array<{ userId: string; expected: number; current: number }> };

export interface AdminDepartmentBalanceDeps {
  hasCapability: HasCapabilityFn;
  getDepartmentById: (departmentId: string, tenantId?: string) => Promise<IDepartment | null>;
  getDepartmentForRoleKey: (roleKey: string, tenantId?: string) => Promise<IDepartment | null>;
  getDescendantRoleKeys: (roleKey: string) => Promise<string[]>;
  findUsers: (
    filter: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
    options?: { limit?: number; offset?: number; sort?: Record<string, 1 | -1> },
  ) => Promise<IUser[]>;
  getBalancesByUserIds: (userIds: string[]) => Promise<Map<string, number>>;
  getDepartmentBalance: (departmentId: string, tenantId?: string) => Promise<number>;
  incrementDepartmentBalance: (
    departmentId: string,
    amount: number,
    tenantId?: string,
  ) => Promise<number>;
  /** Fire-and-forget: recomputes a member's own spend-threshold alert right after
   * their balance changes (disbursement or transfer), so they self-heal/re-alert
   * promptly instead of waiting for their next chat spend. */
  checkUserOwnThreshold?: (userId: string) => Promise<boolean>;
  commitDisbursementTransaction: (args: {
    departmentId: string;
    tenantId?: string;
    expectedPoolBalance: number;
    participants: GrantParticipantInput[];
  }) => Promise<DisbursementTransactionResult>;
  /** Reused, unmodified, for Transfer — a 2-participant grant is exactly what this already does. */
  commitGrantTransaction: (
    participants: GrantParticipantInput[],
  ) => Promise<GrantTransactionResult>;
  recordAuditEntry?: (
    input: RecordAuditEntryInput,
    options?: RecordAuditEntryOptions,
  ) => Promise<void>;
}

type Handler = (req: ServerRequest, res: Response) => Promise<Response>;

export interface AdminDepartmentBalanceHandlers {
  getBalance: Handler;
  grant: Handler;
  listMyMembers: Handler;
  previewDisburse: Handler;
  confirmDisburse: Handler;
  previewTransfer: Handler;
  confirmTransfer: Handler;
}

function displayName(user: Pick<IUser, 'name' | 'username' | 'email'>): string {
  return user.name || user.username || user.email;
}

export function createAdminDepartmentBalanceHandlers(
  deps: AdminDepartmentBalanceDeps,
): AdminDepartmentBalanceHandlers {
  const {
    hasCapability,
    getDepartmentById,
    getDepartmentForRoleKey,
    getDescendantRoleKeys,
    findUsers,
    getBalancesByUserIds,
    getDepartmentBalance,
    incrementDepartmentBalance,
    checkUserOwnThreshold,
    commitDisbursementTransaction,
    commitGrantTransaction,
    recordAuditEntry,
  } = deps;

  interface ValidationError {
    status: number;
    body: Record<string, unknown>;
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

  function capabilityUserFrom(req: ServerRequest): CapabilityUser {
    const user = req.user;
    return {
      id: user?._id?.toString() ?? user?.id ?? '',
      role: user?.role ?? '',
      tenantId: user?.tenantId,
      idOnTheSource: user?.idOnTheSource ?? null,
    };
  }

  /** Resolves the caller's own Department via their role — the basis for every
   * `/mine/*` route and for the DEPARTMENT_HEAD ownership check on `/:departmentId/balance`. */
  async function resolveOwnDepartment(req: ServerRequest): Promise<IDepartment | null> {
    const user = req.user;
    if (!user?.role) {
      return null;
    }
    return await getDepartmentForRoleKey(user.role, user.tenantId);
  }

  /** Every user in the department's branch (root + descendants) — no root exclusion, since
   * a Department Head is just another equal, selectable member under this model. */
  async function listDepartmentMembers(
    department: IDepartment,
  ): Promise<Array<{ userId: string; name: string; email: string }>> {
    if (department.rootRoleKey == null) {
      return [];
    }
    const rootRoleKey = department.rootRoleKey;
    const descendantRoleKeys = await getDescendantRoleKeys(rootRoleKey);
    const members = await findUsers(
      { role: { $in: [rootRoleKey, ...descendantRoleKeys] } },
      '_id name username email',
    );
    return members.map((member) => ({
      userId: member._id.toString(),
      name: displayName(member),
      email: member.email,
    }));
  }

  async function emitAudit(args: {
    req: ServerRequest;
    kind: 'department_pool_grant' | 'department_disbursement' | 'department_transfer';
    department?: { id: string; name: string };
    metadata: Record<string, unknown>;
  }): Promise<void> {
    if (!recordAuditEntry) {
      return;
    }
    const actor = resolveActor(args.req);
    if (!actor) {
      return;
    }
    const action: AuditAction =
      args.kind === 'department_pool_grant'
        ? 'balance.departmental_distribution'
        : 'balance.internal_distribution';
    try {
      await recordAuditEntry({
        action,
        outcome: 'success',
        actor: { type: 'user', id: actor.userId, name: actor.actorName },
        target: args.department
          ? { type: 'department', id: args.department.id, name: args.department.name }
          : { type: 'user', id: actor.userId, name: actor.actorName },
        metadata: { kind: args.kind, ...args.metadata },
        context: buildAuditContext(args.req),
        tenantId: actor.tenantId,
      });
    } catch (err) {
      logger.error('[adminDepartmentBalance] audit write failed', err);
    }
  }

  /**
   * `GET /:departmentId/balance` — an ACCESS_ADMIN caller may read any department; a
   * DEPARTMENT_HEAD-only caller may only read their own. `totalBalance` is pool + the sum of
   * every member's personal balance — the department's total wealth under this model.
   */
  async function getBalance(req: ServerRequest, res: Response) {
    try {
      const { departmentId } = req.params as { departmentId: string };
      const tenantId = req.user?.tenantId;
      const isAdmin = await hasCapability(capabilityUserFrom(req), SystemCapabilities.ACCESS_ADMIN);
      if (!isAdmin) {
        const ownDepartment = await resolveOwnDepartment(req);
        if (!ownDepartment || String(ownDepartment._id) !== departmentId) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      }

      const department = await getDepartmentById(departmentId, tenantId);
      if (!department) {
        return res.status(404).json({ error: 'Department not found' });
      }

      const [poolBalance, members] = await Promise.all([
        getDepartmentBalance(departmentId, tenantId),
        listDepartmentMembers(department),
      ]);
      const memberIds = members.map((member) => member.userId);
      const balances = await getBalancesByUserIds(memberIds);
      const membersTotal = memberIds.reduce((sum, id) => sum + (balances.get(id) ?? 0), 0);

      return res.status(200).json({ poolBalance, totalBalance: poolBalance + membersTotal });
    } catch (error) {
      logger.error('[adminDepartmentBalance] getBalance error:', error);
      return res.status(500).json({ error: 'Failed to resolve department balance' });
    }
  }

  /** `POST /:departmentId/grant` (ACCESS_ADMIN only) — single-step: a pure `$inc` upsert can't
   * go stale, so no preview/confirm step is needed for this operation alone. */
  async function grant(req: ServerRequest, res: Response) {
    try {
      const { departmentId } = req.params as { departmentId: string };
      const { amount } = (req.body ?? {}) as { amount?: unknown };
      if (!isPositiveAmount(amount)) {
        return res.status(400).json({ error: 'amount must be a positive number' });
      }

      const tenantId = req.user?.tenantId;
      const department = await getDepartmentById(departmentId, tenantId);
      if (!department) {
        return res.status(404).json({ error: 'Department not found' });
      }

      const poolBalance = await incrementDepartmentBalance(departmentId, amount, tenantId);

      await emitAudit({
        req,
        kind: 'department_pool_grant',
        department: { id: departmentId, name: department.name },
        metadata: { amount },
      });

      return res.status(200).json({ poolBalance });
    } catch (error) {
      logger.error('[adminDepartmentBalance] grant error:', error);
      return res.status(500).json({ error: 'Failed to grant department balance' });
    }
  }

  /** `GET /mine/members` (DEPARTMENT_HEAD only) — includes the caller: this is the one place
   * the old "root cannot also be a recipient" rule from `tokenDistribution.ts` must not apply. */
  async function listMyMembers(req: ServerRequest, res: Response) {
    try {
      const department = await resolveOwnDepartment(req);
      if (!department) {
        return res.status(404).json({ error: 'Not a member of any department' });
      }
      const members = await listDepartmentMembers(department);
      return res.status(200).json({ members });
    } catch (error) {
      logger.error('[adminDepartmentBalance] listMyMembers error:', error);
      return res.status(500).json({ error: 'Failed to list department members' });
    }
  }

  /** Shared validation for disburse preview/confirm: resolves the caller's own department,
   * re-validates every recipient as a current member (fresh read, never trusting the client),
   * and computes the even per-recipient allocation. */
  async function resolveDisburseParticipants(
    req: ServerRequest,
    recipientUserIds: unknown,
    totalAmount: unknown,
  ): Promise<
    | { error: ValidationError }
    | {
        error?: undefined;
        department: IDepartment;
        recipientUserIds: string[];
        namesById: Map<string, string>;
        perRecipientAmount: number;
      }
  > {
    if (
      !Array.isArray(recipientUserIds) ||
      recipientUserIds.length === 0 ||
      !recipientUserIds.every((id) => typeof id === 'string' && isValidObjectIdString(id))
    ) {
      return {
        error: {
          status: 400,
          body: { error: 'recipientUserIds must be a non-empty array of valid user IDs' },
        },
      };
    }
    const uniqueRecipients = new Set(recipientUserIds);
    if (uniqueRecipients.size !== recipientUserIds.length) {
      return {
        error: { status: 400, body: { error: 'Recipient list contains duplicate user IDs' } },
      };
    }
    if (!isPositiveAmount(totalAmount)) {
      return { error: { status: 400, body: { error: 'totalAmount must be a positive number' } } };
    }

    const department = await resolveOwnDepartment(req);
    if (!department) {
      return { error: { status: 404, body: { error: 'Not a member of any department' } } };
    }

    const members = await listDepartmentMembers(department);
    const namesById = new Map(members.map((member) => [member.userId, member.name]));
    const invalidRecipients = recipientUserIds.filter((id) => !namesById.has(id));
    if (invalidRecipients.length > 0) {
      return {
        error: {
          status: 400,
          body: {
            error: 'One or more recipients are not current members of your department',
            invalidRecipients,
          },
        },
      };
    }

    const perRecipientAmount = computeEvenAllocation(totalAmount, recipientUserIds.length);
    return { department, recipientUserIds, namesById, perRecipientAmount };
  }

  async function previewDisburse(req: ServerRequest, res: Response) {
    try {
      const { recipientUserIds, totalAmount } = (req.body ?? {}) as {
        recipientUserIds?: unknown;
        totalAmount?: unknown;
      };
      const resolved = await resolveDisburseParticipants(req, recipientUserIds, totalAmount);
      if (resolved.error) {
        return res.status(resolved.error.status).json(resolved.error.body);
      }
      const { department, recipientUserIds: recipients, namesById, perRecipientAmount } = resolved;

      const tenantId = req.user?.tenantId;
      const departmentId = String(department._id);
      const [poolBalance, balances] = await Promise.all([
        getDepartmentBalance(departmentId, tenantId),
        getBalancesByUserIds(recipients),
      ]);
      if ((totalAmount as number) > poolBalance) {
        return res.status(400).json({ error: 'totalAmount exceeds the current pool balance' });
      }

      const rows = recipients.map((userId) => {
        const currentBalance = balances.get(userId) ?? 0;
        return {
          userId,
          name: namesById.get(userId) ?? userId,
          currentBalance,
          newBalance: round6(currentBalance + perRecipientAmount),
        };
      });

      return res.status(200).json({ poolBalance, perRecipientAmount, rows });
    } catch (error) {
      logger.error('[adminDepartmentBalance] previewDisburse error:', error);
      return res.status(500).json({ error: 'Failed to preview the disbursement' });
    }
  }

  async function confirmDisburse(req: ServerRequest, res: Response) {
    try {
      const { recipientUserIds, totalAmount, expectedPoolBalance, expectedBalances } = (req.body ??
        {}) as {
        recipientUserIds?: unknown;
        totalAmount?: unknown;
        expectedPoolBalance?: unknown;
        expectedBalances?: Record<string, unknown>;
      };
      const resolved = await resolveDisburseParticipants(req, recipientUserIds, totalAmount);
      if (resolved.error) {
        return res.status(resolved.error.status).json(resolved.error.body);
      }
      const { department, recipientUserIds: recipients, namesById, perRecipientAmount } = resolved;

      if (!isPositiveAmount(expectedPoolBalance) && expectedPoolBalance !== 0) {
        return res.status(400).json({ error: 'expectedPoolBalance must be a non-negative number' });
      }
      if (
        expectedBalances == null ||
        typeof expectedBalances !== 'object' ||
        Array.isArray(expectedBalances) ||
        !recipients.every(
          (id) => isPositiveAmount(expectedBalances[id]) || expectedBalances[id] === 0,
        )
      ) {
        return res.status(400).json({
          error: 'expectedBalances must include a non-negative number for every recipient',
        });
      }

      const participants: GrantParticipantInput[] = recipients.map((userId) => ({
        userId,
        expectedBalance: expectedBalances[userId] as number,
        newBalance: round6((expectedBalances[userId] as number) + perRecipientAmount),
      }));

      const tenantId = req.user?.tenantId;
      const departmentId = String(department._id);
      const result = await commitDisbursementTransaction({
        departmentId,
        tenantId,
        expectedPoolBalance: expectedPoolBalance as number,
        participants,
      });

      if (result.status === 'unsupported') {
        return res.status(409).json({
          error:
            'This deployment does not support atomic multi-user disbursements (no MongoDB replica set). Nothing was changed.',
        });
      }
      if (result.status === 'pool_stale') {
        return res.status(409).json({
          error: 'The department pool balance changed since the preview was generated.',
          expectedPoolBalance: result.expectedPoolBalance,
          currentPoolBalance: result.currentPoolBalance,
        });
      }
      if (result.status === 'pool_insufficient') {
        return res.status(409).json({
          error: 'The department pool balance is insufficient for this disbursement.',
          poolBalance: result.poolBalance,
          requested: result.requested,
        });
      }
      if (result.status === 'stale') {
        return res.status(409).json({
          error: 'One or more balances changed since the preview was generated.',
          stale: result.stale,
        });
      }

      await emitAudit({
        req,
        kind: 'department_disbursement',
        department: { id: departmentId, name: department.name },
        metadata: {
          recipientCount: recipients.length,
          totalAmount,
          perRecipientAmount,
          recipients: recipients.join(','),
        },
      });

      recipients.forEach((userId) => void checkUserOwnThreshold?.(userId));

      return res.status(200).json({
        poolBalance: result.poolBalance,
        rows: recipients.map((userId) => ({
          userId,
          name: namesById.get(userId) ?? userId,
          previousBalance: expectedBalances[userId],
          newBalance: result.balances[userId],
        })),
        committedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[adminDepartmentBalance] confirmDisburse error:', error);
      return res.status(500).json({ error: 'Failed to commit the disbursement' });
    }
  }

  /** Shared validation for transfer preview/confirm — both members must be current members of
   * the caller's own department, distinct, with a positive amount. */
  async function resolveTransferParticipants(
    req: ServerRequest,
    fromUserId: unknown,
    toUserId: unknown,
    amount: unknown,
  ): Promise<
    | { error: ValidationError }
    | {
        error?: undefined;
        department: IDepartment;
        fromUserId: string;
        toUserId: string;
        fromName: string;
        toName: string;
        amount: number;
      }
  > {
    if (typeof fromUserId !== 'string' || !isValidObjectIdString(fromUserId)) {
      return { error: { status: 400, body: { error: 'fromUserId must be a valid user ID' } } };
    }
    if (typeof toUserId !== 'string' || !isValidObjectIdString(toUserId)) {
      return { error: { status: 400, body: { error: 'toUserId must be a valid user ID' } } };
    }
    if (fromUserId === toUserId) {
      return {
        error: { status: 400, body: { error: 'fromUserId and toUserId must be different' } },
      };
    }
    if (!isPositiveAmount(amount)) {
      return { error: { status: 400, body: { error: 'amount must be a positive number' } } };
    }

    const department = await resolveOwnDepartment(req);
    if (!department) {
      return { error: { status: 404, body: { error: 'Not a member of any department' } } };
    }
    const members = await listDepartmentMembers(department);
    const namesById = new Map(members.map((member) => [member.userId, member.name]));
    if (!namesById.has(fromUserId) || !namesById.has(toUserId)) {
      return {
        error: {
          status: 400,
          body: { error: 'Both members must be current members of your department' },
        },
      };
    }

    return {
      department,
      fromUserId,
      toUserId,
      fromName: namesById.get(fromUserId) as string,
      toName: namesById.get(toUserId) as string,
      amount,
    };
  }

  async function previewTransfer(req: ServerRequest, res: Response) {
    try {
      const { fromUserId, toUserId, amount } = (req.body ?? {}) as {
        fromUserId?: unknown;
        toUserId?: unknown;
        amount?: unknown;
      };
      const resolved = await resolveTransferParticipants(req, fromUserId, toUserId, amount);
      if (resolved.error) {
        return res.status(resolved.error.status).json(resolved.error.body);
      }
      const { fromUserId: from, toUserId: to, fromName, toName, amount: validAmount } = resolved;

      const balances = await getBalancesByUserIds([from, to]);
      const fromCurrent = balances.get(from) ?? 0;
      const toCurrent = balances.get(to) ?? 0;
      const fromNew = round6(fromCurrent - validAmount);
      if (fromNew < 0) {
        return res
          .status(400)
          .json({ error: "amount exceeds the source member's current balance" });
      }
      const toNew = round6(toCurrent + validAmount);

      return res.status(200).json({
        from: { userId: from, name: fromName, currentBalance: fromCurrent, newBalance: fromNew },
        to: { userId: to, name: toName, currentBalance: toCurrent, newBalance: toNew },
      });
    } catch (error) {
      logger.error('[adminDepartmentBalance] previewTransfer error:', error);
      return res.status(500).json({ error: 'Failed to preview the transfer' });
    }
  }

  async function confirmTransfer(req: ServerRequest, res: Response) {
    try {
      const { fromUserId, toUserId, amount, expectedFromBalance, expectedToBalance } = (req.body ??
        {}) as {
        fromUserId?: unknown;
        toUserId?: unknown;
        amount?: unknown;
        expectedFromBalance?: unknown;
        expectedToBalance?: unknown;
      };
      const resolved = await resolveTransferParticipants(req, fromUserId, toUserId, amount);
      if (resolved.error) {
        return res.status(resolved.error.status).json(resolved.error.body);
      }
      const {
        department,
        fromUserId: from,
        toUserId: to,
        fromName,
        toName,
        amount: validAmount,
      } = resolved;

      if (!isPositiveAmount(expectedFromBalance) && expectedFromBalance !== 0) {
        return res.status(400).json({ error: 'expectedFromBalance must be a non-negative number' });
      }
      if (!isPositiveAmount(expectedToBalance) && expectedToBalance !== 0) {
        return res.status(400).json({ error: 'expectedToBalance must be a non-negative number' });
      }

      const fromNew = round6((expectedFromBalance as number) - validAmount);
      if (fromNew < 0) {
        return res
          .status(400)
          .json({ error: "amount exceeds the source member's current balance" });
      }
      const toNew = round6((expectedToBalance as number) + validAmount);

      const result = await commitGrantTransaction([
        { userId: from, expectedBalance: expectedFromBalance as number, newBalance: fromNew },
        { userId: to, expectedBalance: expectedToBalance as number, newBalance: toNew },
      ]);

      if (result.status === 'unsupported') {
        return res.status(409).json({
          error:
            'This deployment does not support atomic multi-user transfers (no MongoDB replica set). Nothing was changed.',
        });
      }
      if (result.status === 'stale') {
        return res.status(409).json({
          error: 'One or more balances changed since the preview was generated.',
          stale: result.stale,
        });
      }

      await emitAudit({
        req,
        kind: 'department_transfer',
        department: { id: String(department._id), name: department.name },
        metadata: { fromUserId: from, toUserId: to, amount: validAmount },
      });

      void checkUserOwnThreshold?.(from);
      void checkUserOwnThreshold?.(to);

      return res.status(200).json({
        from: {
          userId: from,
          name: fromName,
          previousBalance: expectedFromBalance,
          newBalance: result.balances[from],
        },
        to: {
          userId: to,
          name: toName,
          previousBalance: expectedToBalance,
          newBalance: result.balances[to],
        },
        committedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[adminDepartmentBalance] confirmTransfer error:', error);
      return res.status(500).json({ error: 'Failed to commit the transfer' });
    }
  }

  return {
    getBalance,
    grant,
    listMyMembers,
    previewDisburse,
    confirmDisburse,
    previewTransfer,
    confirmTransfer,
  };
}
