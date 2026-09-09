# Role Identity Keys + Access Tree Editing — Design Spec

**Date:** 2026-09-09
**Status:** Draft for review
**Builds on:** [Role Hierarchy](2026-09-05-role-hierarchy-design.md) and the
[in-app Admin area](2026-09-03-in-app-admin-area-design.md). The branch-isolated
role tree, `VIEW_SUBORDINATES` capability, hierarchy middleware, scoped Users
tab, and role-reassignment endpoint all stay; this spec changes how a role is
*identified*, relaxes name uniqueness, and reworks the Access-tab editing UX.

---

## 1. Background

The role hierarchy shipped 2026-09-07 with roles referenced **by name**
everywhere:

- `user.role` is the role's `name` string (`packages/data-schemas/src/schema/user.ts`).
  It is compared against `SystemRoles.ADMIN` / `SystemRoles.USER` in ~257 call
  sites across ~63 files in `/api` alone, carried in the JWT, and used verbatim
  as the capability-principal id (`getUserPrincipals` →
  `{ principalType: ROLE, principalId: user.role }`).
- `role.parentRole` (`packages/data-schemas/src/schema/role.ts`) is the parent
  role's `name`. The unique index is `roleSchema.index({ name: 1, tenantId: 1 },
  { unique: true })`.
- The resolver (`packages/data-schemas/src/methods/role.ts`) walks `parentRole`
  by name; `getRoleByName` queries `{ name }`; the admin roles routes are
  `/:name`-addressed; `renameRole` migrates every user's `role` string and
  repoints children when a role is renamed.
- The Access tab (`client/src/components/Admin/Access/`) renders the tree as a
  flat, indented list. Every row is a `<button>` that opens `EditRoleDialog`.
  `CreateRoleDialog` has a "Reports to" `<select>`. `EditRoleDialog` has a
  "Reports to" `<select>` wired to `useSetRoleParent`.

Name-as-identity blocks two things the operator wants: **duplicate role names**,
and a stable reference that survives a rename without a bulk user migration.

---

## 2. Goals / Non-goals

### Goals

- A role is referenced by an **immutable key**, not its name. Renaming a role
  touches one document.
- **Duplicate role names are allowed** — with three exceptions: the reserved
  names `ADMIN` / `USER`, **top-level roles** (each branch root's name stays
  unique), and **direct siblings** (two roles under the same immediate parent
  cannot share a name). A name may repeat freely across different parents.
- The Access tab editing model becomes explicit:
  - "Create role" (top of tab) creates a **top-level** role only.
  - Each role row (except `ADMIN` / `USER`) has an **Add child** (`+`) and an
    **Edit** (`✎`) button; `ADMIN` / `USER` rows have **Edit** only.
  - The row itself is no longer clickable.
  - Re-parenting is **drag-and-drop within the same top-level branch**, via a
    dedicated grip handle, with a confirmation step.
- `EditRoleDialog` shows the parent as a read-only `Reports to : <name>` line.
- Where a bare name is ambiguous (two visible roles share it), the UI
  disambiguates by appending the parent name.
- All identity, uniqueness, and branch-isolation rules enforced **server-side**.
- A one-time, idempotent migration converts existing staging data in place.

### Non-goals

- Converting `user.role` to a Mongo `ObjectId` ref, or changing the ~257
  `user.role === SystemRoles.ADMIN` comparisons, the JWT payload, auth
  strategies, or `roleDefaults`. System roles keep the string sentinels
  `"ADMIN"` / `"USER"` as their key (§3.1).
- Moving a role to a **different** top-level branch, or promoting a child to a
  new top-level root / demoting a root. Top-level-ness is fixed at creation.
- Multi-parent roles / DAGs (unchanged from the prior spec).
- A graphical tree-diagram widget — the indented list stays; drag-and-drop is
  layered onto it.
- Any change to the feature-`permissions` matrix, existing capabilities, or the
  conversation viewer.

---

## 3. Data model

### 3.1 `roleKey` — the immutable identifier

`packages/data-schemas/src/schema/role.ts`:

```ts
roleKey: { type: String, required: true, index: true },
```

- **System roles** (`ADMIN`, `USER`): `roleKey === name` (`"ADMIN"` / `"USER"`).
  This is the entire reason `roleKey` exists rather than using `_id` directly —
  it lets every `user.role === SystemRoles.ADMIN` comparison, the JWT, and
  `roleDefaults` keep working untouched, because for system roles the key *is*
  the name.
- **Custom roles**: `roleKey === _id.toString()`, minted once at creation and
  never changed.
- A role reference is **always** exactly `role.roleKey` — `user.role`,
  `role.parentRole`, capability `principalId` for ROLE principals, the client
  tree helper. Nothing downstream branches on "is this a name or an id"; the
  system-vs-custom distinction is collapsed at the single point where `roleKey`
  is assigned.

### 3.2 Index changes

`packages/data-schemas/src/schema/role.ts`:

```ts
// removed:
roleSchema.index({ name: 1, tenantId: 1 }, { unique: true });

// added:
roleSchema.index({ roleKey: 1, tenantId: 1 }, { unique: true });
roleSchema.index({ parentRole: 1, name: 1, tenantId: 1 }, { unique: true });
```

- `{ roleKey, tenantId }` unique — the new identity constraint.
- `{ parentRole, name, tenantId }` unique — one index enforces **both**
  remaining name rules: two top-level roles collide on
  `{ null, name, tenantId }`, and two children of the same parent collide on
  `{ parentKey, name, tenantId }`. Children of *different* parents produce
  different index entries and coexist. (`parentRole` has `default: null`, so
  every top-level role carries an explicit `null`; a missing `tenantId` indexes
  as `null`.)
- The plain `{ name: 1 }` field index (`name: { ..., index: true }`) stays for
  search.

### 3.3 Field semantics

| Field | Before | After |
|---|---|---|
| `role.roleKey` | — | new; immutable identifier (§3.1) |
| `role.name` | unique per tenant | display label; unique among top-level roles, among direct siblings, and vs. `ADMIN`/`USER` |
| `role.parentRole` | parent's `name` | parent's `roleKey` (`null` = top-level) |
| `role.depth` | unchanged | unchanged |
| `user.role` | role `name` | role `roleKey` (still `String`; `"ADMIN"`/`"USER"` unchanged for system users) |
| `systemgrants.principalId` (ROLE) | role `name` | role `roleKey` |
| `configs` / `aclentries` `principalId` (ROLE) | role `name` | role `roleKey` |

### 3.4 `IRole` type

`packages/data-schemas/src/types/role.ts` — add `roleKey: string;`. `parentRole`
/ `depth` unchanged (added in the prior spec).

### 3.5 `packages/data-provider` types

- `TAdminRole` (`src/types/admin.ts`) gains `roleKey: string;`; `parentRole`
  documented as a `roleKey`.
- `TMyHierarchy` fields rename: `viewableRoleNames` → `viewableRoleKeys`,
  `manageableRoleNames` → `manageableRoleKeys`.

---

## 4. Migration — `migrateRoleKeys()`

New method in `packages/data-schemas/src/methods/role.ts`, called from
`initializeRoles()` **after** `ADMIN` / `USER` are ensured. Idempotent: a guard
query `Role.countDocuments({ roleKey: { $exists: false } })` short-circuits when
every role already has a key. A thin CLI wrapper
(`npm run migrate:role-keys -- --dry-run`) prints the planned rewrites without
applying them, for review against the shared staging DB before a real run.

Steps, in order (names are still globally unique at step 1, so the name→key
maps built in step 2 are unambiguous):

1. **Backfill `roleKey`.** For each role missing one:
   `roleKey = isSystemRoleName(name) ? name : _id.toString()`.
2. **Build maps** `keyByName` / `nameByKey` from the now-complete set.
3. **Rewrite `role.parentRole`.** For each role whose `parentRole` is non-null
   and matches a known `name` (not already a key): set it to
   `keyByName[parentRole]`.
4. **Rewrite `user.role`.** For each custom role, one bulk op:
   `User.updateMany({ role: role.name }, { $set: { role: role.roleKey } })`.
   System-role users are not matched and not touched.
5. **Rewrite ROLE principals.** In `systemgrants`, `configs`, `aclentries`:
   `updateMany({ principalType: 'role', principalId: role.name },
   { $set: { principalId: role.roleKey } })` per custom role.
6. **Invalidate caches.** `CacheKeys.ROLES` (all keys), and the auth-user-doc
   cache for every user id touched in step 4.
7. **Log** a one-line summary: N roles keyed, N parent links rewritten, N users
   remapped, N grants/configs/acl entries remapped.

Forward-only. Every step is a bulk rename reversible via `nameByKey` if the
operator needs to back it out on staging.

**Index handling** (bracketing the steps above):

- **Before step 1** — drop the stale `name_1_tenantId_1` unique index
  (`Role.collection.dropIndex('name_1_tenantId_1')`, ignore "index not found").
  Otherwise a `user.role`-independent rename later trips it.
- **After step 3** — now that every `parentRole` holds a key, create
  `{ parentRole, name, tenantId }` unique explicitly rather than relying on
  Mongoose `autoIndex` timing; a half-rewritten `parentRole` set could
  otherwise fail the index build on a transient duplicate. Create
  `{ roleKey, tenantId }` unique here too.

---

## 5. Resolver (`packages/data-schemas/src/methods/role.ts`)

The resolver already reads a fresh graph on every call. Changes:

- `fetchRoleGraph()` projects `roleKey parentRole` (was `name parentRole`).
- Rename for honesty — these now return / compare **keys**:
  `getAncestorRoleNames` → `getAncestorRoleKeys`,
  `getDescendantRoleNames` → `getDescendantRoleKeys`,
  `isDescendantOf(childKey, ancestorKey)`,
  `canViewRole(actorKey, targetKey)`,
  `wouldCreateCycle(roleKey, newParentKey)`,
  plus the ~8 call sites in `packages/api` (hierarchy middleware, admin
  handlers) and `req.hierarchyScope.viewableRoleNames` → `viewableRoleKeys`.
- `canViewRole` — `if (actorKey === SystemRoles.ADMIN) return true;` still
  correct (ADMIN's key is `"ADMIN"`).
- `getRoleByName(x)` — query changes from `{ name: x }` to `{ roleKey: x }`;
  the exported name is kept (all 81 callers pass `user.role` or a system
  literal, both keys). The `CacheKeys.ROLES` cache key becomes the roleKey.
  Audit note for the plan: confirm no caller passes a raw custom-role *name*
  (candidates: `findRolesByNames`, the legacy `/api/roles/:roleName`
  permissions route — which only ever touches `ADMIN`/`USER`, where key===name).
- `createRoleByName(roleData)`:
  - mint `roleKey` = `_id.toString()` of the new doc;
  - **drop** the global name-uniqueness pre-check;
  - reject if a role with the same `name` **and** the same `parentRole`
    (`null` included → another top-level role) already exists
    (`RoleConflictError`); the `{ parentRole, name, tenantId }` unique index is
    the backstop (11000 → `RoleConflictError`).
  - when `parentRole` is set: validate the parent key exists and is not a
    system role; `depth = parent.depth + 1`.
- `setRoleParent(roleKey, newParentKey)` — operates on keys; **new
  branch-isolation guard**: compute the top-level root of `roleKey`'s current
  position and of `newParentKey`; if they differ, throw
  `RoleConflictError('cannot move a role to a different branch')`. Keep the
  cycle guard. Also reject if `newParentKey` already has a different child
  whose `name` equals the moved role's `name` (`RoleConflictError`).
  `newParentKey === null` is rejected by the branch-isolation guard for any
  non-top-level role (null has no root) and is a no-op for a top-level role.
- `updateRoleByName` rename path collapses to `Role.findOneAndUpdate({ roleKey },
  { $set: { name } })` — **remove** `repointChildRoles` (children hold the key)
  and the user-migration coupling. Pre-check: reject the rename if a sibling
  under the same `parentRole` already has the target name
  (`RoleConflictError`); the unique index is the backstop.
- `deleteRoleByName` → keyed by roleKey: `User.updateMany({ role: roleKey },
  { $set: { role: SystemRoles.USER } })`, child check `{ parentRole: roleKey }`,
  cascade cleanup `principalId: roleKey`.
- `countChildRoles(roleKey)`, `findUserIdsByRole(roleKey)`,
  `updateUsersByRole` / `updateUsersRoleByIds` (newRole = a key),
  `listUsersByRole` / `countUsersByRole` — all keyed by roleKey.
- `listRoles` projection adds `roleKey`.

---

## 6. Backend admin API

### 6.1 `packages/api/src/admin/roles.ts` + `api/server/routes/admin/roles.js`

- Route param `:name` → `:roleKey`. Validation: a system name (`ADMIN`/`USER`,
  case-insensitive) **or** a 24-hex string.
- All handlers key by `roleKey`.
- **`createRole`** — `parentRole` in the body is a `roleKey` or `null`:
  - `null` → top-level; a key → validated to exist and be non-system (400).
  - the handler pre-checks a name collision among the target parent's existing
    children (or among top-level roles when `parentRole` is `null`) → 409.
  - still auto-grants `VIEW_SUBORDINATES` with `principalId: role.roleKey`.
- **`updateRole`** — the re-parent branch (`body.parentRole !== undefined`)
  calls `setRoleParent(roleKey, newParentKey)`; `RoleConflictError` (cycle,
  cross-branch, or a name clash with an existing child of the new parent)
  → 400. The rename path is a plain `name` set guarded by a sibling-collision
  pre-check (→ 409); **remove** `renameRole`, `rollbackMigratedUsers`, and the
  old global duplicate-name guard.
- **`deleteRole`** — child-count 409 guard and cascade cleanup, all keyed by
  `roleKey`; audit `target.id` = roleKey.
- `RESERVED_ROLE_NAMES` (`members`, `permissions`) can be dropped — a `roleKey`
  route segment is never those strings.

### 6.2 `PATCH /api/admin/users/:userId/role`

- Body `{ role }` is a `roleKey`. `getRoleByName(roleKey)` existence check
  (400), `canViewRole(actorKey, targetKey)` (403), last-admin guard, then
  `updateUsersRoleByIds([userId], roleKey)`.

### 6.3 `GET /api/admin/hierarchy/me`

- Response fields rename to `viewableRoleKeys` / `manageableRoleKeys`.
- `attachHierarchyScope` sets `req.hierarchyScope.viewableRoleKeys`; the Users
  list/search filter stays `{ role: { $in: <keys> } }` (already correct once
  `user.role` holds keys).

### 6.4 `packages/data-provider`

- `api-endpoints.ts`: `adminRole(roleKey)` — param rename only.
- `data-service.ts`:
  - `createAdminRole({ name, description?, parentRole? })` — `parentRole` is a
    `roleKey | null`.
  - `setAdminRoleParent(roleKey, parentKey)` — PATCH `adminRole(roleKey)` with
    `{ parentRole: parentKey }`.
  - `setAdminUserRole(userId, roleKey)` — PATCH `adminUserRole(userId)` with
    `{ role: roleKey }`.
- Query/mutation keys unchanged.

---

## 7. Frontend

### 7.1 `CreateRoleDialog` (item 1)

- Remove the "Reports to" `<select>` and all parent state.
- New optional prop `parent?: TAdminRole`:
  - **absent** → title "Create role"; submits `parentRole: null` (top-level).
    Surfaces the 409 "a top-level role named X already exists".
  - **present** → title "Add role under **{parent.name}**"; a read-only
    `Parent: {parent.name}` line; submits `parentRole: parent.roleKey`.
    Surfaces the 409 "a role named X already exists under {parent}".

### 7.2 `RoleRow` action buttons (item 2)

- The row is a plain styled `<div>`, **not** a `<button>` — not clickable.
- Right-aligned icon cluster, each an icon `<button>` with `title` +
  `aria-label` (new locale keys `com_admin_role_action_move` / `_add` / `_edit`):

  | Role | Buttons |
  |---|---|
  | custom, non-top-level | `GripVertical` (move) · `Plus` (add child) · `Pencil` (edit) |
  | custom, top-level | `Plus` · `Pencil` |
  | `ADMIN` / `USER` | `Pencil` only |

- The decorative `ChevronRight` is removed.
- `Plus` opens `CreateRoleDialog` with `parent={role}`. `Pencil` opens
  `EditRoleDialog` for `role`.

### 7.3 Drag-and-drop re-parenting (item 2)

- `AccessView`'s tree wrapped in a `DndProvider` with the HTML5 backend,
  following the existing `client/src/components/Nav/Favorites/FavoritesList.tsx`
  pattern (`useDrag` / `useDrop`).
- **Drag source = the grip handle only** (`drag(handleRef)`), never the whole
  row. Only custom, non-top-level rows have a handle. Payload:
  `{ roleKey, rootKey }` (rootKey = the branch's top-level roleKey, computed
  client-side from the ordered tree).
- **While dragging**, the source row is highlighted (`ring-2 ring-ring-primary
  bg-surface-active`), not hidden.
- **`canDrop`** for a target row is true iff **all** of:
  - `item.rootKey === targetRootKey` (same top-level branch),
  - the target is not the dragged role itself,
  - the target is not a descendant of the dragged role (no cycle),
  - the target is not the dragged role's current parent (no-op),
  - the target has no existing child whose name equals the dragged role's name
    (sibling uniqueness).
- **Crossing the branch boundary**: while a drag is active and the pointer is
  over a row in a different branch, an inline notice renders near the tree —
  *"Can't move outside the {rootName} branch"* (new key
  `com_admin_role_move_out_of_branch`) — cleared when the pointer returns to a
  valid target or the drag ends. Drop does nothing there.
- **Name clash**: when the hovered target is a valid branch position but
  already has a child with the dragged role's name, the notice reads
  *"A role named {name} already exists under {target}"*
  (`com_admin_role_move_name_clash`); drop does nothing. The server rejects it
  too (`setRoleParent` → 400) as a backstop.
- **On a valid drop**: a confirmation dialog —
  *"Move **{role}** under **{newParent}**? Its {n} sub-role(s) move with it."*
  (`com_admin_role_move_confirm`). Confirm → `useSetRoleParent({ roleKey,
  parentRole: newParentKey })`; Cancel → nothing.
- **Keyboard fallback**: the grip is a real `<button>`; activating it opens the
  same "Move {role}…" dialog with a parent `<select>` limited to same-branch
  roles (excluding self + descendants). Drag is not the only path.
- The moved role's subtree follows it; the server recomputes `depth` for the
  whole subtree (`setRoleParent`, unchanged).

### 7.4 `EditRoleDialog` (item 5)

- Remove the "Reports to" `<select>`, its state, `useSetRoleParent`,
  `parentChoices`, and the `parentChanged` branch of `saveDetails`.
- Replace with a static line: `Reports to : {parentName}` — plain parent
  **name**, no disambiguation (the operator has the whole tree in view before
  opening Edit). "Top-level branch" when `parentRole == null`; the line is
  omitted entirely for system roles.
- `saveDetails` now sends only name / description — a single request, no
  sequential re-parent.
- Rename no longer 409s on a duplicate child name (item 3).

### 7.5 Disambiguation helper

New `client/src/components/Admin/Access/roleLabels.ts`:

```ts
buildRoleLabels(roles: TAdminRole[]): Map<string /* roleKey */, string>
```

- default label = `role.name`;
- for any `name` shared by ≥2 roles in the input, those roles get
  `` `${name} — ${parentName}` ``, walking further up the ancestor chain until
  the labels differ. This always terminates: sibling uniqueness (§8) means two
  same-named roles have different parents, and if those parents also share a
  name they sit under different grandparents, so some ancestor level is
  distinct.

Consumers:

- `AccessView` rows (`RoleRow` gets a `label` prop).
- `UserRow`'s role cell (display) and the reassignment `<select>` options —
  `value` / `onChange` use `roleKey`.
- `orderRolesByTree` (`roleTree.ts`) switches from name-matching to
  **key-matching**: `parentRole` compared against the set of `roleKey`s;
  `present.has(role.parentRole)` etc.

### 7.6 Client type / query wiring

- `useMyHierarchy` consumers read `viewableRoleKeys` / `manageableRoleKeys`.
- `UsersView` passes `manageableRoleKeys` (undefined for ADMIN → all) to
  `UserRow`.
- `useSetRoleParent` mutation payload: `{ roleKey, parentRole }`.

---

## 8. Name uniqueness rules (summary)

| Creating / renaming / re-parenting | Allowed? |
|---|---|
| a role named `ADMIN` / `USER` (any case) | **No** — reserved (existing `isSystemRoleName`) |
| a top-level role whose name matches another top-level role | **No** — 409 |
| a child whose name matches a **sibling** (same immediate parent) | **No** — 409 |
| a child whose name matches a non-sibling (different parent, any branch) | **Yes** |
| renaming a role onto one of its siblings' names | **No** — 409 |
| dragging a role under a parent that already has a same-named child | **No** — blocked in `canDrop`, 400 backstop |

One `{ parentRole, name, tenantId }` unique index enforces the top-level and
sibling rules together (top-level roles all share `parentRole: null`). Handler
pre-checks produce the friendly 409/400 message; the index is the backstop.
Top-level-ness is fixed at creation (§2 non-goals), so the top-level check runs
only in `createRole` and the top-level rename path.

---

## 9. Testing

### 9.1 `packages/data-schemas`

- `roleKey` backfill: system → name, custom → `_id`.
- Migration: `parentRole` name→key; `user.role` name→key (system users
  untouched); `systemgrants` / `configs` / `aclentries` principal remap;
  idempotent second run is a no-op.
- Resolver walks on keys; `canViewRole('ADMIN', anyKey) === true`.
- `setRoleParent` branch-isolation: same-branch move OK; cross-branch → throws;
  cycle → throws.
- `createRoleByName`: duplicate child name under a **different** parent
  succeeds; duplicate **sibling** name throws; duplicate **top-level** name
  throws; reserved name throws.
- `setRoleParent`: moving a role under a parent that already has a same-named
  child throws.
- Rename: one document changes; no user or child writes; renaming onto a
  sibling's name throws.

### 9.2 `packages/api`

- Admin roles handlers keyed by roleKey: get / update / delete / permissions /
  members.
- `createRole`: `parentRole: null` → top-level; `parentRole: <key>` → child;
  top-level name collision → 409; sibling name collision → 409; same name under
  a different parent → 201.
- `updateRole` re-parent: same-branch → 200; cross-branch → 400; cycle → 400;
  name clash with an existing child of the new parent → 400.
- Reassignment `PATCH /:userId/role` by key: in-subtree → 200; cross-branch →
  403; unknown key → 400.
- `/hierarchy/me` returns `viewableRoleKeys` / `manageableRoleKeys`.

### 9.3 `api` integration (`admin.hierarchy.spec.js`)

- Update `seedTree` assertions to keys.
- Add: a `SALES_MANAGER` dragging (PATCH) a role under a `SUPPORT_*` parent →
  400 cross-branch.
- Regression: existing 9 hierarchy cases still green.

### 9.4 `client`

- `CreateRoleDialog`: no parent `<select>`; "add under" mode shows the parent
  line and submits the key.
- `RoleRow`: correct button set per role type; tooltips present; row not a
  button.
- `EditRoleDialog`: static `Reports to` line; no re-parent request on save.
- DnD: same-branch drop opens confirm and calls `useSetRoleParent`;
  cross-branch target shows the branch notice and is not droppable; a target
  that already has a same-named child shows the clash notice and is not
  droppable; keyboard fallback opens the move dialog.
- `buildRoleLabels`: disambiguates only shared names; `orderRolesByTree`
  key-matches.

### 9.5 Typecheck / lint

`npx tsc --noEmit` in `data-schemas`, `api`, `data-provider`, `client`;
`npm run static-checks`.

---

## 10. Rollout

1. Merge to local `main`, push to `origin/staging` for collaborator review
   (same workflow as the prior spec — never `origin/main`).
2. On the staging server, run `npm run migrate:role-keys -- --dry-run`, review
   the printed plan, then restart the backend (migration runs automatically in
   `initializeRoles`).
3. Smoke: create a top-level role, add two children with the **same name**,
   drag one child under the other, confirm; check the Users tab still scopes
   for a non-admin hierarchy role; check ADMIN still sees everything.

---

## 11. File-change inventory

### `packages/data-schemas`

- `src/schema/role.ts` — `roleKey` field; index swap (§3.2).
- `src/types/role.ts` — `roleKey: string`.
- `src/methods/role.ts` — `migrateRoleKeys`; resolver → keys; rename/`getRoleByName`/
  `createRoleByName`/`setRoleParent`/`deleteRoleByName`/`listRoles` changes.
- `src/methods/*.spec.ts` — migration + resolver + uniqueness tests.
- CLI wrapper for `migrate:role-keys --dry-run` (+ `package.json` script).

### `packages/api`

- `src/admin/roles.ts` — key addressing; `createRole` parent/collision;
  `updateRole` rename simplification + re-parent branch; `deleteRole` cascade
  by key.
- `src/admin/users.ts` — reassignment by key.
- `src/admin/hierarchy.ts` — `viewableRoleKeys` / `manageableRoleKeys`.
- `src/middleware/hierarchy.ts` — `req.hierarchyScope.viewableRoleKeys`;
  `canViewRole` / `getDescendantRoleKeys` call sites.
- `src/types/http.ts` — `hierarchyScope` field rename.
- `src/**/*.spec.ts` — handler + middleware tests.

### `api/server`

- `routes/admin/roles.js` — `:roleKey` param, dep names.
- `routes/admin/users.js` — dep names.
- `routes/__tests__/admin.hierarchy.spec.js` — key assertions + cross-branch case.

### `packages/data-provider`

- `src/types/admin.ts` — `TAdminRole.roleKey`; `TMyHierarchy` field renames.
- `src/api-endpoints.ts` — `adminRole(roleKey)`.
- `src/data-service.ts` — `createAdminRole` / `setAdminRoleParent` /
  `setAdminUserRole` signatures.
- `src/*.spec.ts`.

### `client/src`

- `components/Admin/Access/CreateRoleDialog.tsx` — remove parent select; `parent` prop.
- `components/Admin/Access/RoleRow.tsx` — action buttons; non-clickable row.
- `components/Admin/Access/AccessView.tsx` — `DndProvider`; drag/drop; branch
  notice; move-confirm dialog; label map.
- `components/Admin/Access/EditRoleDialog.tsx` — static `Reports to` line;
  remove re-parent.
- `components/Admin/Access/roleTree.ts` — key-matching.
- `components/Admin/Access/roleLabels.ts` — **new**, `buildRoleLabels`.
- `components/Admin/Access/MoveRoleDialog.tsx` — **new** (confirm + keyboard
  fallback).
- `components/Admin/Users/UserRow.tsx`, `UsersView.tsx` — label map; key-based
  reassignment; `manageableRoleKeys`.
- `data-provider/Admin/queries.ts`, `mutations.ts` — field renames;
  `useSetRoleParent` payload.
- `components/Admin/**/__tests__/*` — per §9.4.
- `locales/en/translation.json` — `com_admin_role_action_move` / `_add` /
  `_edit`, `com_admin_role_move_out_of_branch`, `com_admin_role_move_name_clash`,
  `com_admin_role_move_confirm`, `com_admin_role_add_under`.

---

## 12. Open risks

- **`getRoleByName` audit** — the plan's first task must grep all 81 callers and
  confirm none passes a raw custom-role name. If one does, it needs an explicit
  key lookup or a `getRoleByKey` split.
- **Compound unique index with `null` segments** — `{ parentRole, name,
  tenantId }` must treat two top-level roles (both `parentRole: null`, and
  possibly both `tenantId` missing) as a collision. This is standard MongoDB
  behaviour (`null` and missing both index as `null`), but confirm it on the
  deployed version and lock it with a migration test.
- **Migration ordering under load** — `initializeRoles` runs at boot before the
  server accepts traffic, so the multi-step migration is not racing request
  writes. The CLI dry-run is the review gate before it touches staging.
- **HTML5 drag on touch** — mirror `FavoritesList`'s `useMediaQuery('(hover:
  hover)')` guard so the grip doesn't stamp `draggable` on touch devices; the
  keyboard/dialog fallback covers those.
