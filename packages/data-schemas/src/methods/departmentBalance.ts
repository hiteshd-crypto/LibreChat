import type { ClientSession, Model } from 'mongoose';
import type { BalanceValue, GrantParticipantInput, GrantTransactionResult } from './balance';
import type { IDepartmentBalance, IDepartment, IUser } from '~/types';
import { getTransactionSupport } from '~/utils/transactions';
import logger from '~/config/winston';

export type DisbursementTransactionResult =
  | { status: 'committed'; poolBalance: number; balances: Record<string, number> }
  | { status: 'unsupported' }
  | { status: 'pool_stale'; expectedPoolBalance: number; currentPoolBalance: number }
  | { status: 'pool_insufficient'; poolBalance: number; requested: number }
  | { status: 'stale'; stale: Array<{ userId: string; expected: number; current: number }> };

/** Thrown inside the transaction callback to abort on a stale pool read. */
class PoolStaleError extends Error {
  constructor(
    public readonly expectedPoolBalance: number,
    public readonly currentPoolBalance: number,
  ) {
    super('Stale pool balance detected during disbursement transaction');
  }
}

/** Thrown inside the transaction callback to abort when the pool can't cover the requested delta. */
class PoolInsufficientError extends Error {
  constructor(
    public readonly poolBalance: number,
    public readonly requested: number,
  ) {
    super('Pool balance insufficient for requested disbursement');
  }
}

/** Thrown inside the transaction callback to abort on a stale participant read. */
class StaleParticipantError extends Error {
  constructor(public readonly stale: Array<{ userId: string; expected: number; current: number }>) {
    super('Stale balance detected during disbursement transaction');
  }
}

export interface DepartmentBalanceMethods {
  /** Reads a department's current pool balance (0 if no pool record exists yet). */
  getDepartmentBalance: (departmentId: string, tenantId?: string) => Promise<number>;
  /**
   * Atomically adds (or subtracts, via a negative `amount`) to a department's pool balance.
   * A pure `$inc` upsert has no staleness hazard — unlike an absolute `$set` from a possibly
   * stale read — so no transaction or preview/confirm step is needed for this operation alone.
   */
  incrementDepartmentBalance: (
    departmentId: string,
    amount: number,
    tenantId?: string,
  ) => Promise<number>;
  /**
   * Atomically commits a disbursement out of a department's pool to one or more member
   * participants: inside one real MongoDB transaction, re-reads the pool balance (aborting
   * with `pool_stale` if it no longer matches `expectedPoolBalance`), computes the total delta
   * across every participant (aborting with `pool_insufficient` if it exceeds the live pool
   * balance), re-reads every participant's live balance (aborting with `stale` on any
   * mismatch), then decrements the pool and writes every participant's `newBalance` together.
   * Returns `{status: 'unsupported'}` without writing anything if the connected deployment
   * can't run multi-document transactions (no replica set).
   */
  commitDisbursementTransaction: (args: {
    departmentId: string;
    tenantId?: string;
    expectedPoolBalance: number;
    participants: GrantParticipantInput[];
  }) => Promise<DisbursementTransactionResult>;
  /**
   * One-time, idempotent migration: for every Department with a root role, sums its heads'
   * current personal `Balance.tokenCredits`, zeroes those balances, and moves the sum into the
   * department's pool. A department whose heads sum to 0 is skipped — this is also what makes
   * a second run a true no-op, with no separate "already migrated" flag needed.
   */
  migrateHeadBalancesToPool: (options?: { dryRun?: boolean }) => Promise<{
    migrated: number;
    totalMoved: number;
    dryRun: boolean;
    planned: string[];
  }>;
}

export function createDepartmentBalanceMethods(
  mongoose: typeof import('mongoose'),
): DepartmentBalanceMethods {
  const getModel = (): Model<IDepartmentBalance> =>
    mongoose.models.DepartmentBalance as Model<IDepartmentBalance>;
  let transactionSupportCache: boolean | null = null;

  async function getDepartmentBalance(departmentId: string, tenantId?: string): Promise<number> {
    const DepartmentBalance = getModel();
    const filter: Record<string, unknown> = { department: departmentId };
    if (tenantId != null) {
      filter.tenantId = tenantId;
    }
    const doc = await DepartmentBalance.findOne(filter).lean<IDepartmentBalance>();
    return doc?.balance ?? 0;
  }

  async function incrementDepartmentBalance(
    departmentId: string,
    amount: number,
    tenantId?: string,
  ): Promise<number> {
    const DepartmentBalance = getModel();
    const filter: Record<string, unknown> = { department: departmentId };
    if (tenantId != null) {
      filter.tenantId = tenantId;
    }
    const updated = await DepartmentBalance.findOneAndUpdate(
      filter,
      { $inc: { balance: amount }, $setOnInsert: { department: departmentId, tenantId } },
      { upsert: true, new: true },
    ).lean<IDepartmentBalance>();
    return (updated as IDepartmentBalance).balance;
  }

  async function setParticipantBalanceInTransaction(
    session: ClientSession,
    user: string,
    tokenCredits: number,
    receivedDelta: number = 0,
  ): Promise<BalanceValue> {
    const Balance = mongoose.models.Balance as Model<{
      user: unknown;
      tokenCredits: number;
      totalReceived: number;
    }>;
    const updated = await Balance.findOneAndUpdate(
      { user },
      { $set: { tokenCredits }, $inc: { totalReceived: Math.max(receivedDelta, 0) } },
      { session, upsert: true, new: true },
    ).lean<{ tokenCredits: number }>();
    return { tokenCredits: (updated as { tokenCredits: number }).tokenCredits };
  }

  async function commitDisbursementTransaction(args: {
    departmentId: string;
    tenantId?: string;
    expectedPoolBalance: number;
    participants: GrantParticipantInput[];
  }): Promise<DisbursementTransactionResult> {
    const { departmentId, tenantId, expectedPoolBalance, participants } = args;
    const supported = await getTransactionSupport(mongoose, transactionSupportCache);
    transactionSupportCache = supported;
    if (!supported) {
      return { status: 'unsupported' };
    }

    const DepartmentBalance = getModel();
    const Balance = mongoose.models.Balance as Model<{ user: unknown; tokenCredits: number }>;
    const poolFilter: Record<string, unknown> = { department: departmentId };
    if (tenantId != null) {
      poolFilter.tenantId = tenantId;
    }

    const session = await mongoose.startSession();
    try {
      let finalPoolBalance = 0;
      const balances: Record<string, number> = {};
      await session.withTransaction(
        async () => {
          const poolDoc = await DepartmentBalance.findOne(poolFilter)
            .session(session)
            .lean<IDepartmentBalance>();
          const currentPoolBalance = poolDoc?.balance ?? 0;
          if (currentPoolBalance !== expectedPoolBalance) {
            throw new PoolStaleError(expectedPoolBalance, currentPoolBalance);
          }

          const totalDelta = participants.reduce(
            (sum, participant) => sum + (participant.newBalance - participant.expectedBalance),
            0,
          );
          if (totalDelta > currentPoolBalance) {
            throw new PoolInsufficientError(currentPoolBalance, totalDelta);
          }

          const stale: Array<{ userId: string; expected: number; current: number }> = [];
          for (const participant of participants) {
            const existing = await Balance.findOne({ user: participant.userId })
              .session(session)
              .lean<{ tokenCredits: number }>();
            const current = existing?.tokenCredits ?? 0;
            if (current !== participant.expectedBalance) {
              stale.push({
                userId: participant.userId,
                expected: participant.expectedBalance,
                current,
              });
            }
          }
          if (stale.length > 0) {
            throw new StaleParticipantError(stale);
          }

          await DepartmentBalance.findOneAndUpdate(
            poolFilter,
            {
              $inc: { balance: -totalDelta },
              $setOnInsert: { department: departmentId, tenantId },
            },
            { session, upsert: true },
          );
          finalPoolBalance = currentPoolBalance - totalDelta;

          for (const participant of participants) {
            const result = await setParticipantBalanceInTransaction(
              session,
              participant.userId,
              participant.newBalance,
              participant.newBalance - participant.expectedBalance,
            );
            balances[participant.userId] = result.tokenCredits;
          }
        },
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
      );
      return { status: 'committed', poolBalance: finalPoolBalance, balances };
    } catch (error) {
      if (error instanceof PoolStaleError) {
        return {
          status: 'pool_stale',
          expectedPoolBalance: error.expectedPoolBalance,
          currentPoolBalance: error.currentPoolBalance,
        };
      }
      if (error instanceof PoolInsufficientError) {
        return {
          status: 'pool_insufficient',
          poolBalance: error.poolBalance,
          requested: error.requested,
        };
      }
      if (error instanceof StaleParticipantError) {
        return { status: 'stale', stale: error.stale };
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async function migrateHeadBalancesToPool(options: { dryRun?: boolean } = {}): Promise<{
    migrated: number;
    totalMoved: number;
    dryRun: boolean;
    planned: string[];
  }> {
    const dryRun = options.dryRun === true;
    const Department = mongoose.models.Department as Model<IDepartment>;
    const User = mongoose.models.User as Model<IUser>;
    const Balance = mongoose.models.Balance as Model<{ user: unknown; tokenCredits: number }>;
    const planned: string[] = [];

    const departments = await Department.find({ rootRoleKey: { $ne: null } }).lean<IDepartment[]>();

    let migrated = 0;
    let totalMoved = 0;
    for (const department of departments) {
      const rootRoleKey = department.rootRoleKey as string;
      const heads = await User.find({ role: rootRoleKey }, '_id').lean<Array<{ _id: unknown }>>();
      if (heads.length === 0) {
        continue;
      }
      const headIds = heads.map((head) => head._id);
      const headBalances = await Balance.find({ user: { $in: headIds } }).lean<
        Array<{ user: unknown; tokenCredits: number }>
      >();
      const sum = headBalances.reduce((total, balance) => total + (balance.tokenCredits ?? 0), 0);
      if (sum <= 0) {
        continue;
      }

      planned.push(
        `department "${department.name}" (${String(department._id)}): move ${sum} from ${headIds.length} head(s) into pool`,
      );
      migrated += 1;
      totalMoved += sum;

      if (dryRun) {
        continue;
      }

      const tenantId = (department as unknown as { tenantId?: string }).tenantId;
      const departmentId = String(department._id);
      const supported = await getTransactionSupport(mongoose, transactionSupportCache);
      transactionSupportCache = supported;

      if (supported) {
        const session = await mongoose.startSession();
        try {
          await session.withTransaction(async () => {
            await Balance.updateMany(
              { user: { $in: headIds } },
              { $set: { tokenCredits: 0 } },
              { session },
            );
            await getModel().findOneAndUpdate(
              { department: departmentId, tenantId },
              { $inc: { balance: sum }, $setOnInsert: { department: departmentId, tenantId } },
              { session, upsert: true },
            );
          });
        } finally {
          await session.endSession();
        }
      } else {
        logger.warn(
          `[migrateHeadBalancesToPool] No transaction support; migrating department "${department.name}" non-transactionally`,
        );
        await Balance.updateMany({ user: { $in: headIds } }, { $set: { tokenCredits: 0 } });
        await getModel().findOneAndUpdate(
          { department: departmentId, tenantId },
          { $inc: { balance: sum }, $setOnInsert: { department: departmentId, tenantId } },
          { upsert: true },
        );
      }
    }

    if (!dryRun && migrated > 0) {
      logger.info(`[migrateHeadBalancesToPool] migrated=${migrated} totalMoved=${totalMoved}`);
    }

    return { migrated, totalMoved, dryRun, planned };
  }

  return {
    getDepartmentBalance,
    incrementDepartmentBalance,
    commitDisbursementTransaction,
    migrateHeadBalancesToPool,
  };
}

export type { GrantParticipantInput, GrantTransactionResult };
