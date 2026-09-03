import { CLIENT_MESSAGE_SELECT, isValidObjectIdString, logger } from '@librechat/data-schemas';
import type { IUser, IConversation, IMessage } from '@librechat/data-schemas';
import type { FilterQuery } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 25;

export interface AdminUserConversationsDeps {
  findUsers: (
    filter: FilterQuery<IUser>,
    fields?: string | string[] | null,
    options?: { limit?: number },
  ) => Promise<IUser[]>;
  getConvosByCursor: (
    user: string,
    opts: {
      cursor?: string | null;
      limit?: number;
      isArchived?: boolean;
      search?: string;
      sortBy?: string;
      sortDirection?: string;
    },
  ) => Promise<{ conversations: IConversation[]; nextCursor: string | null }>;
  getConvo: (user: string, conversationId: string) => Promise<IConversation | null>;
  getMessages: (
    filter: FilterQuery<IMessage>,
    select?: string,
    options?: { sort?: Record<string, 1 | -1> | false; limit?: number },
  ) => Promise<IMessage[]>;
}

interface HandlerSet {
  listUserConversations: (req: ServerRequest, res: Response) => Promise<Response>;
  getUserConversation: (req: ServerRequest, res: Response) => Promise<Response>;
  getUserConversationMessages: (req: ServerRequest, res: Response) => Promise<Response>;
}

const clampLimit = (raw: unknown): number => {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  if (Number.isNaN(n) || n < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(n, MAX_LIMIT);
};

const stringParam = (raw: unknown): string | undefined =>
  typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined;

export function createAdminUserConversationsHandlers(deps: AdminUserConversationsDeps): HandlerSet {
  const { findUsers, getConvosByCursor, getConvo, getMessages } = deps;

  const resolveUser = async (userId: string): Promise<'invalid' | 'missing' | 'ok'> => {
    if (!isValidObjectIdString(userId)) {
      return 'invalid';
    }
    const [user] = await findUsers({ _id: userId }, '_id', { limit: 1 });
    return user ? 'ok' : 'missing';
  };

  async function listUserConversations(req: ServerRequest, res: Response) {
    try {
      const { userId } = req.params as { userId: string };
      const state = await resolveUser(userId);
      if (state === 'invalid') {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }
      if (state === 'missing') {
        return res.status(404).json({ error: 'User not found' });
      }

      const result = await getConvosByCursor(userId, {
        cursor: stringParam(req.query.cursor) ?? null,
        limit: clampLimit(req.query.limit),
        isArchived: req.query.isArchived === 'true',
        search: stringParam(req.query.search),
        sortBy: stringParam(req.query.sortBy) ?? 'updatedAt',
        sortDirection: stringParam(req.query.sortDirection) ?? 'desc',
      });
      return res.status(200).json(result);
    } catch (error) {
      logger.error('[adminUserConversations] listUserConversations error:', error);
      return res.status(500).json({ error: 'Failed to list conversations' });
    }
  }

  async function getUserConversation(req: ServerRequest, res: Response) {
    try {
      const { userId, conversationId } = req.params as { userId: string; conversationId: string };
      const state = await resolveUser(userId);
      if (state === 'invalid') {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }
      if (state === 'missing') {
        return res.status(404).json({ error: 'User not found' });
      }

      const convo = await getConvo(userId, conversationId);
      if (!convo) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      return res.status(200).json(convo);
    } catch (error) {
      logger.error('[adminUserConversations] getUserConversation error:', error);
      return res.status(500).json({ error: 'Failed to get conversation' });
    }
  }

  async function getUserConversationMessages(req: ServerRequest, res: Response) {
    try {
      const { userId, conversationId } = req.params as { userId: string; conversationId: string };
      const state = await resolveUser(userId);
      if (state === 'invalid') {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }
      if (state === 'missing') {
        return res.status(404).json({ error: 'User not found' });
      }

      const convo = await getConvo(userId, conversationId);
      if (!convo) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const messages = await getMessages({ conversationId, user: userId }, CLIENT_MESSAGE_SELECT, {
        sort: { createdAt: 1 },
      });
      return res.status(200).json(messages);
    } catch (error) {
      logger.error('[adminUserConversations] getUserConversationMessages error:', error);
      return res.status(500).json({ error: 'Failed to get messages' });
    }
  }

  return { listUserConversations, getUserConversation, getUserConversationMessages };
}
