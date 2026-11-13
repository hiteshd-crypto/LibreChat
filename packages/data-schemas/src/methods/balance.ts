import type { ClientSession, Model } from 'mongoose';
import type { IBalance } from '~/types';
import { getTransactionSupport } from '~/utils/transactions';

export interface BalanceValue {
  tokenCredits: number;
}

export type BalanceSetResult =
  | { status: 'updated'; balance: BalanceValue }
  | { status: 'conflict'; current: BalanceValue | null };

/** One participant's expected (preview-time) and intended (post-grant) balance. */
export interface GrantParticipantInput {
  userId: string;
  expectedBalance: number;
  newBalance: number;
}

export type GrantTransactionResult =
  | { status: 'committed'; balances: Record<string, number> }
  | { status: 'unsupported' }
  | { status: 'stale'; stale: Array<{ userId: string; expected: number; current: number }> };

/** Thrown inside the transaction callback to abort on a stale read; never escapes `commitGrantTransaction`. */
class StaleGrantError extends Error {
  constructor(public readonly stale: Array<{ userId: string; expected: number; current: number }>) {
    super('Stale balance detected during grant transaction');
  }
}

export interface BalanceMethods {
  /**
   * Overwrites `tokenCredits` only if it still equals `expected` (`null` = no balance record
   * existed when the caller read it). On a mismatch nothing is written and the current value is
   * returned, so an admin edit made from a stale read can't undo spending that happened since.
   */
  setBalanceIfUnchanged: (
    user: string,
    expected: number | null,
    tokenCredits: number,
  ) => Promise<BalanceSetResult>;
  /** Reads every listed user's current `tokenCredits` in one query (0 for users with no record). */
  getBalancesByUserIds: (userIds: string[]) => Promise<Map<string, number>>;
  /**
   * Sets `tokenCredits` to an already-computed value within a caller-supplied transaction
   * session. Unlike `updateBalance`'s optimistic-retry loop, this performs no read-compare-write
   * cycle of its own — the caller is expected to have already read and validated the current
   * value (e.g. a staleness check) inside the same transaction, so a second CAS layer here would
   * be redundant with — and could conflict with — the transaction's own conflict handling.
   * `receivedDelta` (clamped at 0) bumps the user's cumulative `totalReceived` — the
   * spend-threshold baseline — so only a balance increase ever grows it, never a decrease.
   */
  setBalanceInTransaction: (
    session: ClientSession,
    user: string,
    tokenCredits: number,
    receivedDelta?: number,
  ) => Promise<BalanceValue>;
  /** Reads a user's full balance record (0s if none exists yet) for spend-threshold checks. */
  getBalanceRecord: (
    userId: string,
  ) => Promise<{ tokenCredits: number; totalReceived: number; lastAlertLevel: number }>;
  /** Persists the last spend-threshold level (0 | 80 | 100) a notification was sent for. */
  setUserAlertLevel: (userId: string, level: number) => Promise<void>;
  /**
   * Atomically commits a multi-participant token grant: inside one real MongoDB transaction,
   * re-reads every participant's live balance and aborts with `{status: 'stale'}` if any no
   * longer matches `expectedBalance` (the value the caller showed in its preview), otherwise
   * writes every `newBalance` and commits. Returns `{status: 'unsupported'}` without writing
   * anything if the connected deployment can't run multi-document transactions (no replica set).
   */
  commitGrantTransaction: (
    participants: GrantParticipantInput[],
  ) => Promise<GrantTransactionResult>;
}

export function createBalanceMethods(mongoose: typeof import('mongoose')): BalanceMethods {
  const getModel = (): Model<IBalance> => mongoose.models.Balance as Model<IBalance>;
  let transactionSupportCache: boolean | null = null;

  async function setBalanceIfUnchanged(
    user: string,
    expected: number | null,
    tokenCredits: number,
  ): Promise<BalanceSetResult> {
    const Balance = getModel();

    if (expected === null) {
      const existing = await Balance.findOneAndUpdate(
        { user },
        { $setOnInsert: { tokenCredits } },
        { upsert: true, new: false },
      ).lean<IBalance>();
      return existing
        ? { status: 'conflict', current: { tokenCredits: existing.tokenCredits } }
        : { status: 'updated', balance: { tokenCredits } };
    }

    const updated = await Balance.findOneAndUpdate(
      { user, tokenCredits: expected },
      { $set: { tokenCredits } },
      { new: true },
    ).lean<IBalance>();
    if (updated) {
      return { status: 'updated', balance: { tokenCredits: updated.tokenCredits } };
    }
    const current = await Balance.findOne({ user }).lean<IBalance>();
    return {
      status: 'conflict',
      current: current ? { tokenCredits: current.tokenCredits } : null,
    };
  }

  async function getBalancesByUserIds(userIds: string[]): Promise<Map<string, number>> {
    const balances = new Map<string, number>(userIds.map((userId) => [userId, 0]));
    if (userIds.length === 0) {
      return balances;
    }
    const Balance = getModel();
    const records = await Balance.find({ user: { $in: userIds } }).lean<IBalance[]>();
    for (const record of records) {
      balances.set(record.user.toString(), record.tokenCredits);
    }
    return balances;
  }

  async function setBalanceInTransaction(
    session: ClientSession,
    user: string,
    tokenCredits: number,
    receivedDelta: number = 0,
  ): Promise<BalanceValue> {
    const Balance = getModel();
    const updated = await Balance.findOneAndUpdate(
      { user },
      { $set: { tokenCredits }, $inc: { totalReceived: Math.max(receivedDelta, 0) } },
      { session, upsert: true, new: true },
    ).lean<IBalance>();
    return { tokenCredits: (updated as IBalance).tokenCredits };
  }

  async function getBalanceRecord(
    userId: string,
  ): Promise<{ tokenCredits: number; totalReceived: number; lastAlertLevel: number }> {
    const Balance = getModel();
    const doc = await Balance.findOne({ user: userId }).lean<IBalance>();
    return {
      tokenCredits: doc?.tokenCredits ?? 0,
      totalReceived: doc?.totalReceived ?? 0,
      lastAlertLevel: doc?.lastAlertLevel ?? 0,
    };
  }

  async function setUserAlertLevel(userId: string, level: number): Promise<void> {
    const Balance = getModel();
    await Balance.findOneAndUpdate(
      { user: userId },
      { $set: { lastAlertLevel: level }, $setOnInsert: { user: userId } },
      { upsert: true },
    );
  }

  async function commitGrantTransaction(
    participants: GrantParticipantInput[],
  ): Promise<GrantTransactionResult> {
    const supported = await getTransactionSupport(mongoose, transactionSupportCache);
    transactionSupportCache = supported;
    if (!supported) {
      return { status: 'unsupported' };
    }

    const Balance = getModel();
    const session = await mongoose.startSession();
    try {
      const balances: Record<string, number> = {};
      await session.withTransaction(
        async () => {
          const stale: Array<{ userId: string; expected: number; current: number }> = [];
          for (const participant of participants) {
            const existing = await Balance.findOne({ user: participant.userId })
              .session(session)
              .lean<IBalance>();
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
            throw new StaleGrantError(stale);
          }
          for (const participant of participants) {
            const result = await setBalanceInTransaction(
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
      return { status: 'committed', balances };
    } catch (error) {
      if (error instanceof StaleGrantError) {
        return { status: 'stale', stale: error.stale };
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  return {
    setBalanceIfUnchanged,
    getBalancesByUserIds,
    setBalanceInTransaction,
    getBalanceRecord,
    setUserAlertLevel,
    commitGrantTransaction,
  };
}
