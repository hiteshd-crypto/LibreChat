import type { Model } from 'mongoose';
import type { IBalance } from '~/types';

export interface BalanceValue {
  tokenCredits: number;
}

export type BalanceSetResult =
  | { status: 'updated'; balance: BalanceValue }
  | { status: 'conflict'; current: BalanceValue | null };

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
}

export function createBalanceMethods(mongoose: typeof import('mongoose')): BalanceMethods {
  const getModel = (): Model<IBalance> => mongoose.models.Balance as Model<IBalance>;

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

  return { setBalanceIfUnchanged };
}
