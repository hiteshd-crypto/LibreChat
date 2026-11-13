import type { FilterQuery } from 'mongoose';
import type { IUser } from '~/types';
import logger from '~/config/winston';

/** 80%/100% of a member's cumulative "ever received" balance spent — the two alert levels. */
const ALERT_LEVELS = [80, 100] as const;
/** Skip a repeat check for the same user within this window — a burst of chat
 * messages from one person shouldn't trigger a Mongo read per message. */
const DEBOUNCE_MS = 5000;

export interface SpendAlertDeps {
  findUsers: (
    filter: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
    options?: { limit?: number; offset?: number },
  ) => Promise<IUser[]>;
  getBalanceRecord: (
    userId: string,
  ) => Promise<{ tokenCredits: number; totalReceived: number; lastAlertLevel: number }>;
  setUserAlertLevel: (userId: string, level: number) => Promise<void>;
  createNotification: (input: {
    user: string;
    type: string;
    title: string;
    message: string;
    severity: 'warning' | 'error';
    metadata?: Record<string, unknown>;
    tenantId?: string;
  }) => Promise<unknown>;
}

export interface SpendAlertMethods {
  /** Recomputes a member's own spend percentage and, on a new upward threshold
   * crossing, notifies the member themself — no one else. Self-heals
   * `lastAlertLevel` back down (so a later re-cross after a fresh disbursement or
   * transfer alerts again). Returns `true` only when a crossing was just notified,
   * so a real-time caller (e.g. an open chat stream) knows whether to push an
   * immediate "check your notifications" signal to the client. */
  checkUserOwnThreshold: (userId: string) => Promise<boolean>;
}

export function createSpendAlertMethods(deps: SpendAlertDeps): SpendAlertMethods {
  const { findUsers, getBalanceRecord, setUserAlertLevel, createNotification } = deps;

  const lastCheckedAt = new Map<string, number>();

  function levelFor(usedPct: number): number {
    for (const level of [...ALERT_LEVELS].reverse()) {
      if (usedPct >= level) {
        return level;
      }
    }
    return 0;
  }

  async function notifyMember(
    member: Pick<IUser, '_id' | 'name' | 'username' | 'email' | 'tenantId'>,
    level: number,
    tenantId?: string,
  ): Promise<void> {
    const memberId = member._id.toString();
    const severity = level >= 100 ? 'error' : 'warning';
    /** Only the 100% notification names the exact moment the balance ran out —
     * an 80% warning has no single "consumed at" instant to report. */
    const consumedAt = level >= 100 ? new Date().toLocaleString() : null;

    await createNotification({
      user: memberId,
      type: 'spend_threshold',
      title: `You've used ${level}% of your balance`,
      message:
        level >= 100
          ? `Your balance was fully consumed on ${consumedAt}.`
          : `You have used ${level}% of your allocated balance.`,
      severity,
      metadata: { level },
      tenantId,
    });
  }

  async function checkUserOwnThreshold(userId: string): Promise<boolean> {
    const now = Date.now();
    const last = lastCheckedAt.get(userId);
    if (last != null && now - last < DEBOUNCE_MS) {
      return false;
    }
    lastCheckedAt.set(userId, now);

    try {
      const { tokenCredits, totalReceived, lastAlertLevel } = await getBalanceRecord(userId);
      if (totalReceived <= 0) {
        return false;
      }
      const usedPct = ((totalReceived - tokenCredits) / totalReceived) * 100;
      const newLevel = levelFor(usedPct);

      if (newLevel === lastAlertLevel) {
        return false;
      }
      await setUserAlertLevel(userId, newLevel);
      if (newLevel > lastAlertLevel) {
        const [member] = await findUsers({ _id: userId }, 'name username email tenantId');
        if (member) {
          await notifyMember(member, newLevel, member.tenantId);
          return true;
        }
      }
      return false;
    } catch (error) {
      logger.error(`[checkUserOwnThreshold] failed for user ${userId}:`, error);
      return false;
    }
  }

  return { checkUserOwnThreshold };
}
