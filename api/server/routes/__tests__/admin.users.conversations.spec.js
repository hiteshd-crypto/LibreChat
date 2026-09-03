const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { createModels, createMethods } = require('@librechat/data-schemas');
const { SystemRoles } = require('librechat-data-provider');
const { connectTestDb } = require('../../../test/connectTestDb');

/**
 * Integration test for the admin user-conversation viewer routes.
 *
 * Validates the Express wiring: route registration → handler → real MongoDB.
 * Auth/capability middleware is injected (matching grants.spec.js) so the
 * caller identity is controlled without a real JWT; handler DI deps use real
 * DB methods. Middleware enforcement of ACCESS_ADMIN/READ_USERS is shared,
 * unchanged, and covered by the capabilities middleware tests.
 */

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (_req, _res, next) => next(),
}));

jest.mock('~/server/middleware/roles/capabilities', () => ({
  requireCapability: () => (_req, _res, next) => next(),
}));

let teardown;
let db;

beforeAll(async () => {
  teardown = await connectTestDb();
  createModels(mongoose);
  db = createMethods(mongoose);
}, 60000);

afterAll(async () => {
  await teardown();
});

afterEach(async () => {
  await Promise.all([
    mongoose.models.User.deleteMany({}),
    mongoose.models.Conversation.deleteMany({}),
    mongoose.models.Message.deleteMany({}),
  ]);
});

function createApp() {
  const { createAdminUserConversationsHandlers } = require('@librechat/api');
  const conversationHandlers = createAdminUserConversationsHandlers({
    findUsers: db.findUsers,
    getConvosByCursor: db.getConvosByCursor,
    getConvo: db.getConvo,
    getMessages: db.getMessages,
  });

  const app = express();
  app.use(express.json());

  const router = express.Router();
  // Route ordering under test: /search must not be shadowed by /:userId.
  router.get('/search', (_req, res) => res.status(200).json({ users: [] }));
  router.get('/:userId/conversations', conversationHandlers.listUserConversations);
  router.get('/:userId/conversations/:conversationId', conversationHandlers.getUserConversation);
  router.get(
    '/:userId/conversations/:conversationId/messages',
    conversationHandlers.getUserConversationMessages,
  );
  app.use('/api/admin/users', router);
  return app;
}

let seedCounter = 0;

async function createTestUser(name) {
  seedCounter += 1;
  const user = await mongoose.models.User.create({
    email: `${name}-${seedCounter}-${Date.now()}@x.io`,
    name,
    provider: 'local',
    role: SystemRoles.USER,
  });
  return user._id.toString();
}

async function seedUserWithConversation() {
  const userId = await createTestUser('Owner');
  const conversationId = `conv-${(seedCounter += 1)}-${Date.now()}`;
  await mongoose.models.Conversation.create({
    conversationId,
    user: userId,
    title: 'Trip plan',
    endpoint: 'openAI',
  });
  await mongoose.models.Message.create([
    { user: userId, conversationId, messageId: 'm1', parentMessageId: null, text: 'hello' },
    { user: userId, conversationId, messageId: 'm2', parentMessageId: 'm1', text: 'hi there' },
  ]);
  return { userId, conversationId };
}

describe('Admin user-conversation viewer routes — Integration', () => {
  it('lists a target user’s conversations', async () => {
    const { userId, conversationId } = await seedUserWithConversation();
    const app = createApp();

    const res = await request(app).get(`/api/admin/users/${userId}/conversations`).expect(200);

    expect(res.body).toHaveProperty('conversations');
    expect(res.body.conversations).toHaveLength(1);
    expect(res.body.conversations[0].conversationId).toBe(conversationId);
  });

  it('returns 400 for a malformed userId', async () => {
    const app = createApp();
    const res = await request(app).get('/api/admin/users/not-an-id/conversations');
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown userId', async () => {
    const app = createApp();
    const unknown = new mongoose.Types.ObjectId().toString();
    const res = await request(app).get(`/api/admin/users/${unknown}/conversations`);
    expect(res.status).toBe(404);
  });

  it('returns a single owned conversation and 404 for a mismatched owner', async () => {
    const { userId, conversationId } = await seedUserWithConversation();
    const otherUserId = await createTestUser('Other');
    const app = createApp();

    const owned = await request(app).get(
      `/api/admin/users/${userId}/conversations/${conversationId}`,
    );
    expect(owned.status).toBe(200);
    expect(owned.body.conversationId).toBe(conversationId);

    const foreign = await request(app).get(
      `/api/admin/users/${otherUserId}/conversations/${conversationId}`,
    );
    expect(foreign.status).toBe(404);
  });

  it('serves ordered messages for an owned conversation, 404 for a mismatched owner', async () => {
    const { userId, conversationId } = await seedUserWithConversation();
    const otherUserId = await createTestUser('Other2');
    const app = createApp();

    const ok = await request(app).get(
      `/api/admin/users/${userId}/conversations/${conversationId}/messages`,
    );
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.body)).toBe(true);
    expect(ok.body).toHaveLength(2);
    expect(ok.body[0]).not.toHaveProperty('user');

    const foreign = await request(app).get(
      `/api/admin/users/${otherUserId}/conversations/${conversationId}/messages`,
    );
    expect(foreign.status).toBe(404);
  });

  it('does not shadow /api/admin/users/search', async () => {
    const app = createApp();
    const res = await request(app).get('/api/admin/users/search?q=abc');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('users');
  });

  // Regression guard for spec §5.2: the owner-scoped model reads the whole feature
  // (and the untouched /api/convos, /api/messages routes) rely on must keep
  // returning nothing for a non-owner.
  it('getConvo / getMessages stay owner-scoped', async () => {
    const { userId, conversationId } = await seedUserWithConversation();
    const otherUserId = await createTestUser('Snoop');

    expect(await db.getConvo(otherUserId, conversationId)).toBeNull();
    expect(await db.getConvo(userId, conversationId)).not.toBeNull();

    const foreignMessages = await db.getMessages({ conversationId, user: otherUserId });
    expect(foreignMessages).toHaveLength(0);
    const ownMessages = await db.getMessages({ conversationId, user: userId });
    expect(ownMessages).toHaveLength(2);
  });
});
