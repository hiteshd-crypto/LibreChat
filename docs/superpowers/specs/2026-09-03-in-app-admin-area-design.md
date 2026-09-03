# In-App Admin Area — Design Spec

**Date:** 2026-09-03
**Status:** Approved for planning
**Scope:** Add a minimal, in-app admin area to the LibreChat client (sidebar entry
+ dedicated routes), reusing LibreChat's own tech stack. Two capabilities:

1. **Access (Roles)** — list roles, create / rename / delete roles, manage role
   membership (assign / unassign users to a role). No feature-permission matrix.
2. **Admin conversation viewer** — an admin selects a user and views that user's
   conversations and messages, strictly read-only.

The external ClickHouse admin panel (`ClickHouse/librechat-admin-panel`) is **not**
modified and remains a separate optional deployment. This feature is an independent,
lighter alternative that lives inside the main app.

---

## 1. Background

LibreChat already has a complete RBAC backend:

- `role` field on the user schema (`packages/data-schemas/src/schema/user.ts`),
  default `SystemRoles.USER`; first registered user in a single-tenant deployment
  bootstraps `ADMIN` (`api/server/services/AuthService.js`).
- The JWT strategy re-reads the user from MongoDB on every request
  (`api/strategies/jwtStrategy.js`), so `req.user.role` is trusted server state;
  the token carries only `id`.
- Admin API routes already mounted in `api/server/index.js`:
  - `/api/admin/roles` (`api/server/routes/admin/roles.js` →
    `createAdminRolesHandlers` in `packages/api/src/admin/roles.ts`)
  - `/api/admin/users` (`api/server/routes/admin/users.js` →
    `createAdminUsersHandlers` in `packages/api/src/admin/users.ts`)
  - `/api/admin/grants`, `/api/admin/audit-log`, `/api/admin/config`, etc.
- Capability middleware `requireCapability(SystemCapabilities.X)`
  (`api/server/middleware/roles/capabilities.js`). `ADMIN` holds every
  `SystemCapabilities` value by default
  (`packages/data-schemas/src/admin/capabilities.ts`).

The **Insights** feature is the reference pattern for an admin-gated in-app area:

- Sidebar link conditionally added in
  `client/src/hooks/Nav/useUnifiedSidebarLinks.ts`.
- Lazy route `insights` in `client/src/routes/index.tsx` under the authenticated
  `Root`.
- `client/src/components/Insights/InsightsView.tsx` re-checks access and
  `<Navigate to="/c/new" replace />` when not allowed.
- Data hooks in `client/src/data-provider/Insights/queries.ts` calling
  `dataService` methods.
- Backend under `/api/admin/insights` + `packages/api/src/insights/`.

This design mirrors that pattern.

---

## 2. Goals / Non-goals

### Goals

- An **"Admin"** entry in the left sidebar, visible only to `ADMIN` users.
- **Access (Roles)** screen: role list + create + rename + delete + member
  add/remove, backed entirely by the existing `/api/admin/roles*` endpoints.
- **Admin conversation viewer**: pick a user → browse their conversations → open a
  conversation and read its messages. Read-only.
- All authorization enforced on the **backend**. The frontend never supplies the
  acting user's role or identity; `:userId` in admin URLs is validated against
  `req.user` server-side.
- Reuse existing components, endpoints, models, and styling conventions.
- No behavior change for non-admins and no config flag required.

### Non-goals (explicitly out of scope)

- Groups tab / group management.
- Role **feature-permission matrix** editor (`role.permissions.*` toggles).
- **Grants / capabilities** screen and the audit log.
- Configuration (`librechat.yaml`) editor.
- Dashboard / Help screens from the external panel.
- Admin **acting** inside another user's conversation (send, edit, delete, fork,
  rename, regenerate, branch).
- Any change to the behavior of `/api/convos/*` or `/api/messages/*`.
- Any change to the external `ClickHouse/librechat-admin-panel` app.
- Tenant-scoped or multi-tenant admin semantics beyond what the existing
  `/api/admin/*` handlers already implement.

---

## 3. Architecture overview

```
client/src/
  components/Admin/
    AdminLayout.tsx              shell: header + sub-nav (Access | Users), <Outlet/>
    guard.ts                     useAdminGuard() → redirect non-admins
    Access/
      AccessView.tsx             roles list screen (route: /admin/access)
      RoleRow.tsx
      CreateRoleDialog.tsx
      EditRoleDialog.tsx         rename + delete + members tab
      RoleMembersPanel.tsx       list members, add (user search), remove
    Users/
      UsersView.tsx              user list + search (route: /admin/users)
      UserRow.tsx
      UserConversationsView.tsx  one user's conversations (route: /admin/users/:userId)
      ConversationTranscript.tsx read-only messages
                                 (route: /admin/users/:userId/c/:conversationId)
      ViewingBanner.tsx          "Viewing {name}'s conversations — read only"
    index.ts
  data-provider/Admin/
    queries.ts                   useAdminRoles, useAdminRoleMembers, useAdminUsers,
                                 useAdminUserSearch, useAdminUserConversations,
                                 useAdminUserConversation, useAdminUserMessages
    mutations.ts                 useCreateRole, useUpdateRole, useDeleteRole,
                                 useAddRoleMember, useRemoveRoleMember
    index.ts
  hooks/Nav/useUnifiedSidebarLinks.ts   + "Admin" NavLink when role === ADMIN
  routes/index.tsx                      + lazy admin routes

packages/data-provider/src/
  api-endpoints.ts               + admin URL builders
  data-service.ts                + admin service functions
  types/                         + admin request/response types
  keys.ts                        + QueryKeys.adminRoles, etc.

packages/api/src/admin/
  conversations.ts               createAdminUserConversationsHandlers (NEW)
  index.ts                       export the new factory

api/server/routes/admin/users.js  + wire the 3 new conversation routes
```

### Route table (all lazy, under authenticated `Root` in `routes/index.tsx`)

| Path | Component | Notes |
|---|---|---|
| `admin` | redirect | → `admin/access` |
| `admin/access` | `AccessView` | roles list |
| `admin/users` | `UsersView` | user list + search |
| `admin/users/:userId` | `UserConversationsView` | that user's conversations |
| `admin/users/:userId/c/:conversationId` | `ConversationTranscript` | read-only messages |

All admin components call `useAdminGuard()` which returns `<Navigate to="/c/new"
replace />` when `user?.role !== SystemRoles.ADMIN` (defense in depth; the real
enforcement is server-side).

---

## 4. Screen 1 — Access (Roles)

### 4.1 Backend — no changes

Endpoints already exist (`api/server/routes/admin/roles.js`), guarded by
`requireJwtAuth` + `requireCapability(ACCESS_ADMIN)` + `READ_ROLES` / `MANAGE_ROLES`:

| Method | Path | Body / Params | Response |
|---|---|---|---|
| GET | `/api/admin/roles?limit=&offset=` | — | `{ roles: [{ _id, name, description?, permissions? }], total, limit, offset }` |
| POST | `/api/admin/roles` | `{ name, description? }` | `{ role }` (201) |
| GET | `/api/admin/roles/:name` | — | `{ role }` |
| PATCH | `/api/admin/roles/:name` | `{ name?, description? }` | `{ role }` |
| DELETE | `/api/admin/roles/:name` | — | `{ success: true }` |
| GET | `/api/admin/roles/:name/members?limit=&offset=` | — | `{ members: [{ userId, name, email, avatarUrl? }], total, limit, offset }` |
| POST | `/api/admin/roles/:name/members` | `{ userId }` | `{ success: true }` |
| DELETE | `/api/admin/roles/:name/members/:userId` | — | `{ success: true }` |

Guardrails already implemented server-side and relied on (not re-implemented in
the client): cannot rename/delete a system role (`ADMIN`, `USER`); cannot remove
the last admin; renaming migrates members.

The role identifier in all sub-paths is the **role name** (there is no separate
role id in this API). The client treats `name` as the id, matching the external
panel's `toRole()` mapping.

### 4.2 Data-provider additions (`packages/data-provider`)

`api-endpoints.ts`:

```ts
export const adminRoles = (params?: { limit?: number; offset?: number }) =>
  `${BASE_URL}/api/admin/roles${buildQuery(params ?? {})}`;
export const adminRole = (name: string) =>
  `${BASE_URL}/api/admin/roles/${encodeURIComponent(name)}`;
export const adminRoleMembers = (name: string, params?: { limit?: number; offset?: number }) =>
  `${adminRole(name)}/members${buildQuery(params ?? {})}`;
export const adminRoleMember = (name: string, userId: string) =>
  `${adminRole(name)}/members/${encodeURIComponent(userId)}`;
export const adminUsers = (params?: { limit?: number; offset?: number }) =>
  `${BASE_URL}/api/admin/users${buildQuery(params ?? {})}`;
export const adminUserSearch = (q: string, limit?: number) =>
  `${BASE_URL}/api/admin/users/search${buildQuery({ q, limit })}`;
export const adminUserConversations = (userId: string, params?: Record<string, unknown>) =>
  `${BASE_URL}/api/admin/users/${encodeURIComponent(userId)}/conversations${buildQuery(params ?? {})}`;
export const adminUserConversation = (userId: string, conversationId: string) =>
  `${BASE_URL}/api/admin/users/${encodeURIComponent(userId)}/conversations/${encodeURIComponent(conversationId)}`;
export const adminUserConversationMessages = (userId: string, conversationId: string) =>
  `${adminUserConversation(userId, conversationId)}/messages`;
```

`data-service.ts` — thin wrappers over `request.get/post/delete/patch` returning
typed responses (`listAdminRoles`, `createAdminRole`, `updateAdminRole`,
`deleteAdminRole`, `listAdminRoleMembers`, `addAdminRoleMember`,
`removeAdminRoleMember`, `listAdminUsers`, `searchAdminUsers`,
`listAdminUserConversations`, `getAdminUserConversation`,
`getAdminUserConversationMessages`).

`types/` — a new `types/admin.ts` (re-exported from `types.ts`):
`TAdminRole`, `TAdminRoleListResponse`, `TAdminMember`, `TAdminMemberListResponse`,
`TAdminUserListItem`, `TAdminUserListResponse`, `TAdminUserSearchResult`,
`TAdminUserSearchResponse`. Reuse `TConversation` / `TMessage` from
`librechat-data-provider` for the viewer responses — do not redefine.

`keys.ts` — `QueryKeys.adminRoles`, `adminRoleMembers`, `adminUsers`,
`adminUserSearch`, `adminUserConversations`, `adminUserConversation`,
`adminUserMessages`.

### 4.3 Client hooks (`client/src/data-provider/Admin`)

React Query v4 style (array key + positional fn + options object), matching
`client/src/data-provider/roles.ts` and `Insights/queries.ts`:

- `useAdminRoles()` → `dataService.listAdminRoles({ limit: 200 })`
- `useAdminRoleMembers(roleName, page)` → paginated
- `useCreateRole()`, `useUpdateRole()`, `useDeleteRole()` — invalidate
  `[QueryKeys.adminRoles]`
- `useAddRoleMember()`, `useRemoveRoleMember()` — invalidate
  `[QueryKeys.adminRoleMembers, roleName]` and `[QueryKeys.adminUsers]`

### 4.4 UI (`client/src/components/Admin/Access`)

Ported from the external panel's `src/components/access/{RolesTab,CreateRoleDialog,
EditRoleDialog}.tsx`, rebuilt with `@librechat/client` primitives (`Button`,
`Input`, `OGDialog`/dialog primitives, `Spinner`), Tailwind **semantic tokens**
only, and `useLocalize()`. No `@clickhouse/click-ui`, no TanStack Router, no
`createServerFn` — those become `dataService` calls and react-router navigation.

- `AccessView`: search box (client-side filter over the fetched list), "Create
  role" button, list of `RoleRow`.
- `RoleRow`: name + "System" badge for `ADMIN`/`USER`; click opens
  `EditRoleDialog`; trash affordance for non-system roles only.
- `CreateRoleDialog`: `{ name, description? }` → `useCreateRole`.
- `EditRoleDialog`: tabs **Details** (rename, description; disabled for system
  roles) and **Members** (`RoleMembersPanel`). Delete button for non-system roles
  with a confirm dialog.
- `RoleMembersPanel`: paginated member list (`useAdminRoleMembers`); "Add member"
  uses a debounced user search (`useAdminUserSearch`, min 2 chars, backed by
  `GET /api/admin/users/search`); remove per row. Optimistic UX via mutation
  `onSuccess` invalidation, not manual cache writes.

All error states surface the server message (the handlers return
`{ error: '…' }`); loading states use `Spinner`; empty states are localized.

### 4.5 Localization

New `com_admin_*` keys added to `client/src/locales/en/translation.json` **only**
(other languages are automated). Prefix families: `com_admin_nav_*`,
`com_admin_access_*`, `com_admin_users_*`, `com_admin_viewer_*`.

---

## 5. Screen 2 — Admin conversation viewer

### 5.1 Backend — new endpoints

**New factory** `packages/api/src/admin/conversations.ts`:

```ts
export interface AdminUserConversationsDeps {
  findUsers: (filter, fields?, options?) => Promise<IUser[]>;      // reuse db.findUsers
  getConvosByCursor: ConversationMethods['getConvosByCursor'];
  getConvo: ConversationMethods['getConvo'];
  getMessages: MessageMethods['getMessages'];
}

export function createAdminUserConversationsHandlers(deps: AdminUserConversationsDeps): {
  listUserConversations: (req, res) => Promise<Response>;
  getUserConversation: (req, res) => Promise<Response>;
  getUserConversationMessages: (req, res) => Promise<Response>;
}
```

Behavior:

- `listUserConversations` — validate `:userId` is a valid ObjectId string
  (`isValidObjectIdString`); 404 if no such user (`findUsers({ _id }, '_id', { limit: 1 })`).
  Then `getConvosByCursor(userId, { cursor, limit, search, isArchived, sortBy,
  sortDirection })`. `limit` clamped to `[1, 50]`. Returns the same
  `{ conversations, nextCursor }` shape the existing `GET /api/convos` returns.
- `getUserConversation` — `getConvo(userId, conversationId)`; 404 if `null`.
- `getUserConversationMessages` — first confirm ownership via
  `getConvo(userId, conversationId)` (404 if `null`), then
  `getMessages({ conversationId, user: userId }, CLIENT_MESSAGE_SELECT,
  { sort: { createdAt: 1 } })`. Returns `TMessage[]`.

`:userId` is taken from the URL and used **only** as the Mongo owner filter. The
acting principal is `req.user` (trusted, DB-loaded). No request field influences
authorization.

**Route wiring** — `api/server/routes/admin/users.js`:

```js
const conversationHandlers = createAdminUserConversationsHandlers({
  findUsers: db.findUsers,
  getConvosByCursor: db.getConvosByCursor,
  getConvo: db.getConvo,
  getMessages: db.getMessages,
});

router.get('/:userId/conversations', requireReadUsers, conversationHandlers.listUserConversations);
router.get('/:userId/conversations/:conversationId', requireReadUsers, conversationHandlers.getUserConversation);
router.get('/:userId/conversations/:conversationId/messages', requireReadUsers, conversationHandlers.getUserConversationMessages);
```

The file-level `router.use(requireJwtAuth, requireAdminAccess)` already applies;
`requireReadUsers = requireCapability(SystemCapabilities.READ_USERS)` is already
defined in that file.

Route ordering: these are added **after** `router.get('/')` and
`router.get('/search', …)` so `/search` is not shadowed by `/:userId`.

### 5.2 Existing endpoints — unchanged

`GET /api/convos/:conversationId` and `GET /api/messages/:conversationId` already
filter by `req.user.id` in the Mongo query, so a non-owner request yields an empty
result → 404. This already satisfies "a normal user's direct API request for
another user's conversation is denied." **We keep 404** (no resource-existence
leak) rather than converting to 403. A regression test locks this in.

### 5.3 Client hooks (`client/src/data-provider/Admin`)

- `useAdminUsers(page)` — `GET /api/admin/users`
- `useAdminUserSearch(query)` — enabled when `query.trim().length >= 2`, debounced
  in the component
- `useAdminUserConversations(userId, { search })` — `useInfiniteQuery`, cursor
  paginated, mirrors `useConversationsInfiniteQuery`
- `useAdminUserConversation(userId, conversationId)`
- `useAdminUserMessages(userId, conversationId)`

### 5.4 UI (`client/src/components/Admin/Users`)

- `UsersView`: search input (server search ≥ 2 chars, else the paginated list),
  table of `UserRow` (name, email, role badge, provider, created date). Row click
  → `navigate('/admin/users/:userId')`.
- `UserConversationsView`: `ViewingBanner` at top; infinite-scroll list of the
  user's conversations (title + updatedAt). Row click →
  `navigate('/admin/users/:userId/c/:conversationId')`. "Back to users" link.
- `ConversationTranscript`: `ViewingBanner`; conversation title; ordered list of
  messages rendered read-only.
  - **Reuse target:** the presentational message renderer used by the shared-link
    view (`client/src/components/Share/` renders `TMessage[]` without the live
    chat context) — investigate `Share`'s message list first; it is the closest
    existing read-only transcript. Fall back to the lower-level content/markdown
    renderers (`client/src/components/Chat/Messages/Content/*`,
    `client/src/components/Messages/`) if `Share` proves unsuitable.
  - **No** composer, edit, delete, copy-to-continue, fork, regenerate, branch,
    feedback, or TTS controls.
- `ViewingBanner`: sticky, semantic-token styled, text
  `com_admin_viewer_banner` = "Viewing {{0}}'s conversations — read only".

### 5.5 Known risk

The message-rendering tree may be too coupled to conversation/streaming context to
reuse directly. Mitigation ordering: (1) shared-link `Share` renderer, (2)
Content part renderers with a minimal wrapper, (3) plain `Markdown` of
`message.text` / text content parts. Item 3 is an acceptable MVP if 1 and 2 are
impractical; the plan's first viewer task validates this before the UI task.

---

## 6. Sidebar entry

`client/src/hooks/Nav/useUnifiedSidebarLinks.ts` — add, inside the `useMemo`,
when `user?.role === SystemRoles.ADMIN`:

```ts
const adminLink: NavLink = {
  title: 'com_admin_nav_title',
  label: '',
  icon: ShieldCheck,           // from lucide-react
  id: 'admin',
  onClick: () => {
    if (!location.pathname.startsWith('/admin')) {
      navigate('/admin/access');
    }
  },
};
```

Inserted after the Insights link if present, else after `mcp-builder`, else
appended — same splice logic already used for `insightsLink`. `ExpandedPanel`'s
route-active handling (`isInsightsRoute`) is generalized to also treat
`/admin` as a full-page route (`location.pathname.startsWith('/admin')`), so the
conversation panel collapses the same way it does for Insights.

---

## 7. Authorization summary

| Surface | Guard |
|---|---|
| `/api/admin/roles*` | existing: `requireJwtAuth` + `ACCESS_ADMIN` + `READ_ROLES`/`MANAGE_ROLES` |
| `/api/admin/users`, `/search` | existing: `requireJwtAuth` + `ACCESS_ADMIN` + `READ_USERS` |
| `/api/admin/users/:userId/conversations*` (new) | `requireJwtAuth` + `ACCESS_ADMIN` + `READ_USERS` |
| `/api/convos/*`, `/api/messages/*` | unchanged: owner-scoped Mongo filter on `req.user.id` |
| Client `/admin/*` routes | `useAdminGuard()` → redirect; cosmetic only |

`req.user.role` / `req.user.id` come from the JWT strategy's per-request DB read.
No endpoint trusts a role, userId, or acting-identity value from the request body,
query, or headers. `:userId` path params are used solely as data-scope filters
behind the capability gate.

---

## 8. Testing

### Backend (`packages/api`, jest + `mongodb-memory-server` per CLAUDE.md)

`packages/api/src/admin/conversations.spec.ts`:

- admin lists another user's conversations → 200, only that user's convos,
  archived/temporary excluded per `getConvosByCursor` behavior
- admin opens another user's conversation → 200
- admin reads another user's messages → 200, `CLIENT_MESSAGE_SELECT` fields absent
- `:userId` not a valid ObjectId → 400
- `:userId` valid but unknown → 404
- conversation not owned by `:userId` → 404 (messages endpoint too)
- caller without `READ_USERS` (a `USER`) → 403 (via `requireCapability`)
- unauthenticated → 401

`api/server/routes/__tests__` (or alongside `convos`): regression —
`GET /api/convos/:id` for a conversation owned by another user still returns 404,
and `GET /api/messages/:id` likewise.

### Frontend (`client`, jest + `test/layout-test-utils`)

- `AccessView` — loading / list / error; system-role rows have no delete;
  "Create role" opens dialog
- `RoleMembersPanel` — member list renders; add via search; remove; last-admin
  error surfaces from the server response
- `UsersView` — list, search (≥2 chars), row navigation
- `ConversationTranscript` — renders `TMessage[]` read-only; no composer/edit
  controls present in the DOM
- admin guard — a non-`ADMIN` user rendering any `/admin/*` component gets
  `<Navigate to="/c/new">`

### Typecheck / static

`npx tsc --noEmit` in `client`, `packages/api`, `packages/data-provider`,
`packages/data-schemas` for any touched workspace. `npm run build:data-provider`
after editing `packages/data-provider`. `npm run sort-imports -- <files>` and
`npm run lint` on touched files.

---

## 9. Rollout / risk

- Additive only. Non-admins see no change; no migrations; no config keys.
- New backend routes are namespaced under the already-gated `/api/admin` tree.
- The viewer is read-only; there is no write path to another user's data.
- Main chat data flow (`useConversationsInfiniteQuery`, message SSE, composer) is
  untouched — the viewer has its own isolated data layer.
- If the transcript-renderer reuse fails, the fallback (plain markdown) still
  delivers the feature.

---

## 10. File-change inventory

**New:**

- `packages/api/src/admin/conversations.ts` (+ `.spec.ts`)
- `client/src/components/Admin/**` (layout, guard, Access/*, Users/*, index)
- `client/src/data-provider/Admin/{queries,mutations,index}.ts`
- `packages/data-provider/src/types/admin.ts`
- `docs/superpowers/specs/2026-09-03-in-app-admin-area-design.md` (this file)

**Modified:**

- `packages/api/src/admin/index.ts` — export new factory
- `api/server/routes/admin/users.js` — wire 3 routes
- `packages/data-provider/src/api-endpoints.ts` — admin URL builders
- `packages/data-provider/src/data-service.ts` — admin service fns
- `packages/data-provider/src/types.ts` — re-export `./types/admin`
- `packages/data-provider/src/keys.ts` — new `QueryKeys`
- `client/src/data-provider/index.ts` — re-export `Admin`
- `client/src/routes/index.tsx` — lazy admin routes
- `client/src/hooks/Nav/useUnifiedSidebarLinks.ts` — admin `NavLink`
- `client/src/components/UnifiedSidebar/ExpandedPanel.tsx` — treat `/admin` as a
  full-page route (generalize `isInsightsRoute` handling)
- `client/src/locales/en/translation.json` — `com_admin_*` keys
