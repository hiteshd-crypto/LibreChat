import { Types } from 'mongoose';
import type { IUser, IConversation, IMessage } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { AdminUserConversationsDeps } from './conversations';
import type { ServerRequest } from '~/types/http';
import { createAdminUserConversationsHandlers } from './conversations';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const ownerId = new Types.ObjectId().toString();
const otherId = new Types.ObjectId().toString();
const convoId = 'conv-1';

function mockConvo(overrides: Partial<IConversation> = {}): IConversation {
  return {
    conversationId: convoId,
    user: ownerId,
    title: 'Trip plan',
    endpoint: 'openAI',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    ...overrides,
  } as IConversation;
}

function mockMessage(overrides: Partial<IMessage> = {}): IMessage {
  return {
    messageId: 'm1',
    conversationId: convoId,
    parentMessageId: null,
    text: 'hello',
    isCreatedByUser: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as IMessage;
}

function createReqRes(
  overrides: {
    params?: Record<string, string>;
    query?: Record<string, string | string[]>;
  } = {},
) {
  const req = {
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    body: {},
    user: { _id: new Types.ObjectId(), role: 'ADMIN' },
  } as unknown as ServerRequest;

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;

  return { req, res, status, json };
}

function createDeps(
  overrides: Partial<AdminUserConversationsDeps> = {},
): AdminUserConversationsDeps {
  return {
    findUsers: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId(ownerId) } as IUser]),
    getConvosByCursor: jest
      .fn()
      .mockResolvedValue({ conversations: [mockConvo()], nextCursor: null }),
    getConvo: jest.fn().mockResolvedValue(mockConvo()),
    getMessages: jest.fn().mockResolvedValue([
      mockMessage({ messageId: 'm1', createdAt: new Date('2026-01-01T00:00:00Z') }),
      mockMessage({
        messageId: 'm2',
        parentMessageId: 'm1',
        text: 'hi there',
        isCreatedByUser: false,
        createdAt: new Date('2026-01-01T00:01:00Z'),
      }),
    ]),
    ...overrides,
  };
}

describe('createAdminUserConversationsHandlers', () => {
  describe('listUserConversations', () => {
    it("returns the target user's conversations", async () => {
      const deps = createDeps();
      const handlers = createAdminUserConversationsHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { userId: ownerId }, query: {} });

      await handlers.listUserConversations(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const body = json.mock.calls[0][0];
      expect(body.conversations).toHaveLength(1);
      expect(body.conversations[0].conversationId).toBe(convoId);
      expect(deps.getConvosByCursor).toHaveBeenCalledWith(
        ownerId,
        expect.objectContaining({ limit: 25, sortBy: 'updatedAt', sortDirection: 'desc' }),
      );
    });

    it('clamps limit to 50', async () => {
      const deps = createDeps();
      const handlers = createAdminUserConversationsHandlers(deps);
      const { req, res } = createReqRes({ params: { userId: ownerId }, query: { limit: '500' } });

      await handlers.listUserConversations(req, res);

      expect(deps.getConvosByCursor).toHaveBeenCalledWith(
        ownerId,
        expect.objectContaining({ limit: 50 }),
      );
    });

    it('returns 400 for a malformed userId', async () => {
      const deps = createDeps();
      const handlers = createAdminUserConversationsHandlers(deps);
      const { req, res, status } = createReqRes({ params: { userId: 'not-an-id' }, query: {} });

      await handlers.listUserConversations(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.getConvosByCursor).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown userId', async () => {
      const deps = createDeps({ findUsers: jest.fn().mockResolvedValue([]) });
      const handlers = createAdminUserConversationsHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { userId: new Types.ObjectId().toString() },
        query: {},
      });

      await handlers.listUserConversations(req, res);

      expect(status).toHaveBeenCalledWith(404);
    });

    it('returns 500 when the model throws', async () => {
      const deps = createDeps({
        getConvosByCursor: jest.fn().mockRejectedValue(new Error('boom')),
      });
      const handlers = createAdminUserConversationsHandlers(deps);
      const { req, res, status } = createReqRes({ params: { userId: ownerId }, query: {} });

      await handlers.listUserConversations(req, res);

      expect(status).toHaveBeenCalledWith(500);
    });
  });

  describe('getUserConversation', () => {
    it('returns a single conversation owned by the target user', async () => {
      const deps = createDeps();
      const handlers = createAdminUserConversationsHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { userId: ownerId, conversationId: convoId },
      });

      await handlers.getUserConversation(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json.mock.calls[0][0].conversationId).toBe(convoId);
      expect(deps.getConvo).toHaveBeenCalledWith(ownerId, convoId);
    });

    it('returns 404 when the conversation is not owned by the target user', async () => {
      const deps = createDeps({ getConvo: jest.fn().mockResolvedValue(null) });
      const handlers = createAdminUserConversationsHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { userId: otherId, conversationId: convoId },
      });

      await handlers.getUserConversation(req, res);

      expect(status).toHaveBeenCalledWith(404);
    });
  });

  describe('getUserConversationMessages', () => {
    it('returns the conversation messages, ordered', async () => {
      const deps = createDeps();
      const handlers = createAdminUserConversationsHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { userId: ownerId, conversationId: convoId },
      });

      await handlers.getUserConversationMessages(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const body = json.mock.calls[0][0];
      expect(body).toHaveLength(2);
      expect(deps.getMessages).toHaveBeenCalledWith(
        { conversationId: convoId, user: ownerId },
        expect.any(String),
        { sort: { createdAt: 1 } },
      );
    });

    it('returns 404 when the conversation is not owned by the target user', async () => {
      const deps = createDeps({ getConvo: jest.fn().mockResolvedValue(null) });
      const handlers = createAdminUserConversationsHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { userId: otherId, conversationId: convoId },
      });

      await handlers.getUserConversationMessages(req, res);

      expect(status).toHaveBeenCalledWith(404);
      expect(deps.getMessages).not.toHaveBeenCalled();
    });
  });
});
