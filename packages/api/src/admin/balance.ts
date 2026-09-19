import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type { TAdminUserBalance, TAdminUserBalanceUpdateBody } from 'librechat-data-provider';
import type { IUser } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';

interface BalanceRecord {
  tokenCredits: number;
}

type BalanceSetResult =
  | { status: 'updated'; balance: BalanceRecord }
  | { status: 'conflict'; current: BalanceRecord | null };

interface UserIdParams {
  userId?: string;
}

export interface AdminBalanceDeps {
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
  const { getUserById, findBalanceByUser, upsertBalanceFields, setBalanceIfUnchanged } = deps;

  function parseUserId(req: ServerRequest): string | null {
    const { userId } = req.params as UserIdParams;
    return userId && isValidObjectIdString(userId) ? userId : null;
  }

  async function getBalance(req: ServerRequest, res: Response) {
    try {
      const userId = parseUserId(req);
      if (!userId) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }
      const user = await getUserById(userId, '_id');
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
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
      const user = await getUserById(userId, '_id');
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (expectedTokenCredits === undefined) {
        const record = await upsertBalanceFields(userId, { tokenCredits });
        return res.status(200).json(toBalance(userId, record));
      }
      const result = await setBalanceIfUnchanged(userId, expectedTokenCredits, tokenCredits);
      if (result.status === 'conflict') {
        return res.status(409).json({
          error: 'The balance changed since it was loaded',
          balance: toBalance(userId, result.current),
        });
      }
      return res.status(200).json(toBalance(userId, result.balance));
    } catch (error) {
      logger.error('[adminBalance] setBalance error:', error);
      return res.status(500).json({ error: 'Failed to update user balance' });
    }
  }

  return { getBalance, setBalance };
}
