# In-App Admin Area Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only in-app area to the LibreChat client — a sidebar "Admin" entry with an Access (Roles) screen and a read-only conversation viewer for browsing any user's conversations.

**Architecture:** Mirrors the existing Insights feature: a conditional sidebar `NavLink`, lazy routes under the authenticated `Root`, view components that re-check the admin role, and data hooks in `client/src/data-provider`. The Roles screen consumes the already-mounted `/api/admin/roles*` endpoints unchanged. The conversation viewer adds three new read-only endpoints under the already-gated `/api/admin/users/:userId/conversations*` and reuses the Share feature's read-only message renderer (`client/src/components/Share/MessagesView.tsx` + `buildTree`).

**Tech Stack:** React 19 + react-router-dom, `@tanstack/react-query` (v4 array-key style), `@librechat/client` UI primitives, Tailwind semantic tokens, Express 5 (`api/`), TypeScript backend logic (`packages/api`), Mongoose models (`packages/data-schemas`), shared types/endpoints (`packages/data-provider`). Jest + `mongodb-memory-server` for backend tests; Jest + `test/layout-test-utils` for client tests.

**Spec:** `docs/superpowers/specs/2026-09-03-in-app-admin-area-design.md`

## Global Constraints

- **New backend logic is TypeScript in `packages/api`**; `api/` changes are thin wiring only (LibreChat CLAUDE.md).
- **Never use `any`**; no `unknown`/`Record<string, unknown>` where an explicit type exists. Reuse `TConversation`/`TMessage`/`AdminMember` from existing packages — do not redefine.
- **All user-facing client strings** go through `useLocalize()`; add keys only to `client/src/locales/en/translation.json`, prefix `com_admin_`.
- **Tailwind: semantic tokens only** (e.g. `text-text-primary`, `bg-surface-secondary`) — no raw palette utilities, no hex, no `dark:` literals in feature components.
- **Authorization is server-side.** No endpoint may read a role, userId, or acting identity from a request body/query/header for authz. `:userId` path params are data-scope filters only, behind capability middleware.
- **Do not modify** the behavior of `/api/convos/*` or `/api/messages/*`, the external `librechat-admin-panel` repo, or any feature outside this plan.
- After editing `packages/data-provider`, run `npm run build:data-provider` before client typecheck.
- Run `npx tsc --noEmit` in every workspace you touched; `npm run lint` and `npm run sort-imports -- <files>` on touched files.
- React Query here is v4: `useQuery([key, ...parts], fn, optionsObject)` — match `client/src/data-provider/roles.ts`.
- Commit after every task with a `feat:` / `test:` message. Work on a branch, not `main`.

---

## File Structure

**New files:**

| File | Responsibility |
|---|---|
| `packages/api/src/admin/conversations.ts` | `createAdminUserConversationsHandlers` factory — 3 read-only handlers scoping conversation/message reads to a target `:userId` |
| `packages/api/src/admin/conversations.spec.ts` | Unit tests for the factory (real in-memory Mongo) |
| `packages/data-provider/src/types/admin.ts` | Admin request/response types |
| `client/src/data-provider/Admin/queries.ts` | React Query read hooks |
| `client/src/data-provider/Admin/mutations.ts` | React Query write hooks (roles + members) |
| `client/src/data-provider/Admin/index.ts` | Barrel |
| `client/src/components/Admin/guard.ts` | `useAdminGuard()` hook |
| `client/src/components/Admin/AdminLayout.tsx` | Shell: header, sub-nav (Access \| Users), `<Outlet/>` |
| `client/src/components/Admin/index.ts` | Barrel of route components |
| `client/src/components/Admin/Access/AccessView.tsx` | Roles list screen |
| `client/src/components/Admin/Access/RoleRow.tsx` | One role row |
| `client/src/components/Admin/Access/CreateRoleDialog.tsx` | Create role |
| `client/src/components/Admin/Access/EditRoleDialog.tsx` | Rename/delete + Members tab host |
| `client/src/components/Admin/Access/RoleMembersPanel.tsx` | Member list + add (user search) + remove |
| `client/src/components/Admin/Users/UsersView.tsx` | User list + search |
| `client/src/components/Admin/Users/UserRow.tsx` | One user row |
| `client/src/components/Admin/Users/UserConversationsView.tsx` | One user's conversation list |
| `client/src/components/Admin/Users/ConversationTranscript.tsx` | Read-only message transcript |
| `client/src/components/Admin/Users/ViewingBanner.tsx` | "Viewing X's conversations — read only" banner |

**Modified files:**

| File | Change |
|---|---|
| `packages/api/src/admin/index.ts` | export `createAdminUserConversationsHandlers` |
| `packages/api/src/index.ts` | ensure the new export is re-exported (if `admin/index` is not already spread) |
| `api/server/routes/admin/users.js` | wire 3 new routes after `/search` |
| `packages/data-provider/src/api-endpoints.ts` | admin URL builders |
| `packages/data-provider/src/data-service.ts` | admin service functions |
| `packages/data-provider/src/types.ts` | `export * from './types/admin'` |
| `packages/data-provider/src/keys.ts` | new `QueryKeys` entries |
| `client/src/data-provider/index.ts` | `export * from './Admin'` |
| `client/src/routes/index.tsx` | lazy admin routes under `Root` |
| `client/src/hooks/Nav/useUnifiedSidebarLinks.ts` | admin `NavLink` when `role === ADMIN` |
| `client/src/components/UnifiedSidebar/ExpandedPanel.tsx` | treat `/admin` as a full-page route like `/insights` |
| `client/src/locales/en/translation.json` | `com_admin_*` keys |

---

## Task 1: Backend — admin user-conversations handler factory

**Files:**
- Create: `packages/api/src/admin/conversations.ts`
- Test: `packages/api/src/admin/conversations.spec.ts`

**Interfaces:**
- Consumes (from existing `packages/data-schemas` method types):
  - `getConvosByCursor(user: string, opts): Promise<{ conversations: IConversation[]; nextCursor: string | null }>`
  - `getConvo(user: string, conversationId: string): Promise<IConversation | null>`
  - `getMessages(filter: FilterQuery<IMessage>, select?: string, options?: { sort?: Record<string,1|-1>|false; limit?: number }): Promise<IMessage[]>`
  - `CLIENT_MESSAGE_SELECT` from `@librechat/data-schemas`
  - `isValidObjectIdString` from `@librechat/data-schemas`
- Produces:
  - `createAdminUserConversationsHandlers(deps: AdminUserConversationsDeps): { listUserConversations; getUserConversation; getUserConversationMessages }`
  - `interface AdminUserConversationsDeps { findUsers; getConvosByCursor; getConvo; getMessages }`
  - Each handler: `(req: ServerRequest, res: Response) => Promise<Response>`

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/admin/conversations.spec.ts`. Follow `packages/api/src/admin/users.spec.ts` for the mongodb-memory-server + model-registration setup. Use the real `@librechat/data-schemas` methods bound to an in-memory connection; seed two users and conversations/messages owned by each.

```ts
import { Types } from 'mongoose';
import { createAdminUserConversationsHandlers } from './conversations';

// helpers `makeReq`, `makeRes` mirror packages/api/src/admin/users.spec.ts

describe('createAdminUserConversationsHandlers', () => {
  let deps: Parameters<typeof createAdminUserConversationsHandlers>[0];
  let owner: string; // ObjectId string of the conversation owner
  let convoId: string;

  beforeEach(async () => {
    // seed via data-schemas methods: createUser x2, saveConvo, saveMessage x2
    deps = {
      findUsers: methods.findUsers,
      getConvosByCursor: methods.getConvosByCursor,
      getConvo: methods.getConvo,
      getMessages: methods.getMessages,
    };
  });

  it('lists the target user’s conversations', async () => {
    const h = createAdminUserConversationsHandlers(deps);
    const res = makeRes();
    await h.listUserConversations(makeReq({ params: { userId: owner }, query: {} }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.conversations).toHaveLength(1);
    expect(res.body.conversations[0].conversationId).toBe(convoId);
  });

  it('returns 400 for a malformed userId', async () => {
    const h = createAdminUserConversationsHandlers(deps);
    const res = makeRes();
    await h.listUserConversations(makeReq({ params: { userId: 'not-an-id' }, query: {} }), res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for an unknown userId', async () => {
    const h = createAdminUserConversationsHandlers(deps);
    const res = makeRes();
    await h.listUserConversations(
      makeReq({ params: { userId: new Types.ObjectId().toString() }, query: {} }),
      res,
    );
    expect(res.statusCode).toBe(404);
  });

  it('returns a single conversation owned by the target user', async () => {
    const h = createAdminUserConversationsHandlers(deps);
    const res = makeRes();
    await h.getUserConversation(makeReq({ params: { userId: owner, conversationId: convoId } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.conversationId).toBe(convoId);
  });

  it('returns 404 when the conversation is not owned by the target user', async () => {
    const h = createAdminUserConversationsHandlers(deps);
    const res = makeRes();
    await h.getUserConversation(
      makeReq({ params: { userId: otherUser, conversationId: convoId } }),
      res,
    );
    expect(res.statusCode).toBe(404);
  });

  it('returns the conversation messages, ordered, with CLIENT_MESSAGE_SELECT applied', async () => {
    const h = createAdminUserConversationsHandlers(deps);
    const res = makeRes();
    await h.getUserConversationMessages(
      makeReq({ params: { userId: owner, conversationId: convoId } }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).not.toHaveProperty('user');
    expect(new Date(res.body[0].createdAt).getTime())
      .toBeLessThanOrEqual(new Date(res.body[1].createdAt).getTime());
  });

  it('returns 404 messages when the conversation is not owned by the target user', async () => {
    const h = createAdminUserConversationsHandlers(deps);
    const res = makeRes();
    await h.getUserConversationMessages(
      makeReq({ params: { userId: otherUser, conversationId: convoId } }),
      res,
    );
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && npx jest src/admin/conversations.spec.ts`
Expected: FAIL — `Cannot find module './conversations'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/api/src/admin/conversations.ts`:

```ts
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
  if (Number.isNaN(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
};

const stringParam = (raw: unknown): string | undefined =>
  typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined;

export function createAdminUserConversationsHandlers(
  deps: AdminUserConversationsDeps,
): HandlerSet {
  const { findUsers, getConvosByCursor, getConvo, getMessages } = deps;

  const resolveUser = async (userId: string): Promise<'invalid' | 'missing' | 'ok'> => {
    if (!isValidObjectIdString(userId)) return 'invalid';
    const [user] = await findUsers({ _id: userId }, '_id', { limit: 1 });
    return user ? 'ok' : 'missing';
  };

  async function listUserConversations(req: ServerRequest, res: Response) {
    try {
      const { userId } = req.params as { userId: string };
      const state = await resolveUser(userId);
      if (state === 'invalid') return res.status(400).json({ error: 'Invalid user ID format' });
      if (state === 'missing') return res.status(404).json({ error: 'User not found' });

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
      if (state === 'invalid') return res.status(400).json({ error: 'Invalid user ID format' });
      if (state === 'missing') return res.status(404).json({ error: 'User not found' });

      const convo = await getConvo(userId, conversationId);
      if (!convo) return res.status(404).json({ error: 'Conversation not found' });
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
      if (state === 'invalid') return res.status(400).json({ error: 'Invalid user ID format' });
      if (state === 'missing') return res.status(404).json({ error: 'User not found' });

      const convo = await getConvo(userId, conversationId);
      if (!convo) return res.status(404).json({ error: 'Conversation not found' });

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && npx jest src/admin/conversations.spec.ts`
Expected: PASS (all 8 cases).

- [ ] **Step 5: Typecheck**

Run: `cd packages/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/admin/conversations.ts packages/api/src/admin/conversations.spec.ts
git commit -m "feat(admin): add user-conversation read handlers"
```

---

## Task 2: Backend — export + route wiring + regression guard

**Files:**
- Modify: `packages/api/src/admin/index.ts`
- Modify: `api/server/routes/admin/users.js`
- Test: `api/server/routes/__tests__/admin.users.conversations.test.js` (create)
- Test: `api/server/routes/__tests__/convos.owner-scope.test.js` (create)

**Interfaces:**
- Consumes: `createAdminUserConversationsHandlers` (Task 1)
- Produces: HTTP routes
  - `GET /api/admin/users/:userId/conversations`
  - `GET /api/admin/users/:userId/conversations/:conversationId`
  - `GET /api/admin/users/:userId/conversations/:conversationId/messages`
  all behind `requireJwtAuth` + `requireCapability(ACCESS_ADMIN)` + `requireCapability(READ_USERS)`

- [ ] **Step 1: Write the failing route test**

Create `api/server/routes/__tests__/admin.users.conversations.test.js`. Follow the existing pattern in `api/server/routes/skills.tenant.test.js` (builds an express app, mounts the router, uses supertest, mongodb-memory-server). Seed an ADMIN user, a normal USER, and a conversation + messages owned by the USER. Mint JWTs with the app's `JWT_SECRET`.

```js
describe('GET /api/admin/users/:userId/conversations', () => {
  it('lets an admin list another user’s conversations', async () => {
    const res = await request(app)
      .get(`/api/admin/users/${targetUserId}/conversations`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.conversations[0].conversationId).toBe(convoId);
  });

  it('rejects a non-admin with 403', async () => {
    const res = await request(app)
      .get(`/api/admin/users/${targetUserId}/conversations`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await request(app).get(`/api/admin/users/${targetUserId}/conversations`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown user', async () => {
    const res = await request(app)
      .get(`/api/admin/users/${new mongoose.Types.ObjectId().toString()}/conversations`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('serves messages for an owned conversation and 404 for a mismatched owner', async () => {
    const ok = await request(app)
      .get(`/api/admin/users/${targetUserId}/conversations/${convoId}/messages`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.body)).toBe(true);

    const bad = await request(app)
      .get(`/api/admin/users/${adminUserId}/conversations/${convoId}/messages`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(bad.status).toBe(404);
  });

  it('does not shadow /api/admin/users/search', async () => {
    const res = await request(app)
      .get('/api/admin/users/search?q=adm')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('users');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest server/routes/__tests__/admin.users.conversations.test.js`
Expected: FAIL — routes return 404 (not mounted).

- [ ] **Step 3: Export the factory**

In `packages/api/src/admin/index.ts` add:

```ts
export * from './conversations';
```

Verify `packages/api/src/index.ts` already does `export * from './admin'` (or an equivalent spread of `./admin/index`). If it names individual admin exports instead, add `createAdminUserConversationsHandlers` to that list.

- [ ] **Step 4: Wire the routes**

In `api/server/routes/admin/users.js`, after the existing `handlers` const and **after** `router.get('/search', ...)`, add:

```js
const { createAdminUserConversationsHandlers } = require('@librechat/api');

const conversationHandlers = createAdminUserConversationsHandlers({
  findUsers: db.findUsers,
  getConvosByCursor: db.getConvosByCursor,
  getConvo: db.getConvo,
  getMessages: db.getMessages,
});

router.get(
  '/:userId/conversations',
  requireReadUsers,
  conversationHandlers.listUserConversations,
);
router.get(
  '/:userId/conversations/:conversationId',
  requireReadUsers,
  conversationHandlers.getUserConversation,
);
router.get(
  '/:userId/conversations/:conversationId/messages',
  requireReadUsers,
  conversationHandlers.getUserConversationMessages,
);
```

`requireReadUsers` is already defined in this file (`requireCapability(SystemCapabilities.READ_USERS)`); the file-level `router.use(requireJwtAuth, requireAdminAccess)` already applies. Confirm `db.getConvosByCursor`, `db.getConvo`, `db.getMessages`, `db.findUsers` are all exported from `~/models` (they are, via `packages/data-schemas`).

- [ ] **Step 5: Rebuild `@librechat/api` and run the route test**

Run: `npm run build:api`
Run: `cd api && npx jest server/routes/__tests__/admin.users.conversations.test.js`
Expected: PASS.

- [ ] **Step 6: Write the regression test**

Create `api/server/routes/__tests__/convos.owner-scope.test.js`. Mount the real `convos` router; seed user A with a conversation, and user B. Assert:

```js
it('returns 404 when user B requests user A’s conversation', async () => {
  const res = await request(app)
    .get(`/api/convos/${userAConvoId}`)
    .set('Authorization', `Bearer ${userBToken}`);
  expect(res.status).toBe(404);
});

it('returns 200 for the owner', async () => {
  const res = await request(app)
    .get(`/api/convos/${userAConvoId}`)
    .set('Authorization', `Bearer ${userAToken}`);
  expect(res.status).toBe(200);
});
```

- [ ] **Step 7: Run the regression test**

Run: `cd api && npx jest server/routes/__tests__/convos.owner-scope.test.js`
Expected: PASS (documents current, unchanged behavior).

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/admin/index.ts api/server/routes/admin/users.js api/server/routes/__tests__/admin.users.conversations.test.js api/server/routes/__tests__/convos.owner-scope.test.js
git commit -m "feat(admin): mount user-conversation viewer routes"
```

---

## Task 3: Shared — data-provider endpoints, types, service functions

**Files:**
- Modify: `packages/data-provider/src/api-endpoints.ts`
- Create: `packages/data-provider/src/types/admin.ts`
- Modify: `packages/data-provider/src/types.ts`
- Modify: `packages/data-provider/src/keys.ts`
- Modify: `packages/data-provider/src/data-service.ts`
- Test: `packages/data-provider/src/api-endpoints.admin.spec.ts` (create)

**Interfaces:**
- Consumes: `request` default export (`.get/.post/.patch/.delete`), existing `adminRoles()` builder, `buildQuery`
- Produces (service functions on `dataService`):
  - `listAdminRoles(): Promise<TAdminRoleListResponse>`
  - `createAdminRole(body: { name: string; description?: string }): Promise<{ role: TAdminRole }>`
  - `updateAdminRole(name: string, body: { name?: string; description?: string }): Promise<{ role: TAdminRole }>`
  - `deleteAdminRole(name: string): Promise<{ success: true }>`
  - `listAdminRoleMembers(name: string, params?: { limit?: number; offset?: number }): Promise<TAdminMemberListResponse>`
  - `addAdminRoleMember(name: string, userId: string): Promise<{ success: true }>`
  - `removeAdminRoleMember(name: string, userId: string): Promise<{ success: true }>`
  - `listAdminUsers(params?: { limit?: number; offset?: number }): Promise<TAdminUserListResponse>`
  - `searchAdminUsers(q: string, limit?: number): Promise<TAdminUserSearchResponse>`
  - `listAdminUserConversations(userId: string, params?: { cursor?: string; limit?: number; search?: string }): Promise<{ conversations: TConversation[]; nextCursor: string | null }>`
  - `getAdminUserConversation(userId: string, conversationId: string): Promise<TConversation>`
  - `getAdminUserConversationMessages(userId: string, conversationId: string): Promise<TMessage[]>`

- [ ] **Step 1: Write the failing test**

Create `packages/data-provider/src/api-endpoints.admin.spec.ts`:

```ts
import * as endpoints from './api-endpoints';

describe('admin endpoint builders', () => {
  it('builds role member paths with encoding', () => {
    expect(endpoints.adminRole('ADMIN')).toBe('/api/admin/roles/ADMIN');
    expect(endpoints.adminRoleMembers('A B')).toBe('/api/admin/roles/A%20B/members');
    expect(endpoints.adminRoleMember('ADMIN', '64f/1')).toBe(
      '/api/admin/roles/ADMIN/members/64f%2F1',
    );
  });

  it('builds user conversation paths', () => {
    expect(endpoints.adminUserConversations('u1')).toBe('/api/admin/users/u1/conversations');
    expect(endpoints.adminUserConversations('u1', { cursor: 'c', limit: 25 })).toBe(
      '/api/admin/users/u1/conversations?cursor=c&limit=25',
    );
    expect(endpoints.adminUserConversationMessages('u1', 'c9')).toBe(
      '/api/admin/users/u1/conversations/c9/messages',
    );
  });

  it('builds user search path', () => {
    expect(endpoints.adminUserSearch('ab', 10)).toBe('/api/admin/users/search?q=ab&limit=10');
  });
});
```

(`BASE_URL` is `''` in the jest/node context, so paths have no host prefix.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/data-provider && npx jest src/api-endpoints.admin.spec.ts`
Expected: FAIL — `adminRole is not a function`.

- [ ] **Step 3: Add endpoint builders**

In `packages/data-provider/src/api-endpoints.ts`, in the `/* Roles */` block (after `export const adminRoles = ...`):

```ts
export const adminRole = (name: string) => `${adminRoles()}/${encodeURIComponent(name)}`;
export const adminRoleMembers = (name: string, params?: { limit?: number; offset?: number }) =>
  `${adminRole(name)}/members${buildQuery(params ?? {})}`;
export const adminRoleMember = (name: string, userId: string) =>
  `${adminRole(name)}/members/${encodeURIComponent(userId)}`;
```

Add a new `/* Admin users */` block:

```ts
export const adminUsers = (params?: { limit?: number; offset?: number }) =>
  `${BASE_URL}/api/admin/users${buildQuery(params ?? {})}`;
export const adminUserSearch = (q: string, limit?: number) =>
  `${BASE_URL}/api/admin/users/search${buildQuery({ q, limit })}`;
export const adminUserConversations = (
  userId: string,
  params?: { cursor?: string; limit?: number; search?: string },
) =>
  `${BASE_URL}/api/admin/users/${encodeURIComponent(userId)}/conversations${buildQuery(
    params ?? {},
  )}`;
export const adminUserConversation = (userId: string, conversationId: string) =>
  `${BASE_URL}/api/admin/users/${encodeURIComponent(userId)}/conversations/${encodeURIComponent(
    conversationId,
  )}`;
export const adminUserConversationMessages = (userId: string, conversationId: string) =>
  `${adminUserConversation(userId, conversationId)}/messages`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/data-provider && npx jest src/api-endpoints.admin.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add types**

Create `packages/data-provider/src/types/admin.ts`:

```ts
import type { TConversation, TMessage } from './';

export interface TAdminRole {
  name: string;
  description?: string;
  permissions?: Record<string, Record<string, boolean>>;
}
export interface TAdminRoleListResponse {
  roles: Array<TAdminRole & { _id?: string }>;
  total: number;
  limit: number;
  offset: number;
}
export interface TAdminMember {
  userId: string;
  name: string;
  email: string;
  avatarUrl?: string;
}
export interface TAdminMemberListResponse {
  members: TAdminMember[];
  total: number;
  limit: number;
  offset: number;
}
export interface TAdminUserListItem {
  id: string;
  name: string;
  username: string;
  email: string;
  avatar: string;
  role: string;
  provider: string;
  createdAt?: string;
  updatedAt?: string;
}
export interface TAdminUserListResponse {
  users: TAdminUserListItem[];
  total: number;
  limit: number;
  offset: number;
}
export interface TAdminUserSearchResult {
  id: string;
  name: string;
  email: string;
  username?: string;
  avatarUrl?: string;
}
export interface TAdminUserSearchResponse {
  users: TAdminUserSearchResult[];
  total: number;
  capped: boolean;
}
export interface TAdminUserConversationsResponse {
  conversations: TConversation[];
  nextCursor: string | null;
}
export type TAdminUserMessagesResponse = TMessage[];
```

In `packages/data-provider/src/types.ts` add near the other `export * from './types/...'` lines:

```ts
export * from './types/admin';
```

- [ ] **Step 6: Add QueryKeys**

In `packages/data-provider/src/keys.ts`, inside the `QueryKeys` enum/object, add:

```ts
  adminRoles = 'adminRoles',
  adminRoleMembers = 'adminRoleMembers',
  adminUsers = 'adminUsers',
  adminUserSearch = 'adminUserSearch',
  adminUserConversations = 'adminUserConversations',
  adminUserConversation = 'adminUserConversation',
  adminUserMessages = 'adminUserMessages',
```

(Match the file's existing style — string enum vs const object.)

- [ ] **Step 7: Add service functions**

In `packages/data-provider/src/data-service.ts`, import the admin types near the top:

```ts
import type * as adm from './types/admin';
```

In the `/* Roles */` region add:

```ts
export function listAdminRoles(): Promise<adm.TAdminRoleListResponse> {
  return request.get(`${endpoints.adminRoles()}?limit=200`);
}
export function createAdminRole(body: {
  name: string;
  description?: string;
}): Promise<{ role: adm.TAdminRole }> {
  return request.post(endpoints.adminRoles(), body);
}
export function updateAdminRole(
  name: string,
  body: { name?: string; description?: string },
): Promise<{ role: adm.TAdminRole }> {
  return request.patch(endpoints.adminRole(name), body);
}
export function deleteAdminRole(name: string): Promise<{ success: true }> {
  return request.delete(endpoints.adminRole(name));
}
export function listAdminRoleMembers(
  name: string,
  params?: { limit?: number; offset?: number },
): Promise<adm.TAdminMemberListResponse> {
  return request.get(endpoints.adminRoleMembers(name, params));
}
export function addAdminRoleMember(name: string, userId: string): Promise<{ success: true }> {
  return request.post(endpoints.adminRoleMembers(name), { userId });
}
export function removeAdminRoleMember(name: string, userId: string): Promise<{ success: true }> {
  return request.delete(endpoints.adminRoleMember(name, userId));
}
```

Add a new `/* Admin users */` region:

```ts
export function listAdminUsers(params?: {
  limit?: number;
  offset?: number;
}): Promise<adm.TAdminUserListResponse> {
  return request.get(endpoints.adminUsers(params));
}
export function searchAdminUsers(
  q: string,
  limit?: number,
): Promise<adm.TAdminUserSearchResponse> {
  return request.get(endpoints.adminUserSearch(q, limit));
}
export function listAdminUserConversations(
  userId: string,
  params?: { cursor?: string; limit?: number; search?: string },
): Promise<adm.TAdminUserConversationsResponse> {
  return request.get(endpoints.adminUserConversations(userId, params));
}
export function getAdminUserConversation(
  userId: string,
  conversationId: string,
): Promise<adm.TConversation> {
  return request.get(endpoints.adminUserConversation(userId, conversationId));
}
export function getAdminUserConversationMessages(
  userId: string,
  conversationId: string,
): Promise<adm.TAdminUserMessagesResponse> {
  return request.get(endpoints.adminUserConversationMessages(userId, conversationId));
}
```

(If `data-service.ts` exports a `dataService` aggregate object at the bottom, add each new function name to it — check the file's tail and match its export style.)

- [ ] **Step 8: Build and typecheck**

Run: `npm run build:data-provider`
Run: `cd packages/data-provider && npx tsc --noEmit && npx jest src/api-endpoints.admin.spec.ts`
Expected: build OK, no type errors, test PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/data-provider/src/api-endpoints.ts packages/data-provider/src/types/admin.ts packages/data-provider/src/types.ts packages/data-provider/src/keys.ts packages/data-provider/src/data-service.ts packages/data-provider/src/api-endpoints.admin.spec.ts
git commit -m "feat(data-provider): admin roles + user-conversation endpoints"
```

---

## Task 4: Client — Admin data hooks

**Files:**
- Create: `client/src/data-provider/Admin/queries.ts`
- Create: `client/src/data-provider/Admin/mutations.ts`
- Create: `client/src/data-provider/Admin/index.ts`
- Modify: `client/src/data-provider/index.ts`
- Test: `client/src/data-provider/Admin/__tests__/queries.test.ts`

**Interfaces:**
- Consumes: `dataService.*` (Task 3), `QueryKeys` (Task 3)
- Produces:
  - `useAdminRoles(config?)` → `TAdminRoleListResponse`
  - `useAdminRoleMembers(roleName: string, page: number, config?)` → `TAdminMemberListResponse`
  - `useAdminUsers(page: number, config?)` → `TAdminUserListResponse`
  - `useAdminUserSearch(query: string)` → `TAdminUserSearchResponse` (enabled when `query.trim().length >= 2`)
  - `useAdminUserConversations(userId: string, params: { search?: string })` → `useInfiniteQuery`, pages of `TAdminUserConversationsResponse`
  - `useAdminUserConversation(userId, conversationId)` → `TConversation`
  - `useAdminUserMessages(userId, conversationId)` → `TMessage[]`
  - `useCreateRole()`, `useUpdateRole()`, `useDeleteRole()`, `useAddRoleMember()`, `useRemoveRoleMember()` mutations

- [ ] **Step 1: Write the failing test**

Create `client/src/data-provider/Admin/__tests__/queries.test.ts`. Mock `librechat-data-provider` `dataService`, wrap in a `QueryClientProvider`, mirror `client/src/data-provider/__tests__` style.

```ts
import { renderHook, waitFor } from '@testing-library/react';
import { dataService } from 'librechat-data-provider';
import { useAdminRoles, useAdminUserSearch } from '../queries';
// wrapper with a fresh QueryClient

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  dataService: {
    listAdminRoles: jest.fn(),
    searchAdminUsers: jest.fn(),
  },
}));

it('useAdminRoles fetches the role list', async () => {
  (dataService.listAdminRoles as jest.Mock).mockResolvedValue({ roles: [{ name: 'ADMIN' }], total: 1 });
  const { result } = renderHook(() => useAdminRoles(), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.roles[0].name).toBe('ADMIN');
});

it('useAdminUserSearch stays disabled below 2 chars', async () => {
  const { result } = renderHook(() => useAdminUserSearch('a'), { wrapper });
  await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
  expect(dataService.searchAdminUsers).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest src/data-provider/Admin/__tests__/queries.test.ts`
Expected: FAIL — cannot resolve `../queries`.

- [ ] **Step 3: Write the hooks**

Create `client/src/data-provider/Admin/queries.ts`:

```ts
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type {
  TAdminRoleListResponse,
  TAdminMemberListResponse,
  TAdminUserListResponse,
  TAdminUserSearchResponse,
  TAdminUserConversationsResponse,
  TConversation,
  TMessage,
} from 'librechat-data-provider';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';

const MEMBERS_PAGE_SIZE = 20;
const USERS_PAGE_SIZE = 25;

export const useAdminRoles = (
  config?: UseQueryOptions<TAdminRoleListResponse>,
): QueryObserverResult<TAdminRoleListResponse> =>
  useQuery<TAdminRoleListResponse>(
    [QueryKeys.adminRoles],
    () => dataService.listAdminRoles(),
    { refetchOnWindowFocus: false, staleTime: 30_000, ...config },
  );

export const useAdminRoleMembers = (
  roleName: string,
  page: number,
  config?: UseQueryOptions<TAdminMemberListResponse>,
): QueryObserverResult<TAdminMemberListResponse> =>
  useQuery<TAdminMemberListResponse>(
    [QueryKeys.adminRoleMembers, roleName, page],
    () =>
      dataService.listAdminRoleMembers(roleName, {
        limit: MEMBERS_PAGE_SIZE,
        offset: (page - 1) * MEMBERS_PAGE_SIZE,
      }),
    { enabled: !!roleName, refetchOnWindowFocus: false, staleTime: 30_000, ...config },
  );

export const useAdminUsers = (
  page: number,
  config?: UseQueryOptions<TAdminUserListResponse>,
): QueryObserverResult<TAdminUserListResponse> =>
  useQuery<TAdminUserListResponse>(
    [QueryKeys.adminUsers, page],
    () =>
      dataService.listAdminUsers({
        limit: USERS_PAGE_SIZE,
        offset: (page - 1) * USERS_PAGE_SIZE,
      }),
    { keepPreviousData: true, refetchOnWindowFocus: false, staleTime: 30_000, ...config },
  );

export const useAdminUserSearch = (
  query: string,
  config?: UseQueryOptions<TAdminUserSearchResponse>,
): QueryObserverResult<TAdminUserSearchResponse> => {
  const trimmed = query.trim();
  return useQuery<TAdminUserSearchResponse>(
    [QueryKeys.adminUserSearch, trimmed],
    () => dataService.searchAdminUsers(trimmed, 20),
    { enabled: trimmed.length >= 2, refetchOnWindowFocus: false, ...config },
  );
};

export const useAdminUserConversations = (userId: string, params: { search?: string }) =>
  useInfiniteQuery<TAdminUserConversationsResponse>(
    [QueryKeys.adminUserConversations, userId, params.search ?? ''],
    ({ pageParam }) =>
      dataService.listAdminUserConversations(userId, {
        cursor: pageParam as string | undefined,
        limit: 25,
        search: params.search || undefined,
      }),
    {
      enabled: !!userId,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      refetchOnWindowFocus: false,
    },
  );

export const useAdminUserConversation = (
  userId: string,
  conversationId: string,
  config?: UseQueryOptions<TConversation>,
): QueryObserverResult<TConversation> =>
  useQuery<TConversation>(
    [QueryKeys.adminUserConversation, userId, conversationId],
    () => dataService.getAdminUserConversation(userId, conversationId),
    { enabled: !!userId && !!conversationId, refetchOnWindowFocus: false, ...config },
  );

export const useAdminUserMessages = (
  userId: string,
  conversationId: string,
  config?: UseQueryOptions<TMessage[]>,
): QueryObserverResult<TMessage[]> =>
  useQuery<TMessage[]>(
    [QueryKeys.adminUserMessages, userId, conversationId],
    () => dataService.getAdminUserConversationMessages(userId, conversationId),
    { enabled: !!userId && !!conversationId, refetchOnWindowFocus: false, ...config },
  );
```

Create `client/src/data-provider/Admin/mutations.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';
import type { TAdminRole } from 'librechat-data-provider';

export const useCreateRole = (): UseMutationResult<
  { role: TAdminRole },
  Error,
  { name: string; description?: string }
> => {
  const qc = useQueryClient();
  return useMutation((body) => dataService.createAdminRole(body), {
    onSuccess: () => qc.invalidateQueries([QueryKeys.adminRoles]),
  });
};

export const useUpdateRole = (): UseMutationResult<
  { role: TAdminRole },
  Error,
  { name: string; updates: { name?: string; description?: string } }
> => {
  const qc = useQueryClient();
  return useMutation(({ name, updates }) => dataService.updateAdminRole(name, updates), {
    onSuccess: () => qc.invalidateQueries([QueryKeys.adminRoles]),
  });
};

export const useDeleteRole = (): UseMutationResult<{ success: true }, Error, { name: string }> => {
  const qc = useQueryClient();
  return useMutation(({ name }) => dataService.deleteAdminRole(name), {
    onSuccess: () => qc.invalidateQueries([QueryKeys.adminRoles]),
  });
};

export const useAddRoleMember = (): UseMutationResult<
  { success: true },
  Error,
  { roleName: string; userId: string }
> => {
  const qc = useQueryClient();
  return useMutation(({ roleName, userId }) => dataService.addAdminRoleMember(roleName, userId), {
    onSuccess: (_d, { roleName }) => {
      qc.invalidateQueries([QueryKeys.adminRoleMembers, roleName]);
      qc.invalidateQueries([QueryKeys.adminUsers]);
    },
  });
};

export const useRemoveRoleMember = (): UseMutationResult<
  { success: true },
  Error,
  { roleName: string; userId: string }
> => {
  const qc = useQueryClient();
  return useMutation(
    ({ roleName, userId }) => dataService.removeAdminRoleMember(roleName, userId),
    {
      onSuccess: (_d, { roleName }) => {
        qc.invalidateQueries([QueryKeys.adminRoleMembers, roleName]);
        qc.invalidateQueries([QueryKeys.adminUsers]);
      },
    },
  );
};
```

Create `client/src/data-provider/Admin/index.ts`:

```ts
export * from './queries';
export * from './mutations';
```

In `client/src/data-provider/index.ts` add alongside the other re-exports:

```ts
export * from './Admin';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx jest src/data-provider/Admin/__tests__/queries.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/data-provider/Admin client/src/data-provider/index.ts
git commit -m "feat(client): admin data-provider hooks"
```

---

## Task 5: Client — admin shell (routes, guard, layout, sidebar link)

**Files:**
- Create: `client/src/components/Admin/guard.ts`
- Create: `client/src/components/Admin/AdminLayout.tsx`
- Create: `client/src/components/Admin/index.ts`
- Modify: `client/src/routes/index.tsx`
- Modify: `client/src/hooks/Nav/useUnifiedSidebarLinks.ts`
- Modify: `client/src/components/UnifiedSidebar/ExpandedPanel.tsx`
- Modify: `client/src/locales/en/translation.json`
- Test: `client/src/components/Admin/__tests__/guard.test.tsx`
- Test: `client/src/hooks/Nav/__tests__/useUnifiedSidebarLinks.admin.test.tsx`

**Interfaces:**
- Consumes: `useAuthContext` (`~/hooks`), `SystemRoles` (`librechat-data-provider`)
- Produces:
  - `useAdminGuard(): React.ReactElement | null` — returns `<Navigate to="/c/new" replace />` for non-admins, else `null`
  - `AdminLayout` default export — renders sub-nav + `<Outlet />`, applies the guard
  - route paths `admin`, `admin/access`, `admin/users`, `admin/users/:userId`, `admin/users/:userId/c/:conversationId`

- [ ] **Step 1: Write the failing guard + sidebar tests**

`client/src/components/Admin/__tests__/guard.test.tsx`:

```tsx
import { renderHook } from '@testing-library/react';
import { SystemRoles } from 'librechat-data-provider';
import { useAdminGuard } from '../guard';

jest.mock('~/hooks', () => ({ useAuthContext: jest.fn() }));
import { useAuthContext } from '~/hooks';

it('redirects a non-admin', () => {
  (useAuthContext as jest.Mock).mockReturnValue({ user: { role: SystemRoles.USER } });
  const { result } = renderHook(() => useAdminGuard());
  expect(result.current).not.toBeNull();
});

it('passes an admin through', () => {
  (useAuthContext as jest.Mock).mockReturnValue({ user: { role: SystemRoles.ADMIN } });
  const { result } = renderHook(() => useAdminGuard());
  expect(result.current).toBeNull();
});
```

`client/src/hooks/Nav/__tests__/useUnifiedSidebarLinks.admin.test.tsx`:

```tsx
// mock useAuthContext + the queries used by the hook; assert a link with id 'admin'
// is present for role ADMIN and absent for role USER
it('adds the Admin link for admins', () => {
  // ...render hook with ADMIN
  expect(links.some((l) => l.id === 'admin')).toBe(true);
});
it('omits the Admin link for regular users', () => {
  // ...render hook with USER
  expect(links.some((l) => l.id === 'admin')).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx jest src/components/Admin/__tests__/guard.test.tsx src/hooks/Nav/__tests__/useUnifiedSidebarLinks.admin.test.tsx`
Expected: FAIL — missing `../guard`, no `admin` link.

- [ ] **Step 3: Write the guard**

`client/src/components/Admin/guard.ts`:

```ts
import { Navigate } from 'react-router-dom';
import { SystemRoles } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks';

export function useAdminGuard(): React.ReactElement | null {
  const { user } = useAuthContext();
  if (user?.role !== SystemRoles.ADMIN) {
    return <Navigate to="/c/new" replace />;
  }
  return null;
}
```

(File is `.tsx`-compatible JSX — name it `guard.tsx`.)

- [ ] **Step 4: Write AdminLayout**

`client/src/components/Admin/AdminLayout.tsx`:

```tsx
import { NavLink, Outlet } from 'react-router-dom';
import { useLocalize } from '~/hooks';
import { useAdminGuard } from './guard';
import { cn } from '~/utils';

export default function AdminLayout() {
  const localize = useLocalize();
  const redirect = useAdminGuard();
  if (redirect) return redirect;

  const tab = (to: string, label: string) => (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'border-b-2 px-3 py-2 text-sm',
          isActive
            ? 'border-text-primary text-text-primary'
            : 'border-transparent text-text-secondary hover:text-text-primary',
        )
      }
    >
      {label}
    </NavLink>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-surface-primary">
      <header className="flex flex-col gap-3 border-b border-border-light px-6 pt-5">
        <h1 className="text-lg font-semibold text-text-primary">
          {localize('com_admin_nav_title')}
        </h1>
        <nav className="flex gap-1">
          {tab('/admin/access', localize('com_admin_access_title'))}
          {tab('/admin/users', localize('com_admin_users_title'))}
        </nav>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <Outlet />
      </main>
    </div>
  );
}
```

`client/src/components/Admin/index.ts`:

```ts
export { default as AdminLayout } from './AdminLayout';
export { default as AccessView } from './Access/AccessView';
export { default as UsersView } from './Users/UsersView';
export { default as UserConversationsView } from './Users/UserConversationsView';
export { default as ConversationTranscript } from './Users/ConversationTranscript';
```

(Create thin placeholder default exports for `AccessView`/`UsersView`/`UserConversationsView`/`ConversationTranscript` now — a `<div/>` returning `null` — so the barrel and routes compile. Tasks 6–11 replace them.)

- [ ] **Step 5: Register routes**

In `client/src/routes/index.tsx`:

```ts
const loadAdmin = () =>
  import('~/components/Admin').then((m) => ({ Component: m.AdminLayout }));
const loadAdminAccess = () =>
  import('~/components/Admin').then((m) => ({ Component: m.AccessView }));
const loadAdminUsers = () =>
  import('~/components/Admin').then((m) => ({ Component: m.UsersView }));
const loadAdminUserConversations = () =>
  import('~/components/Admin').then((m) => ({ Component: m.UserConversationsView }));
const loadAdminTranscript = () =>
  import('~/components/Admin').then((m) => ({ Component: m.ConversationTranscript }));
```

Inside the `Root` `children` array (same level as `c/:conversationId?` and `insights`):

```tsx
{
  path: 'admin',
  lazy: loadAdmin,
  children: [
    { index: true, element: <Navigate to="/admin/access" replace={true} /> },
    { path: 'access', lazy: loadAdminAccess },
    { path: 'users', lazy: loadAdminUsers },
    { path: 'users/:userId', lazy: loadAdminUserConversations },
    { path: 'users/:userId/c/:conversationId', lazy: loadAdminTranscript },
  ],
},
```

- [ ] **Step 6: Add the sidebar link**

In `client/src/hooks/Nav/useUnifiedSidebarLinks.ts`:
- import `ShieldCheck` from `lucide-react`
- inside the `links` `useMemo`, after the insights block builds `nextLinks` (or in the non-insights early branch), compute:

```ts
const isAdmin = user?.role === SystemRoles.ADMIN;
```

Then before the final `return`, if `isAdmin`, push an admin link. Concretely, restructure so both branches end by conditionally appending:

```ts
const adminLink: NavLink = {
  title: 'com_admin_nav_title',
  label: '',
  icon: ShieldCheck,
  id: 'admin',
  onClick: () => {
    if (!location.pathname.startsWith('/admin')) {
      navigate('/admin/access');
    }
  },
};
const withAdmin = isAdmin ? [...base, adminLink] : base;
return [conversationLink, ...withAdmin];
```

where `base` is the `sideNavLinks`/`nextLinks` array already computed. Keep the existing insights logic intact.

- [ ] **Step 7: Generalize the full-page-route check**

In `client/src/components/UnifiedSidebar/ExpandedPanel.tsx` (and `UnifiedSidebar.tsx` where `isInsightsRoute` is defined), add a sibling:

```ts
const isFullPageRoute =
  location.pathname.startsWith('/insights') || location.pathname.startsWith('/admin');
```

Replace the local uses of `isInsightsRoute` that control panel collapse / `panelExpanded` with `isFullPageRoute`. Leave the insights-specific `onLeaveInsights` behavior keyed to `/insights` only (admin has no equivalent "leave" affordance — navigating away via the sidebar is enough). Keep changes minimal and mechanical.

- [ ] **Step 8: Add base locale keys**

In `client/src/locales/en/translation.json` add (alphabetical position within the `com_` block):

```json
"com_admin_nav_title": "Admin",
"com_admin_access_title": "Access",
"com_admin_users_title": "Users",
```

- [ ] **Step 9: Run tests + typecheck**

Run: `cd client && npx jest src/components/Admin/__tests__/guard.test.tsx src/hooks/Nav/__tests__/useUnifiedSidebarLinks.admin.test.tsx`
Expected: PASS.
Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add client/src/components/Admin client/src/routes/index.tsx client/src/hooks/Nav/useUnifiedSidebarLinks.ts client/src/components/UnifiedSidebar/ExpandedPanel.tsx client/src/components/UnifiedSidebar/UnifiedSidebar.tsx client/src/locales/en/translation.json client/src/hooks/Nav/__tests__/useUnifiedSidebarLinks.admin.test.tsx
git commit -m "feat(client): admin area shell, route guard, sidebar entry"
```

---

## Task 6: Client — Access screen: roles list (read)

**Files:**
- Create: `client/src/components/Admin/Access/AccessView.tsx` (replace placeholder)
- Create: `client/src/components/Admin/Access/RoleRow.tsx`
- Modify: `client/src/locales/en/translation.json`
- Test: `client/src/components/Admin/Access/__tests__/AccessView.test.tsx`

**Interfaces:**
- Consumes: `useAdminRoles` (Task 4), `SystemRoles`
- Produces: `AccessView` default export; `RoleRow` (`{ role: TAdminRole & { _id?: string }; onEdit: () => void; onDelete?: () => void }`)

- [ ] **Step 1: Write the failing test**

```tsx
// mock ~/data-provider useAdminRoles
it('renders roles with a System badge for ADMIN/USER', async () => {
  mockUseAdminRoles({ data: { roles: [{ name: 'ADMIN' }, { name: 'USER' }, { name: 'support' }], total: 3 } });
  renderWithProviders(<AccessView />);
  expect(await screen.findByText('ADMIN')).toBeInTheDocument();
  expect(screen.getAllByText('System')).toHaveLength(2);
});
it('shows a spinner while loading', () => {
  mockUseAdminRoles({ isLoading: true });
  renderWithProviders(<AccessView />);
  expect(screen.getByTestId('admin-roles-loading')).toBeInTheDocument();
});
it('shows an error state', () => {
  mockUseAdminRoles({ isError: true });
  renderWithProviders(<AccessView />);
  expect(screen.getByText(/failed to load roles/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest src/components/Admin/Access/__tests__/AccessView.test.tsx`
Expected: FAIL — placeholder renders nothing.

- [ ] **Step 3: Implement RoleRow + AccessView**

`RoleRow.tsx`:

```tsx
import { Trash2 } from 'lucide-react';
import { useLocalize } from '~/hooks';
import type { TAdminRole } from 'librechat-data-provider';

export default function RoleRow({
  role,
  isSystem,
  onEdit,
  onDelete,
}: {
  role: TAdminRole;
  isSystem: boolean;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  const localize = useLocalize();
  return (
    <div className="mb-2 flex items-center gap-3 rounded-lg border border-border-light bg-surface-secondary px-3 py-3">
      <button
        type="button"
        onClick={onEdit}
        className="min-w-0 flex-1 rounded text-left outline-none focus-visible:outline-1"
      >
        <span className="text-sm font-medium text-text-primary hover:underline">{role.name}</span>
        {isSystem && (
          <span className="ml-2 rounded-full bg-surface-tertiary px-2 py-0.5 text-[10px] font-medium text-text-secondary">
            {localize('com_admin_access_system_badge')}
          </span>
        )}
        {role.description ? (
          <div className="truncate text-xs text-text-secondary">{role.description}</div>
        ) : null}
      </button>
      {onDelete && !isSystem && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`${localize('com_ui_delete')} ${role.name}`}
          className="text-text-secondary hover:text-text-primary"
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
```

`AccessView.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Input, Spinner } from '@librechat/client';
import { SystemRoles } from 'librechat-data-provider';
import type { TAdminRole } from 'librechat-data-provider';
import { useAdminRoles } from '~/data-provider';
import { useLocalize } from '~/hooks';
import RoleRow from './RoleRow';

const SYSTEM = new Set<string>([SystemRoles.ADMIN, SystemRoles.USER]);

export default function AccessView() {
  const localize = useLocalize();
  const { data, isLoading, isError } = useAdminRoles();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TAdminRole | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TAdminRole | null>(null);

  const roles = useMemo(() => {
    const list = data?.roles ?? [];
    const q = search.trim().toLowerCase();
    return q ? list.filter((r) => r.name.toLowerCase().includes(q)) : list;
  }, [data?.roles, search]);

  if (isLoading) {
    return (
      <div data-testid="admin-roles-loading" className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }
  if (isError) {
    return <p className="text-sm text-text-secondary">{localize('com_admin_access_load_error')}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={localize('com_admin_access_search_placeholder')}
          className="max-w-xs"
        />
        <Button variant="outline" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden="true" />
          {localize('com_admin_access_create_role')}
        </Button>
      </div>

      {roles.length === 0 ? (
        <p className="text-sm text-text-secondary">{localize('com_admin_access_empty')}</p>
      ) : (
        roles.map((role) => (
          <RoleRow
            key={role.name}
            role={role}
            isSystem={SYSTEM.has(role.name)}
            onEdit={() => setEditTarget(role)}
            onDelete={SYSTEM.has(role.name) ? undefined : () => setDeleteTarget(role)}
          />
        ))
      )}

      {/* CreateRoleDialog / EditRoleDialog / delete confirm wired in Task 7 */}
    </div>
  );
}
```

- [ ] **Step 4: Add locale keys**

```json
"com_admin_access_system_badge": "System",
"com_admin_access_search_placeholder": "Search roles…",
"com_admin_access_create_role": "Create role",
"com_admin_access_empty": "No roles found.",
"com_admin_access_load_error": "Failed to load roles."
```

- [ ] **Step 5: Run test + typecheck**

Run: `cd client && npx jest src/components/Admin/Access/__tests__/AccessView.test.tsx`
Expected: PASS.
Run: `cd client && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Admin/Access client/src/locales/en/translation.json
git commit -m "feat(client): admin access roles list"
```

---

## Task 7: Client — Access screen: create / rename / delete role

**Files:**
- Create: `client/src/components/Admin/Access/CreateRoleDialog.tsx`
- Create: `client/src/components/Admin/Access/EditRoleDialog.tsx`
- Modify: `client/src/components/Admin/Access/AccessView.tsx` (wire dialogs)
- Modify: `client/src/locales/en/translation.json`
- Test: `client/src/components/Admin/Access/__tests__/RoleDialogs.test.tsx`

**Interfaces:**
- Consumes: `useCreateRole`, `useUpdateRole`, `useDeleteRole` (Task 4); the `@librechat/client` dialog primitive used elsewhere in the client (`OGDialog` / `Dialog` — grep `client/src/components` for the prevailing one and match it)
- Produces:
  - `CreateRoleDialog` (`{ open: boolean; onOpenChange: (v: boolean) => void }`)
  - `EditRoleDialog` (`{ role: TAdminRole | null; onClose: () => void }`) — Details tab only in this task; Members tab added in Task 8

- [ ] **Step 1: Write the failing test**

```tsx
it('creates a role', async () => {
  const mutate = jest.fn();
  mockUseCreateRole({ mutate });
  renderWithProviders(<CreateRoleDialog open onOpenChange={() => {}} />);
  await userEvent.type(screen.getByLabelText(/name/i), 'support');
  await userEvent.click(screen.getByRole('button', { name: /create/i }));
  expect(mutate).toHaveBeenCalledWith({ name: 'support', description: undefined }, expect.anything());
});

it('renames a role via EditRoleDialog', async () => {
  const mutate = jest.fn();
  mockUseUpdateRole({ mutate });
  renderWithProviders(<EditRoleDialog role={{ name: 'support' }} onClose={() => {}} />);
  const input = screen.getByLabelText(/name/i);
  await userEvent.clear(input);
  await userEvent.type(input, 'helpdesk');
  await userEvent.click(screen.getByRole('button', { name: /save/i }));
  expect(mutate).toHaveBeenCalledWith(
    { name: 'support', updates: { name: 'helpdesk', description: undefined } },
    expect.anything(),
  );
});

it('disables name editing for a system role', () => {
  renderWithProviders(<EditRoleDialog role={{ name: 'ADMIN' }} onClose={() => {}} />);
  expect(screen.getByLabelText(/name/i)).toBeDisabled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest src/components/Admin/Access/__tests__/RoleDialogs.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement dialogs**

Build `CreateRoleDialog` and `EditRoleDialog` with the client's standard dialog primitive (match an existing dialog under `client/src/components`, e.g. the ones in `SidePanel` or `Prompts`). `EditRoleDialog` shows a `Tabs` component (`@librechat/client`) with a **Details** panel (name `Input` disabled when `SYSTEM.has(role.name)`, description `Input`, Save → `useUpdateRole`) and a **Delete** affordance (hidden for system roles) that opens a confirm dialog → `useDeleteRole`, then `onClose()`. Surface `mutation.error?.message` inline. Use `useLocalize()` for every string.

Wire into `AccessView`: render `<CreateRoleDialog open={createOpen} onOpenChange={setCreateOpen} />`, `<EditRoleDialog role={editTarget} onClose={() => setEditTarget(null)} />`, and a confirm dialog for `deleteTarget`.

- [ ] **Step 4: Add locale keys**

```json
"com_admin_access_role_name": "Name",
"com_admin_access_role_description": "Description",
"com_admin_access_create_title": "Create role",
"com_admin_access_edit_title": "Edit role",
"com_admin_access_delete_title": "Delete role",
"com_admin_access_delete_confirm": "Delete the role “{{0}}”? Members will be moved to USER.",
"com_admin_access_tab_details": "Details"
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd client && npx jest src/components/Admin/Access/__tests__/RoleDialogs.test.tsx`
Expected: PASS.
Run: `cd client && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Admin/Access client/src/locales/en/translation.json
git commit -m "feat(client): admin role create/rename/delete"
```

---

## Task 8: Client — Access screen: role membership management

**Files:**
- Create: `client/src/components/Admin/Access/RoleMembersPanel.tsx`
- Modify: `client/src/components/Admin/Access/EditRoleDialog.tsx` (add Members tab)
- Modify: `client/src/locales/en/translation.json`
- Test: `client/src/components/Admin/Access/__tests__/RoleMembersPanel.test.tsx`

**Interfaces:**
- Consumes: `useAdminRoleMembers`, `useAdminUserSearch`, `useAddRoleMember`, `useRemoveRoleMember` (Task 4)
- Produces: `RoleMembersPanel` (`{ roleName: string }`)

- [ ] **Step 1: Write the failing test**

```tsx
it('lists members and removes one', async () => {
  mockUseAdminRoleMembers({ data: { members: [{ userId: 'u1', name: 'Ann', email: 'a@x.io' }], total: 1 } });
  const mutate = jest.fn();
  mockUseRemoveRoleMember({ mutate });
  renderWithProviders(<RoleMembersPanel roleName="ADMIN" />);
  expect(await screen.findByText('Ann')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /remove Ann/i }));
  expect(mutate).toHaveBeenCalledWith({ roleName: 'ADMIN', userId: 'u1' }, expect.anything());
});

it('searches for a user and adds them', async () => {
  mockUseAdminUserSearch({ data: { users: [{ id: 'u2', name: 'Bob', email: 'b@x.io' }] } });
  const mutate = jest.fn();
  mockUseAddRoleMember({ mutate });
  renderWithProviders(<RoleMembersPanel roleName="ADMIN" />);
  await userEvent.type(screen.getByPlaceholderText(/search users/i), 'bo');
  await userEvent.click(await screen.findByText('Bob'));
  expect(mutate).toHaveBeenCalledWith({ roleName: 'ADMIN', userId: 'u2' }, expect.anything());
});

it('surfaces the server error when removing the last admin', async () => {
  mockUseRemoveRoleMember({ error: new Error('Cannot remove the last admin user') });
  renderWithProviders(<RoleMembersPanel roleName="ADMIN" />);
  expect(await screen.findByText(/cannot remove the last admin user/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest src/components/Admin/Access/__tests__/RoleMembersPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement RoleMembersPanel**

- Paginated member list from `useAdminRoleMembers(roleName, page)` (Prev/Next buttons; page size 20).
- Each row: name, email, and a remove button `aria-label={localize('com_admin_access_remove_member', { 0: member.name })}` → `useRemoveRoleMember().mutate({ roleName, userId })`.
- "Add member": an `Input` (`placeholder = com_admin_access_search_users`), debounced 300ms into `useAdminUserSearch(query)`; render results as a listbox; clicking a result calls `useAddRoleMember().mutate({ roleName, userId: result.id })` and clears the query.
- Render `addMutation.error?.message ?? removeMutation.error?.message` in a `text-text-secondary` line.
- Debounce with a local `useEffect` + `setTimeout` (no new dependency).

Add a **Members** `Tabs` panel to `EditRoleDialog` that renders `<RoleMembersPanel roleName={role.name} />` (available for system and custom roles alike — assigning ADMIN membership is the primary use case).

- [ ] **Step 4: Add locale keys**

```json
"com_admin_access_tab_members": "Members",
"com_admin_access_search_users": "Search users…",
"com_admin_access_add_member": "Add member",
"com_admin_access_remove_member": "Remove {{0}}",
"com_admin_access_members_empty": "No members.",
"com_admin_access_page_prev": "Previous",
"com_admin_access_page_next": "Next"
```

- [ ] **Step 5: Run tests + typecheck + lint**

Run: `cd client && npx jest src/components/Admin/Access/__tests__/RoleMembersPanel.test.tsx`
Run: `cd client && npx tsc --noEmit`
Run: `npm run lint -- client/src/components/Admin`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Admin/Access client/src/locales/en/translation.json
git commit -m "feat(client): admin role membership management"
```

---

## Task 9: Client — Users screen: list + search

**Files:**
- Create: `client/src/components/Admin/Users/UsersView.tsx` (replace placeholder)
- Create: `client/src/components/Admin/Users/UserRow.tsx`
- Modify: `client/src/locales/en/translation.json`
- Test: `client/src/components/Admin/Users/__tests__/UsersView.test.tsx`

**Interfaces:**
- Consumes: `useAdminUsers`, `useAdminUserSearch` (Task 4), `useNavigate`
- Produces: `UsersView` default export; `UserRow` (`{ user: { id; name; email; role; provider; createdAt? }; onOpen: () => void }`)

- [ ] **Step 1: Write the failing test**

```tsx
it('lists users and navigates on row click', async () => {
  mockUseAdminUsers({ data: { users: [{ id: 'u1', name: 'Ann', email: 'a@x.io', role: 'USER', provider: 'local' }], total: 1 } });
  const navigate = jest.fn();
  mockUseNavigate(navigate);
  renderWithProviders(<UsersView />);
  await userEvent.click(await screen.findByText('Ann'));
  expect(navigate).toHaveBeenCalledWith('/admin/users/u1');
});

it('switches to server search at >= 2 chars', async () => {
  const search = mockUseAdminUserSearch({ data: { users: [{ id: 'u9', name: 'Zed', email: 'z@x.io' }] } });
  mockUseAdminUsers({ data: { users: [], total: 0 } });
  renderWithProviders(<UsersView />);
  await userEvent.type(screen.getByPlaceholderText(/search users/i), 'ze');
  expect(await screen.findByText('Zed')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest src/components/Admin/Users/__tests__/UsersView.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement UserRow + UsersView**

- `UsersView`: an `Input` search box (debounced 300ms). When `query.trim().length >= 2`, render results from `useAdminUserSearch`; otherwise render the paginated `useAdminUsers(page)` list with Prev/Next.
- Table columns: name, email, role (small badge), provider, created date (`new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })`).
- Row click → `navigate('/admin/users/' + user.id)`.
- Loading → `Spinner`; error → localized message; empty → localized message.

- [ ] **Step 4: Add locale keys**

```json
"com_admin_users_search_placeholder": "Search users…",
"com_admin_users_col_name": "Name",
"com_admin_users_col_email": "Email",
"com_admin_users_col_role": "Role",
"com_admin_users_col_provider": "Provider",
"com_admin_users_col_created": "Created",
"com_admin_users_empty": "No users found.",
"com_admin_users_load_error": "Failed to load users."
```

- [ ] **Step 5: Run test + typecheck**

Run: `cd client && npx jest src/components/Admin/Users/__tests__/UsersView.test.tsx`
Run: `cd client && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Admin/Users client/src/locales/en/translation.json
git commit -m "feat(client): admin users list and search"
```

---

## Task 10: Client — Users screen: one user's conversation list

**Files:**
- Create: `client/src/components/Admin/Users/UserConversationsView.tsx` (replace placeholder)
- Create: `client/src/components/Admin/Users/ViewingBanner.tsx`
- Modify: `client/src/locales/en/translation.json`
- Test: `client/src/components/Admin/Users/__tests__/UserConversationsView.test.tsx`

**Interfaces:**
- Consumes: `useAdminUsers` (to resolve the display name — or a dedicated fetch; see step 3), `useAdminUserConversations` (Task 4), `useParams`, `useNavigate`
- Produces: `UserConversationsView` default export; `ViewingBanner` (`{ name: string }`)

- [ ] **Step 1: Write the failing test**

```tsx
it('shows the banner and lists the user’s conversations', async () => {
  mockUseParams({ userId: 'u1' });
  mockUseAdminUserSearch({ data: { users: [{ id: 'u1', name: 'Ann', email: 'a@x.io' }] } }); // name lookup
  mockUseAdminUserConversations({
    data: { pages: [{ conversations: [{ conversationId: 'c1', title: 'Trip plan', updatedAt: '2026-01-01T00:00:00Z' }], nextCursor: null }] },
  });
  const navigate = jest.fn();
  mockUseNavigate(navigate);
  renderWithProviders(<UserConversationsView />);
  expect(await screen.findByText(/read only/i)).toBeInTheDocument();
  await userEvent.click(screen.getByText('Trip plan'));
  expect(navigate).toHaveBeenCalledWith('/admin/users/u1/c/c1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest src/components/Admin/Users/__tests__/UserConversationsView.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `ViewingBanner`: sticky bar, `bg-surface-secondary text-text-secondary`, text `localize('com_admin_viewer_banner', { 0: name })`.
- `UserConversationsView`:
  - `const { userId } = useParams()`.
  - Resolve the user's display name: reuse the row data if navigated from `UsersView` via router state; otherwise call `useAdminUserSearch` is not appropriate — instead add a light `useAdminUser(userId)` query in Task 4's queries file backed by `dataService.searchAdminUsers` is wrong too. **Decision:** pass the name via `navigate('/admin/users/:id', { state: { name } })` from `UsersView` (Task 9 step 3 — update it to include state), and fall back to the raw `userId` when `location.state?.name` is absent (e.g. deep link). No extra endpoint.
  - `useAdminUserConversations(userId, { search })` infinite query; render a flat list of `{ title || localize('com_ui_untitled'), updatedAt }`. "Load more" button when `hasNextPage`.
  - Row click → `navigate('/admin/users/' + userId + '/c/' + conversationId, { state: { name } })`.
  - "Back to users" link → `navigate('/admin/users')`.

Update `UsersView` (Task 9) row click to `navigate('/admin/users/' + user.id, { state: { name: user.name } })`.

- [ ] **Step 4: Add locale keys**

```json
"com_admin_viewer_banner": "Viewing {{0}}’s conversations — read only",
"com_admin_viewer_back_to_users": "Back to users",
"com_admin_viewer_load_more": "Load more",
"com_admin_viewer_no_conversations": "This user has no conversations."
```

- [ ] **Step 5: Run test + typecheck**

Run: `cd client && npx jest src/components/Admin/Users/__tests__/UserConversationsView.test.tsx`
Run: `cd client && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Admin/Users client/src/locales/en/translation.json
git commit -m "feat(client): admin per-user conversation list"
```

---

## Task 11: Client — Users screen: read-only conversation transcript

**Files:**
- Create: `client/src/components/Admin/Users/ConversationTranscript.tsx` (replace placeholder)
- Modify: `client/src/locales/en/translation.json`
- Test: `client/src/components/Admin/Users/__tests__/ConversationTranscript.test.tsx`

**Interfaces:**
- Consumes: `useAdminUserMessages` (Task 4), `buildTree` (`librechat-data-provider`), `MessagesView` (`~/components/Share/MessagesView`), `useParams`, `useLocation`
- Produces: `ConversationTranscript` default export

- [ ] **Step 1: Verify the Share renderer is context-free**

Read `client/src/components/Share/MessagesView.tsx`, `MultiMessage.tsx`, `Message.tsx`, and `ShareMessagesProvider.tsx`. Confirm `MessagesView` needs only `messagesTree: TMessage[]` + `conversationId: string` and does not require an outer `ChatContext`/`ShareContext` provider beyond what it wraps internally. If it *does* require `ShareMessagesProvider`, wrap the transcript in that provider (it is a read-only context). Note the finding in the commit message.

- [ ] **Step 2: Write the failing test**

```tsx
it('renders messages read-only with no composer', async () => {
  mockUseParams({ userId: 'u1', conversationId: 'c1' });
  mockUseLocation({ state: { name: 'Ann' } });
  mockUseAdminUserMessages({
    data: [
      { messageId: 'm1', parentMessageId: null, text: 'hello', isCreatedByUser: true, conversationId: 'c1' },
      { messageId: 'm2', parentMessageId: 'm1', text: 'hi there', isCreatedByUser: false, conversationId: 'c1' },
    ],
  });
  renderWithProviders(<ConversationTranscript />);
  expect(await screen.findByText('hello')).toBeInTheDocument();
  expect(screen.getByText('hi there')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /send/i })).not.toBeInTheDocument();
});

it('shows the read-only banner', async () => {
  // ...same mocks
  renderWithProviders(<ConversationTranscript />);
  expect(await screen.findByText(/read only/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd client && npx jest src/components/Admin/Users/__tests__/ConversationTranscript.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement**

```tsx
import { useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { buildTree } from 'librechat-data-provider';
import { Spinner } from '@librechat/client';
import { useAdminUserMessages } from '~/data-provider';
import { useLocalize } from '~/hooks';
import MessagesView from '~/components/Share/MessagesView';
import ViewingBanner from './ViewingBanner';

export default function ConversationTranscript() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { userId = '', conversationId = '' } = useParams();
  const { state } = useLocation() as { state?: { name?: string } };
  const name = state?.name ?? userId;

  const { data: messages, isLoading, isError } = useAdminUserMessages(userId, conversationId);
  const messagesTree = useMemo(
    () => (messages && messages.length ? buildTree({ messages }) : null),
    [messages],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewingBanner name={name} />
      <button
        type="button"
        onClick={() => navigate('/admin/users/' + userId, { state: { name } })}
        className="px-1 py-2 text-left text-sm text-text-secondary hover:text-text-primary"
      >
        {localize('com_admin_viewer_back_to_conversations')}
      </button>
      {isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : isError ? (
        <p className="text-sm text-text-secondary">{localize('com_admin_viewer_load_error')}</p>
      ) : (
        <MessagesView messagesTree={messagesTree} conversationId={conversationId} />
      )}
    </div>
  );
}
```

If Step 1 found `ShareMessagesProvider` is required, wrap `<MessagesView />` in it.

- [ ] **Step 5: Add locale keys**

```json
"com_admin_viewer_back_to_conversations": "Back to conversations",
"com_admin_viewer_load_error": "Failed to load messages."
```

- [ ] **Step 6: Run test + full typecheck + lint + i18n check**

Run: `cd client && npx jest src/components/Admin/Users/__tests__/ConversationTranscript.test.tsx`
Run: `cd client && npx tsc --noEmit`
Run: `npm run lint -- client/src/components/Admin client/src/data-provider/Admin`
Run: `npm run sort-imports -- client/src/components/Admin/**/*.tsx client/src/data-provider/Admin/*.ts`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/Admin/Users client/src/locales/en/translation.json
git commit -m "feat(client): admin read-only conversation transcript"
```

---

## Task 12: Full-stack verification

**Files:** none (verification only)

- [ ] **Step 1: Backend suite**

Run: `cd api && npx jest server/routes/__tests__/admin.users.conversations.test.js server/routes/__tests__/convos.owner-scope.test.js`
Run: `cd packages/api && npx jest src/admin`
Expected: PASS.

- [ ] **Step 2: Client suite**

Run: `cd client && npx jest src/components/Admin src/data-provider/Admin src/hooks/Nav/__tests__/useUnifiedSidebarLinks.admin.test.tsx`
Expected: PASS.

- [ ] **Step 3: Typecheck every touched workspace**

Run: `cd packages/data-provider && npx tsc --noEmit`
Run: `cd packages/api && npx tsc --noEmit`
Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Static checks**

Run: `npm run static-checks`
Expected: pass (includes unused-i18n-key check for the new `com_admin_*` keys — every key added must be referenced).

- [ ] **Step 5: Manual smoke (documented, not automated)**

With `npm run backend` + `npm run frontend:dev` and MongoDB up:
1. Log in as an ADMIN — the sidebar shows **Admin**; clicking it opens `/admin/access`.
2. Log in as a USER — no **Admin** entry; visiting `/admin/access` redirects to `/c/new`.
3. As ADMIN: create a role `support`, rename it, add a member, remove them, delete the role.
4. As ADMIN: open **Users**, pick a user, open one of their conversations — messages render, no composer, banner present.
5. As USER: `GET /api/admin/users/<id>/conversations` → 403; `GET /api/convos/<other-users-id>` → 404.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "test(admin): full-stack verification pass"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task(s) |
|---|---|
| §3 route table + shell | Task 5 |
| §4.1 no backend changes (roles) | — (verified, none) |
| §4.2 data-provider additions | Task 3 |
| §4.3 client hooks | Task 4 |
| §4.4 Access UI (list / create / edit / delete / members) | Tasks 6, 7, 8 |
| §4.5 localization | every client task adds keys; §Task 12 §4 verifies no unused keys |
| §5.1 new conversation endpoints | Tasks 1, 2 |
| §5.2 existing endpoints unchanged + regression test | Task 2 steps 6–7 |
| §5.3 client hooks (viewer) | Task 4 |
| §5.4 Users UI + transcript reuse of Share renderer | Tasks 9, 10, 11 |
| §5.5 renderer-reuse risk | Task 11 step 1 (explicit verification before implementation) |
| §6 sidebar entry + ExpandedPanel generalization | Task 5 steps 6–7 |
| §7 authorization | Tasks 1, 2 (server), Task 5 (client guard) |
| §8 testing (backend + frontend + typecheck) | every task + Task 12 |
| §10 file inventory | matches the File Structure section above |

No spec requirement is left without a task.

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". The one
deferred decision (transcript renderer needing `ShareMessagesProvider`) is written
as an explicit verification step (Task 11 Step 1) with both branches specified.

**Type consistency:** `TAdminRole`, `TAdminMember`, `TAdminUserListItem`,
`TAdminUserSearchResult` defined in Task 3 and consumed with the same names in
Tasks 4/6/7/8/9. Service function names (`listAdminRoles`, `createAdminRole`,
`updateAdminRole`, `deleteAdminRole`, `listAdminRoleMembers`, `addAdminRoleMember`,
`removeAdminRoleMember`, `listAdminUsers`, `searchAdminUsers`,
`listAdminUserConversations`, `getAdminUserConversation`,
`getAdminUserConversationMessages`) are identical across Tasks 3 and 4. Hook names
(`useAdminRoles`, `useAdminRoleMembers`, `useAdminUsers`, `useAdminUserSearch`,
`useAdminUserConversations`, `useAdminUserConversation`, `useAdminUserMessages`,
`useCreateRole`, `useUpdateRole`, `useDeleteRole`, `useAddRoleMember`,
`useRemoveRoleMember`) are identical across Tasks 4 and 6–11. Backend factory
`createAdminUserConversationsHandlers` and its three handler names match across
Tasks 1 and 2.
