# Role Hierarchy — Design Spec

**Date:** 2026-09-05
**Status:** Approved for planning
**Scope:** Restore ADMIN's ability to create custom roles, and let ADMIN arrange
custom roles into a **branch-isolated tree** (e.g. SUPERVISOR → MANAGER →
EMPLOYEE for Sales, a separate tree for Support). A role higher in a branch can
view the chat history of, see a filtered user list for, and reassign the role
of any user whose role is a strict descendant of its own — never a sibling
branch, never upward, never `USER`.

This extends the existing [in-app Admin area](2026-09-03-in-app-admin-area-design.md)
rather than replacing it — the Access and Users tabs, and the read-only
conversation viewer, all stay; this spec adds the tree and opens a scoped
slice of Users + the viewer to non-ADMIN roles.

---

## 1. Background

Today, per the prior spec:

- `role` is a single string on the user document
  (`packages/data-schemas/src/schema/user.ts`), default `SystemRoles.USER`.
  The JWT strategy re-reads the user from MongoDB every request, so a role
  change applies immediately.
- The `roles` collection (`packages/data-schemas/src/schema/role.ts`) holds
  `{ name, description, permissions, tenantId }`. Only `ADMIN` and `USER` are
  seeded (`initializeRoles`, `packages/data-schemas/src/methods/role.ts`).
  `createRoleByName`/`deleteRoleByName`/`updateRoleByName` already exist and
  work — only the frontend "Create role" affordance was removed (`f77d069f3`).
- A separate, newer ACL layer — `SystemCapabilities`
  (`packages/data-schemas/src/admin/capabilities.ts`), `systemgrants`
  collection, `requireCapability`/`hasCapability`
  (`packages/api/src/middleware/capabilities.ts`) — gates `/api/admin/*`.
  `seedSystemGrants()` grants every capability to `ROLE:ADMIN` only.
- Both `api/server/routes/admin/roles.js` and `admin/users.js` apply a
  **router-wide** `router.use(requireJwtAuth, requireCapability(ACCESS_ADMIN))`
  gate before any per-route capability check runs. This matters for the design
  below: a non-ADMIN hierarchy role must clear a widened version of this gate
  before it ever reaches a per-route check.
- The client's `useAdminGuard()` (`client/src/components/Admin/guard.tsx`)
  redirects anyone whose `role !== ADMIN`, and the sidebar entry
  (`useUnifiedSidebarLinks.ts`) is shown under the same condition.

None of this models more than two roles or any notion of "reports to."

---

## 2. Goals / Non-goals

### Goals

- ADMIN can create, rename, and delete custom roles again (restoring the
  removed UI over the never-removed backend).
- ADMIN can arrange custom roles into one or more trees via a `parentRole`
  relationship, including re-parenting an existing role's subtree.
- A user assigned a role that has descendants can, for any user whose role is
  a **strict descendant** of their own:
  - view that user's conversations read-only (reusing the existing viewer),
  - see them in a role-scoped Users list,
  - reassign their role, as long as **both** the current and the target role
    are strict descendants of the actor's role.
- Two roles in different branches (no ancestor/descendant relationship, e.g.
  siblings, or roles in unrelated trees) never see each other's users —
  branch isolation is a property of the tree, not a separate flag.
- `USER` sits outside every branch: no hierarchy role can see a plain `USER`.
  To bring someone into a team, ADMIN assigns them a branch role.
- `ADMIN` sees everything, unconditionally, via its existing `ACCESS_ADMIN`
  capability — it is not a node in the tree.
- All of the above enforced **server-side**, regardless of what the frontend
  shows or hides.

### Non-goals

- A role-permission-matrix or capability editor for custom roles beyond the
  one new capability below — feature `permissions` (bookmarks, agents, etc.)
  and existing capabilities are untouched.
- Multi-parent roles / DAGs. Each role has exactly **one** parent (or none).
  Two structurally similar roles in different branches (e.g. "Sales Employee"
  and "Support Employee") are two separate role documents.
- A graphical tree-diagram widget — an indented list is sufficient for v1.
  YAGNI on `$graphLookup`-based traversal or a materialized `ancestors[]`
  array — the resolver walks the already-cached, ~10-row role list in memory.
- Cascading delete of a role's subtree, or auto-promoting orphaned children.
  Deleting a role with children is blocked; ADMIN must restructure first.
- Any change to `/api/convos/*`, `/api/messages/*`, or the message-rendering
  components — the conversation viewer is reused unmodified.
- A superior editing, deleting, or acting inside a subordinate's conversation
  — the viewer stays strictly read-only, same as today.

---

## 3. Data model

### 3.1 Role schema additions

`packages/data-schemas/src/schema/role.ts` gains:

```ts
parentRole: { type: String, default: null, index: true },
depth: { type: Number, default: 0 },
```

- `parentRole` is the **name** of the parent role (roles are referenced by
  name everywhere in this codebase — `user.role` is a name string, and
  `updateUsersByRole`/`findRolesByNames` already key off name). `null` means
  "top-level branch."
- `depth` is denormalized: `0` for `USER`, `ADMIN`, and top-level branches;
  `parent.depth + 1` otherwise. It exists purely for the tree-editor UI and a
  cheap pre-check; it is **never** the basis for an authorization decision —
  the resolver (§4) always walks `parentRole` directly.
- `ADMIN` and `USER` keep `parentRole: null`, `depth: 0`, and never change —
  they are excluded from every mutation this feature adds (`isSystemRoleName`
  already guards `createRoleByName`/`deleteRoleByName`; the new re-parent
  method uses the same guard).

No migration is needed: the fields default safely for the two existing rows.

### 3.2 Types (`packages/data-provider`)

Extend `TAdminRole` (`packages/data-provider/src/types/admin.ts`) with
`parentRole: string | null` and `depth: number`. Add `TMyHierarchy`:

```ts
export interface TMyHierarchy {
  isAdmin: boolean;
  canViewSubordinates: boolean;
  viewableRoleNames: string[];
  manageableRoleNames: string[];
}
```

(`manageableRoleNames` is identical to `viewableRoleNames` today — kept as a
separate field so a future rule that narrows *manage* below *view* doesn't
need a response-shape change.)

---

## 4. The hierarchy resolver

One module owns every traversal so no call site hand-rolls a parent walk.
Read-only graph functions live in `packages/data-schemas/src/methods/role.ts`
(alongside the other role methods, operating on `Role.find({}, 'name
parentRole depth')` — the same ~10-row read `listRoles` already does):

```ts
getAncestorRoleNames(roleName: string): Promise<string[]>
getDescendantRoleNames(roleName: string): Promise<string[]>
isDescendantOf(childRole: string, ancestorRole: string): Promise<boolean>
canViewRole(actorRole: string, targetRole: string): Promise<boolean>
wouldCreateCycle(roleName: string, newParentName: string | null): Promise<boolean>
```

- `canViewRole` = `actorRole === SystemRoles.ADMIN || isDescendantOf(targetRole, actorRole)`.
  `USER` can never be a descendant of anything (its `parentRole` is always
  `null` and it's excluded from the walk), so it's unreachable by any
  non-ADMIN actor — this is the mechanism behind "USER is invisible to
  hierarchy roles," not a special-cased branch.
- `wouldCreateCycle(role, newParent)` = `newParent === role ||
  getDescendantRoleNames(role).includes(newParent)`. `null` newParent never
  cycles (moving to top-level).
- All five are pure over an in-memory `{ name, parentRole }` list built once
  per call — no per-call DB round trips beyond the single `Role.find`.

A mutating counterpart, `setRoleParent(roleName, newParentName)`, also in
`role.ts`:

1. Rejects `roleName` or `newParentName` naming a system role
   (`isSystemRoleName`).
2. Rejects a `newParentName` that doesn't exist (unless `null`).
3. Rejects via `wouldCreateCycle`.
4. Recomputes `depth` for `roleName` and every name in
   `getDescendantRoleNames(roleName)` (their depths shift too).
5. Invalidates the `CacheKeys.ROLES` entry for every role touched, and the
   auth-user-doc cache (`invalidateAuthUserDocCache`, already in this file)
   for every user whose `role` is in the affected subtree — their visibility
   to superiors just moved.

`packages/api/src/middleware/hierarchy.ts` is the only consumer of the
resolver from the Express layer (§5) — it never re-implements the walk.

---

## 5. Capability & middleware wiring

### 5.1 New capability

`packages/data-schemas/src/admin/capabilities.ts`:

```ts
VIEW_SUBORDINATES: 'read:subordinates',
```

added to `SystemCapabilities` and to a `CAPABILITY_CATEGORIES` entry (e.g.
`roles`, alongside `READ_ROLES`/`MANAGE_ROLES`). It is **not** implied by, nor
does it imply, `ACCESS_ADMIN` or `READ_USERS` — it is its own grant, scoped
entirely by the descendant check, never a blanket "read all users" right.

- `seedSystemGrants()` already grants every `SystemCapabilities` value to
  `ROLE:ADMIN`, so ADMIN gets it for free — no change needed there.
- `createRoleByName` grants `VIEW_SUBORDINATES` to every newly created custom
  role via `grantCapability({ principalType: ROLE, principalId: name,
  capability: VIEW_SUBORDINATES })`.
- `deleteRoleByName` revokes it via the existing `deleteGrantsForPrincipal`
  cascade call already wired into the roles route handler
  (`db.deleteGrantsForPrincipal` in `api/server/routes/admin/roles.js`) — no
  new call site, just confirm the existing cascade covers this capability
  (it does — it deletes all grants for the principal, not a named list).
- A leaf custom role (no children yet) holds the capability but
  `getDescendantRoleNames` returns `[]`, so it can see nobody. Harmless, and
  it means promoting a leaf into a branch head later needs no grant backfill.

### 5.2 Router-level gate widening (users router only)

`api/server/routes/admin/users.js` currently applies
`requireCapability(ACCESS_ADMIN)` to the whole router before any per-route
check. A hierarchy role holds neither `ACCESS_ADMIN` nor (today) `READ_USERS`,
so this blanket gate must widen to let a `VIEW_SUBORDINATES` holder in — the
per-route middleware (§5.3) still does the real scoping.

New small helper, `requireAnyCapability(capabilities: SystemCapability[])`,
added next to `requireCapability` in
`packages/api/src/middleware/capabilities.ts` (same DI pattern, same 401/403
shape): passes if `hasCapability` is true for **any** of the listed
capabilities. `admin/users.js` replaces its router-wide
`requireCapability(ACCESS_ADMIN)` with
`requireAnyCapability([ACCESS_ADMIN, READ_USERS, VIEW_SUBORDINATES])`.

`api/server/routes/admin/roles.js` is **unchanged** — Access stays strictly
`ACCESS_ADMIN`-gated at the router level, matching the confirmed decision that
role/tree editing is ADMIN-only.

### 5.3 Per-route hierarchy middleware

`packages/api/src/middleware/hierarchy.ts`, following the
`generateCapabilityCheck`/`generateCheckAccess` DI pattern:

- **`requireSubordinateAccess`** — for single-target routes
  (`:userId` conversation-viewer routes, the new reassignment route):
  1. `hasCapability(user, ACCESS_ADMIN)` → `next()` (unscoped, unchanged).
  2. `hasCapability(user, READ_USERS)` → `next()` (unscoped — preserves
     today's generic-grant behavior for any principal a deployment has
     manually granted `READ_USERS` outside this feature).
  3. `hasCapability(user, VIEW_SUBORDINATES)` → load the target user's `role`
     (one `findUsers({ _id }, 'role')` call), `canViewRole(actor.role,
     target.role)` → `next()`; else `403`.
  4. Else `403`.
- **`attachHierarchyScope`** — for `GET /` and `GET /search` (no single
  target): same precedence, but on success for the `VIEW_SUBORDINATES` branch
  it sets `req.hierarchyScope = { viewableRoleNames:
  await getDescendantRoleNames(actor.role) }` instead of calling into a
  per-target check; ADMIN/`READ_USERS` set `req.hierarchyScope = null`
  (unfiltered, current behavior). No qualifying capability → `403`.

These replace `requireReadUsers` on the five existing/new users-router routes
listed in §6; nothing else in `admin/roles.js` changes.

### 5.4 `GET /api/admin/hierarchy/me` (new, small)

A new tiny route (`api/server/routes/admin/hierarchy.js` →
`packages/api/src/admin/hierarchy.ts`, same factory-with-injected-deps shape
as the other admin modules) backing the frontend's `TMyHierarchy` query:

```ts
{
  isAdmin: hasCapability(user, ACCESS_ADMIN),
  canViewSubordinates: isAdmin || hasCapability(user, VIEW_SUBORDINATES),
  viewableRoleNames: isAdmin ? [] : await getDescendantRoleNames(user.role),
  manageableRoleNames: same as viewableRoleNames,
}
```

Gated by `requireJwtAuth` only (any authenticated user may ask "what can I
see?"; the answer is `{ isAdmin: false, canViewSubordinates: false, ...: []
}` for a plain `USER`, which is not sensitive).

---

## 6. Backend endpoint changes

| Method | Path | Guard (was → now) | Change |
|---|---|---|---|
| GET | `/api/admin/users` | `requireReadUsers` → `attachHierarchyScope` | handler adds `{ role: { $in: viewableRoleNames } }` to the Mongo filter when `req.hierarchyScope` is set |
| GET | `/api/admin/users/search` | `requireReadUsers` → `attachHierarchyScope` | same filter added to the `$or` query |
| GET | `/api/admin/users/:userId/conversations` | `requireReadUsers` → `requireSubordinateAccess` | handler unchanged — middleware already proved the target is viewable |
| GET | `/api/admin/users/:userId/conversations/:conversationId` | same | same |
| GET | `/api/admin/users/:userId/conversations/:conversationId/messages` | same | same |
| PATCH | `/api/admin/users/:userId/role` | **new** — `requireSubordinateAccess` | see §6.1 |
| GET | `/api/admin/hierarchy/me` | **new** — `requireJwtAuth` | see §5.4 |
| POST/PATCH/DELETE | `/api/admin/roles*` | unchanged (`requireAdminAccess` + `READ_ROLES`/`MANAGE_ROLES`) | body/behavior extended per §6.2 |

### 6.1 Role reassignment endpoint

`PATCH /api/admin/users/:userId/role`, body `{ role: string }`, handler in
`packages/api/src/admin/users.ts` (new `reassignUserRole` export alongside
`listUsers`/`searchUsers`), guarded by `requireSubordinateAccess`:

- ADMIN or `READ_USERS` holder → any target role, `400` if the role name
  doesn't exist. Uses `updateUsersRoleByIds([userId], role)` (existing
  helper — already invalidates the auth-user-doc cache).
- `VIEW_SUBORDINATES` holder: the middleware already proved
  `canViewRole(actor.role, currentRole)`. The handler additionally requires
  `canViewRole(actor.role, requestedRole)` — the **target** role must also be
  a strict descendant of the actor's role. Fails → `403`. This is the
  two-sided check: a MANAGER can move an EMPLOYEE to a different EMPLOYEE-tier
  role in the same branch, or to any role further down, but never up to
  MANAGER or sideways out of the branch.
- Actor changing their own role: `currentRole` is the actor's own role, which
  is never a strict descendant of itself, so `canViewRole` is `false` and the
  request is `403` — no special-cased self-check needed.
- Last-admin protection: irrelevant here (only ADMIN/`READ_USERS` holders can
  target `ADMIN` at all, and `ADMIN` is excluded from `getDescendantRoleNames`
  for any hierarchy actor), so this endpoint cannot demote the last ADMIN.

### 6.2 Role tree CRUD (ADMIN only, `admin/roles.ts` + `role.ts` methods)

- **Create** — `createRoleByName` accepts an optional `parentRole` in the
  request body. Validates the parent exists and is not `USER` (USER stays
  childless — assigning a hierarchy parent to USER would make `USER` part of
  a branch, contradicting §2). Computes `depth` from the parent, grants
  `VIEW_SUBORDINATES` (§5.1). `POST /api/admin/roles` route/handler signature
  otherwise unchanged.
- **Re-parent** — `PATCH /api/admin/roles/:name` body extends to accept
  `parentRole`; when present, the handler calls `setRoleParent` (§4) instead
  of (or in addition to, if `name`/`description` are also in the body) the
  plain `updateRoleByName` path. Errors: cycle → `400`, missing parent →
  `400`, system role → `400`.
- **Rename** — existing `updateRoleByName` path gains one extra write:
  `Role.updateMany({ parentRole: oldName }, { parentRole: newName })`, since
  children reference the parent by name and renames already fan out to
  `updateUsersByRole`.
- **Delete** — `deleteRoleByName` gains a precondition: if
  `getDescendantRoleNames(roleName)` (direct children — a one-level check
  suffices since the same guard reapplies each time) is non-empty, return
  `409` with the child count instead of deleting. ADMIN must re-parent or
  delete children first.

---

## 7. Frontend changes

### 7.1 Guard & navigation

- New hook `useMyHierarchy()` (`client/src/data-provider/Admin/queries.ts`) →
  `GET /api/admin/hierarchy/me`.
- `useAdminGuard()` (`client/src/components/Admin/guard.tsx`): while the query
  is loading, render nothing (no redirect flash); once resolved, allow when
  `isAdmin || canViewSubordinates`, else `<Navigate to="/c/new" />` as today.
  The header comment explaining the role-vs-capability gap is updated to
  describe the new capability-aware check.
- `useUnifiedSidebarLinks.ts`: `isAdmin` at line 71 becomes `isAdmin ||
  canViewSubordinates` for whether the "Admin" `NavLink` is added — the link
  label/icon/target stay the same; `AdminLayout` decides what's inside.

### 7.2 `AdminLayout.tsx`

The `Access` tab (`tab('/admin/access', ...)`) renders only when `isAdmin`.
The `Users` tab renders whenever the guard let the user in at all (ADMIN or a
hierarchy role). No other layout change.

### 7.3 Access tab (ADMIN only)

- **Restore Create Role**: bring back `CreateRoleDialog.tsx` and the
  `useCreateRole` mutation removed in `f77d069f3` (recoverable verbatim via
  `git show f77d069f3^:client/src/components/Admin/Access/CreateRoleDialog.tsx`
  as a starting point), add a parent picker — a `<select>` of existing
  non-`USER` role names plus a "Top-level branch" option mapping to `null`. No
  raw depth/rank numbers are ever shown to ADMIN.
- **`EditRoleDialog`**: add a "Reports to" field using the same picker,
  client-side excluding the role itself and its own descendants (a UX nicety
  — `wouldCreateCycle` is still the authoritative server-side gate).
- **`AccessView`** list: indent `RoleRow` by `depth`, or show a "Reports to:
  {parentName}" line per row — enough to make the tree legible without a
  graphical widget.
- **Delete confirmation**: surface the `409` child-count message from §6.2
  instead of the generic delete confirm when the role has children.

### 7.4 Users tab (any role admitted by the guard)

- `UsersView`/`UserRow`: for a non-ADMIN viewer (`!isAdmin &&
  canViewSubordinates`), add a "Change role" `<select>` per row, populated
  from `manageableRoleNames`, calling a new `useSetUserRole` mutation
  (`PATCH /api/admin/users/:userId/role`). ADMIN keeps managing membership via
  the existing Access → Members flow; no redundant control is added there for
  v1.
- The list itself needs **no new client logic** for scoping — the backend
  filter (§6) already returns only viewable users, so `UsersView` renders
  exactly what it does today over a pre-filtered result set.
- `UserConversationsView`, `ConversationTranscript`, `ViewingBanner`: **no
  changes**. A superior simply never receives a row/link for a user outside
  their subtree; the URL-typed-directly case is covered server-side by
  `requireSubordinateAccess` returning `403`.

### 7.5 Data-provider wiring

- `packages/data-provider/src/api-endpoints.ts`: restore `adminRoles` (POST
  target — it already exists for GET), add `adminRoleParent` reuses the
  existing `adminRole(name)` PATCH target (no new URL, just a documented body
  shape), `adminHierarchyMe`, `adminUserRole(userId)`.
- `packages/data-provider/src/data-service.ts`: restore `createAdminRole`;
  add `setAdminRoleParent`, `getMyHierarchy`, `setAdminUserRole`.
- `packages/data-provider/src/keys.ts`: add `QueryKeys.myHierarchy` (the role
  list key already exists and is reused for the tree view — no separate
  "role tree" key needed since `TAdminRole` now just carries `parentRole`/
  `depth` inline).
- `client/src/data-provider/Admin/{queries,mutations}.ts`: `useMyHierarchy`,
  restored `useCreateRole`, new `useSetRoleParent`, `useSetUserRole`.
  Mutations invalidate `adminRoles`, `myHierarchy`, `adminUsers`/
  `adminUserSearch`, and `[QueryKeys.user]` (the existing self-demotion
  pattern — reassigning *your own* superior's role out from under a session
  is out of scope, but invalidating `user` is what already drives the
  guard-redirect-on-self-change behavior elsewhere in this codebase).
- New `com_admin_*` locale keys only in `client/src/locales/en/translation.json`
  (parent-picker labels, "reports to," change-role control, the child-count
  delete-blocked message).

---

## 8. Authorization summary

| Surface | Guard |
|---|---|
| `/api/admin/roles*` | unchanged: `requireJwtAuth` + `ACCESS_ADMIN` (router) + `READ_ROLES`/`MANAGE_ROLES` (per route) |
| `/api/admin/users`, `/search` | `requireJwtAuth` + `requireAnyCapability([ACCESS_ADMIN, READ_USERS, VIEW_SUBORDINATES])` (router, widened) + `attachHierarchyScope` (per route) |
| `/api/admin/users/:userId/conversations*` | same router gate + `requireSubordinateAccess` (per route) |
| `/api/admin/users/:userId/role` (new) | same router gate + `requireSubordinateAccess` + the two-sided target-role check in the handler |
| `/api/admin/hierarchy/me` (new) | `requireJwtAuth` only — answer is capability-shaped, not sensitive |
| `/api/convos/*`, `/api/messages/*` | unchanged: owner-scoped Mongo filter on `req.user.id` |
| Client `/admin/*` routes | `useAdminGuard()` → allow if `isAdmin \|\| canViewSubordinates`; `AdminLayout` hides Access from non-ADMIN — cosmetic only, real enforcement is the API |

No endpoint trusts a role, userId, or acting-identity value from the request
body, query, or headers for *authorization* — `req.user.role`/`req.user.id`
come from the JWT strategy's per-request DB read, exactly as today. The one
place a caller-supplied role name is trusted as *data* is the reassignment
endpoint's `{ role }` body — and it is validated against the descendant check
before being written, never trusted as the caller's own identity.

---

## 9. Error handling summary

| Condition | Response |
|---|---|
| Re-parent would create a cycle | `400` |
| Re-parent/delete/create-with-parent targeting `ADMIN`/`USER` as the affected or parent role | `400` |
| Delete a role that has children | `409` + child count |
| Reassign to a role name that doesn't exist | `400` |
| Non-ADMIN, non-`READ_USERS`, non-`VIEW_SUBORDINATES` caller hits any users-router route | `403` (router-level `requireAnyCapability`) |
| `VIEW_SUBORDINATES` holder targets a user outside their subtree (viewer or reassignment) | `403` (`requireSubordinateAccess`) |
| `VIEW_SUBORDINATES` holder lists/searches users | list is filtered to `viewableRoleNames`; no error, just fewer rows |
| `VIEW_SUBORDINATES` holder reassigns to a role outside their subtree | `403` (handler's second `canViewRole` check) |
| Actor reassigns their own role | `403` (self is never a strict descendant of self) |
| Non-ADMIN hits `/api/admin/roles*` | `403` (unchanged) |

---

## 10. Testing strategy

### Resolver (`packages/data-schemas`, plain-array unit tests, no DB)

- `getAncestorRoleNames`/`getDescendantRoleNames` over a multi-branch tree.
- `canViewRole`: ADMIN bypass, direct child, deep descendant, sibling denied,
  cross-branch denied, `USER` unreachable by any non-ADMIN role.
- `wouldCreateCycle`: self-parent, parent-is-own-descendant, unrelated move
  (false), move to `null` (false).
- `setRoleParent`: cycle rejection, system-role rejection, subtree `depth`
  recompute, `CacheKeys.ROLES`/auth-user-doc cache invalidation (spy-based,
  per the project's "spies over mocks" testing philosophy).

### Backend (`packages/api`, jest + `connectTestDb` per the existing admin-area
tests — `mongodb-memory-server` does not work on this machine, see
[[mongo-atlas-non-srv-uri]])

- `hierarchy.spec.ts`: `requireSubordinateAccess`/`attachHierarchyScope`
  matrix (ADMIN, `READ_USERS` holder, `VIEW_SUBORDINATES` holder in-subtree,
  `VIEW_SUBORDINATES` holder out-of-subtree, no capability) — DI-style,
  mirroring the existing `capabilities.spec.ts` pattern.
- `users.spec.ts` additions: `listUsers`/`searchUsers` with a role filter
  applied; `reassignUserRole` allow/deny matrix from §6.1, including the
  self-reassignment denial and the "target role doesn't exist" `400`.
- `roles.spec.ts` additions: create with `parentRole`, re-parent success and
  each rejection case, rename repoints children, delete-blocked-with-children.
- End-to-end integration: build a two-branch tree (Sales:
  SUPERVISOR→MANAGER→EMPLOYEE, Support: MANAGER→EMPLOYEE), assign real test
  users, mint JWTs per role, and assert list/search/viewer/reassignment
  boundaries — including that a Sales MANAGER cannot see or move a Support
  EMPLOYEE.

### Frontend (`client`, jest + `test/layout-test-utils`)

- `useAdminGuard`: loading (no redirect), ADMIN, hierarchy role, plain user.
- `CreateRoleDialog` with the parent picker; `EditRoleDialog` re-parent,
  including the cycle-rejection error surfacing from the server message.
- `UsersView` role-change control: renders only for non-ADMIN viewers with
  `canViewSubordinates`, success path invalidates the list, `403` surfaces
  the server message.
- Sidebar: `useUnifiedSidebarLinks` includes the Admin link for a hierarchy
  role, not for a plain `USER`.

### Typecheck / static

`npx tsc --noEmit` in `client`, `packages/api`, `packages/data-schemas`,
`packages/data-provider`; `npm run build:data-provider` after editing that
package; `npm run sort-imports -- <touched files>`; `npm run lint`.

---

## 11. Rollout / risk

- Fully additive. `parentRole`/`depth` default safely; `ADMIN`/`USER` are
  untouched; no config flag, no data migration.
- Inert until ADMIN creates a custom role — a fresh or existing deployment
  with only `ADMIN`/`USER` behaves exactly as before this feature ships.
- The router-level gate widening on `admin/users.js` (§5.2) is the one change
  that touches an existing, currently-ADMIN-only surface; it's covered by the
  "non-ADMIN, non-qualifying caller still gets 403" test in §10 to guard
  against accidentally opening the users list to every authenticated user.
- The conversation viewer, its data layer, and `/api/convos/*`/
  `/api/messages/*` are untouched — no new risk to the main chat data path.

---

## 12. File-change inventory

**New:**

- `packages/api/src/admin/hierarchy.ts` (+ `.spec.ts`) — `GET
  /api/admin/hierarchy/me` handler
- `packages/api/src/middleware/hierarchy.ts` (+ `.spec.ts`) —
  `requireSubordinateAccess`, `attachHierarchyScope`
- `api/server/routes/admin/hierarchy.js` — route wiring
- `client/src/components/Admin/Access/CreateRoleDialog.tsx` (restored)
- `docs/superpowers/specs/2026-09-05-role-hierarchy-design.md` (this file)

**Modified:**

- `packages/data-schemas/src/schema/role.ts` — `parentRole`, `depth`
- `packages/data-schemas/src/methods/role.ts` — resolver functions,
  `setRoleParent`, `createRoleByName`/`deleteRoleByName`/`updateRoleByName`
  extensions
- `packages/data-schemas/src/admin/capabilities.ts` — `VIEW_SUBORDINATES`
- `packages/api/src/middleware/capabilities.ts` — `requireAnyCapability`
- `packages/api/src/admin/users.ts` — role-filtered list/search,
  `reassignUserRole` handler
- `packages/api/src/admin/roles.ts` — `parentRole` in create/update, child-
  count delete guard
- `api/server/routes/admin/users.js` — widened router gate, swap
  `requireReadUsers` for the new hierarchy middleware, new `PATCH
  /:userId/role` route
- `api/server/routes/admin/roles.js` — pass `parentRole`-aware deps through
  (no gate change)
- `packages/data-provider/src/{api-endpoints,data-service,keys}.ts` —
  restored + new admin hierarchy functions/keys
- `packages/data-provider/src/types/admin.ts` — `TAdminRole` extensions,
  `TMyHierarchy`
- `client/src/data-provider/Admin/{queries,mutations}.ts` — restored +
  new hooks
- `client/src/components/Admin/guard.tsx` — capability-aware guard
- `client/src/components/Admin/AdminLayout.tsx` — Access tab ADMIN-only
- `client/src/components/Admin/Access/{AccessView,EditRoleDialog}.tsx` —
  parent picker, tree display, delete-blocked message
- `client/src/components/Admin/Users/{UsersView,UserRow}.tsx` — change-role
  control
- `client/src/hooks/Nav/useUnifiedSidebarLinks.ts` — widened admin-link
  condition
- `client/src/locales/en/translation.json` — new `com_admin_*` keys
