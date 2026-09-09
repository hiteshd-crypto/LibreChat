# Role Identity Keys + Access Tree Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reference every role by an immutable `roleKey` (system roles keep the `ADMIN`/`USER` sentinels, custom roles are keyed by `_id`), allow duplicate role names except for `ADMIN`/`USER`, top-level roles, and direct siblings, and rework the Access tab into an explicit tree editor: per-row Add/Edit buttons, a non-clickable row, branch-isolated drag-and-drop re-parenting, and a read-only "Reports to" label.

**Architecture:** A Mongoose `pre('validate')` hook mints `roleKey` on every role document; a one-time idempotent `migrateRoleKeys()` inside `initializeRoles()` rewrites existing `role.parentRole`, `user.role`, and ROLE-principal ids from names to keys and swaps the unique indexes. The hierarchy resolver in `packages/data-schemas/src/methods/role.ts` stays the single owner of tree logic — it now walks `roleKey` instead of `name`. The admin roles API becomes `:roleKey`-addressed, which collapses "rename" to a one-document write. The frontend Access tab renders the same indented list but with icon-button actions and `react-dnd` (HTML5 backend, provider already mounted in `App.jsx`) for same-branch re-parenting.

**Tech Stack:** React 19 + react-router-dom, `@tanstack/react-query` v4 array-key style, `@librechat/client` UI primitives, `react-dnd` + `react-dnd-html5-backend` (already deps; pattern: `client/src/components/Nav/Favorites/FavoritesList.tsx`), Tailwind semantic tokens, `lucide-react` icons, Express 5 (`api/`), TypeScript backend logic (`packages/api`), Mongoose models (`packages/data-schemas`), shared types/endpoints (`packages/data-provider`). Jest + `mongodb-memory-server` for `packages/data-schemas` unit tests (this dev machine cannot boot `mongodb-memory-server` per project memory — if it fails locally, note it and move on; CI runs it. Do not rewrite tests around it), `connectTestDb` + supertest for `api/` route integration tests (Atlas `MONGO_URI_TEST`, intermittently reachable), Jest + `test/layout-test-utils` for client tests.

**Spec:** `docs/superpowers/specs/2026-09-09-role-identity-and-access-tree-design.md`

## Global Constraints

- **New backend logic is TypeScript in `packages/api`** or `packages/data-schemas` (DB-model logic); `api/` changes are thin wiring only (LibreChat CLAUDE.md).
- **Never use `any`**; avoid `unknown` / `Record<string, unknown>` where an explicit type exists. Reuse `IRole`, `IUser`, `TAdminRole`, `TMyHierarchy`, `SystemCapability`, `CapabilityUser` — do not redefine.
- **A role reference is always exactly `role.roleKey`.** System roles: `roleKey === "ADMIN"` / `"USER"` (uppercased name). Custom roles: `roleKey === _id.toString()`. `user.role`, `role.parentRole`, ROLE-principal `principalId`, and the client tree helper all hold a `roleKey`. Nothing outside the `pre('validate')` hook and the `isSystemRoleName` policy guards branches on "name vs id".
- **The resolver is the single source of truth for tree logic.** No call site outside `packages/data-schemas/src/methods/role.ts` re-implements a parent walk, cycle check, descendant computation, or root-of-branch computation.
- **`ADMIN` and `USER` never enter the tree.** Both keep `parentRole: null`; both are rejected wherever a parent, re-parent target, or rename target is validated (`isSystemRoleName`, already in `role.ts` and `packages/api/src/admin/roles.ts`).
- **Name uniqueness (spec §8):** duplicate names are allowed **only** across different parents. Rejected: a name equal to `ADMIN`/`USER` (any case); a top-level name equal to another top-level role's; a child name equal to a direct sibling's. One `{ parentRole, name, tenantId }` unique index is the backstop; handler/method pre-checks give the friendly 409/400.
- **Top-level-ness is fixed at creation.** No promote/demote, no cross-branch move. `setRoleParent` rejects any move whose new parent's top-level root differs from the role's current root.
- **`depth` is a display / pre-check value only, never an authorization input.** Every access decision goes through `canViewRole`, which walks `parentRole` directly.
- **Authorization is server-side.** The reassignment endpoint's `{ role }` body is a `roleKey` validated against `canViewRole` before any write — never trusted as the caller's identity.
- **All user-facing client strings** go through `useLocalize()`; add keys only to `client/src/locales/en/translation.json`, prefix `com_admin_`.
- **Tailwind: semantic tokens only** — no raw palette utilities, no hex, no `dark:` literals in feature components.
- **Do not modify** `/api/convos/*`, `/api/messages/*`, the external `librechat-admin-panel` repo, the JWT payload, auth strategies, `roleDefaults`, the ~257 `user.role === SystemRoles.ADMIN` comparisons, or the role feature-permission matrix.
- After editing `packages/data-provider`, run `npm run build:data-provider` before client typecheck. After editing `packages/data-schemas`, run `npm run build:data-schemas`; after `packages/api`, `npm run build:api` — before any `api/` route test or `npm run backend`.
- Run `npx tsc --noEmit` in every workspace you touched; `npm run sort-imports -- <files>` and `npm run lint` on touched files.
- React Query here is v4: `useQuery([key, ...parts], fn, optionsObject)` — match `client/src/data-provider/Admin/queries.ts`.
- Commit after every task with a `feat:` / `test:` / `refactor:` message. Work on branch `feat/role-identity-keys` (already created; the spec is committed there). Never `main`.

---

## File Structure

**New files:**

| File | Responsibility |
|---|---|
| `packages/data-schemas/src/methods/role.migration.spec.ts` | Unit tests for `migrateRoleKeys` (backfill, parentRole/user.role/principal rewrite, idempotency, index sync) |
| `scripts/migrate-role-keys.mts` | `--dry-run` CLI wrapper that prints the planned rewrites without applying them |
| `client/src/components/Admin/Access/roleLabels.ts` | `buildRoleLabels` — disambiguated display label per `roleKey` |
| `client/src/components/Admin/Access/roleLabels.test.ts` | Unit tests for `buildRoleLabels` |
| `client/src/components/Admin/Access/MoveRoleDialog.tsx` | Drop-confirmation dialog + keyboard-fallback parent picker |
| `client/src/components/Admin/Access/__tests__/MoveRoleDialog.test.tsx` | Tests for the above |
| `client/src/components/Admin/Access/__tests__/AccessTreeDnd.test.tsx` | Drag-and-drop behaviour tests for `AccessView` |

**Modified files:**

| File | Change |
|---|---|
| `packages/data-schemas/src/schema/role.ts` | `roleKey` field; `pre('validate')` hook; index swap (`{roleKey,tenantId}` + `{parentRole,name,tenantId}` unique, drop `{name,tenantId}` unique) |
| `packages/data-schemas/src/types/role.ts` | `IRole.roleKey: string` |
| `packages/data-schemas/src/methods/role.ts` | `getRoleByName`→key query; `findRolesByNames` audit; `migrateRoleKeys`; resolver renames (`getAncestorRoleKeys`, `getDescendantRoleKeys`) + `fetchRoleGraph` projects `roleKey`; `createRoleByName` sibling/top-level checks + parent-by-key; `setRoleParent` branch-isolation + sibling guard; `updateRoleByName` rename simplification + sibling check; `deleteRoleByName`/`countChildRoles`/`listRoles` by key; `initializeRoles` calls `migrateRoleKeys` |
| `packages/data-schemas/src/methods/role.methods.spec.ts` | Update seed/assertions for `roleKey`; sibling/top-level uniqueness tests |
| `packages/data-schemas/src/methods/role.hierarchy.spec.ts` | Seed by `roleKey`; assert keys; branch-isolation + sibling `setRoleParent` cases |
| `packages/data-schemas/src/methods/role.cache.spec.ts` | Cache key is now `roleKey` — update expectations |
| `packages/api/src/types/http.ts` | `hierarchyScope.viewableRoleNames` → `viewableRoleKeys` |
| `packages/api/src/middleware/hierarchy.ts` | `HierarchyDeps.getDescendantRoleNames` → `getDescendantRoleKeys`; scope field rename; param docs |
| `packages/api/src/middleware/hierarchy.spec.ts` | Field/dep renames |
| `packages/api/src/admin/hierarchy.ts` | Response `viewableRoleKeys` / `manageableRoleKeys`; dep `getDescendantRoleKeys` |
| `packages/api/src/admin/hierarchy.spec.ts` | Field/dep renames |
| `packages/api/src/admin/roles.ts` | `:roleKey` param + validation; `createRole` parent-by-key + sibling/top-level 409; `updateRole` rename (sibling 409) + re-parent (branch/cycle/sibling 400); `deleteRole` cascade by key; drop `renameRole`/`rollbackMigratedUsers`/global dup guard/`RESERVED_ROLE_NAMES` |
| `packages/api/src/admin/roles.spec.ts` | Rewrite around `roleKey`; new uniqueness + re-parent cases |
| `packages/api/src/admin/users.ts` | `withHierarchyScope` uses `viewableRoleKeys`; `reassignUserRole` unchanged logic (body already a key) — doc comment update |
| `packages/api/src/admin/users.spec.ts` | Scope field rename; reassign-by-key assertions |
| `api/server/routes/admin/roles.js` | Route `:name` → `:roleKey`; dep list unchanged (method names kept) |
| `api/server/routes/admin/users.js` | Dep `getDescendantRoleNames` → `getDescendantRoleKeys` |
| `api/server/routes/__tests__/admin.hierarchy.spec.js` | Seed/assert `roleKey`; cross-branch + name-clash re-parent cases |
| `packages/data-provider/src/types/admin.ts` | `TAdminRole.roleKey`; `TMyHierarchy` field renames |
| `packages/data-provider/src/api-endpoints.ts` | `adminRole(roleKey)` (param rename) |
| `packages/data-provider/src/data-service.ts` | `createAdminRole` parentRole doc; `updateAdminRole`/`setAdminRoleParent`/`deleteAdminRole`/`listAdminRoleMembers`/`addAdminRoleMember`/`removeAdminRoleMember` param `name` → `roleKey` |
| `packages/data-provider/src/api-endpoints.admin.spec.ts` | Param rename assertions |
| `client/src/data-provider/Admin/mutations.ts` | `useCreateRole` body `parentRole` is a key; `useUpdateRole`/`useDeleteRole`/`useSetRoleParent`/`useAddRoleMember`/`useRemoveRoleMember` payload `name`/`roleName` → `roleKey` |
| `client/src/data-provider/Admin/queries.ts` | `useAdminRoleMembers(roleKey, ...)` |
| `client/src/data-provider/Admin/__tests__/mutations.test.ts` | Payload renames |
| `client/src/components/Admin/Access/constants.ts` | unchanged (still `SYSTEM_ROLES` by name) — used only for the "is this ADMIN/USER" display check |
| `client/src/components/Admin/Access/roleTree.ts` | Match `parentRole` against `roleKey`; keep `OrderedRole` shape |
| `client/src/components/Admin/Access/__tests__/roleTree.test.ts` | Fixtures gain `roleKey`; key-matching |
| `client/src/components/Admin/Access/AccessView.tsx` | `buildRoleLabels`; drag/drop wiring; branch + name-clash notice; `MoveRoleDialog`; pass `label` + drag props to `RoleRow` |
| `client/src/components/Admin/Access/RoleRow.tsx` | Non-clickable row; `GripVertical`/`Plus`/`Pencil` icon buttons with tooltips per role type; drag-handle ref |
| `client/src/components/Admin/Access/__tests__/AccessView.test.tsx` | Button-visibility + create-flow updates |
| `client/src/components/Admin/Access/CreateRoleDialog.tsx` | Remove parent `<select>`; optional `parent` prop; top-level vs "add under" |
| `client/src/components/Admin/Access/__tests__/CreateRoleDialog.test.tsx` | No parent select; add-under mode |
| `client/src/components/Admin/Access/EditRoleDialog.tsx` | Static `Reports to : <name>` line; remove `useSetRoleParent`/parent state; `RoleMembersPanel` keyed by `roleKey` |
| `client/src/components/Admin/Access/__tests__/EditRoleDialog.test.tsx` | Static label; no re-parent request on save |
| `client/src/components/Admin/Access/RoleMembersPanel.tsx` | Prop `roleName` → `roleKey` |
| `client/src/components/Admin/Users/UserRow.tsx` | `manageableRoleNames` → `manageableRoleKeys`; render via `roleLabelMap`; `<select>` values are keys |
| `client/src/components/Admin/Users/UsersView.tsx` | `manageableRoleKeys` from hierarchy; build `roleLabelMap` from `useAdminRoles` |
| `client/src/components/Admin/Users/__tests__/UsersScreens.test.tsx` | Field renames; label rendering |
| `client/src/locales/en/translation.json` | New `com_admin_*` keys (see Task 16) |

---

## Task 1: `roleKey` field, validate hook, and index swap

**Files:**
- Modify: `packages/data-schemas/src/schema/role.ts`
- Modify: `packages/data-schemas/src/types/role.ts:85` (after `tenantId?: string;`)
- Test: `packages/data-schemas/src/methods/role.methods.spec.ts`

**Interfaces:**
- Produces: `IRole.roleKey: string` (required on the type). Every `new Role({...})` / `Role.create(...)` path now gets `roleKey` auto-filled by a `pre('validate')` hook: `isSystemRoleName(name) ? name.toUpperCase() : String(this._id)`.
- Produces (indexes): `{ roleKey: 1, tenantId: 1 }` unique, `{ parentRole: 1, name: 1, tenantId: 1 }` unique. The old `{ name: 1, tenantId: 1 }` unique is removed from the schema (dropped from live DBs in Task 3).

- [ ] **Step 1: Write the failing test**

Add to `packages/data-schemas/src/methods/role.methods.spec.ts` near the `createRoleByName` tests:

```ts
describe('roleKey', () => {
  it('mints roleKey = name for a system role and = _id for a custom role', async () => {
    await initializeRoles();
    const admin = await Role.findOne({ name: SystemRoles.ADMIN }).lean();
    expect(admin?.roleKey).toBe(SystemRoles.ADMIN);

    const custom = await createRoleByName({ name: 'ROLEKEY_CUSTOM' });
    const stored = await Role.findOne({ name: 'ROLEKEY_CUSTOM' }).lean();
    expect(stored?.roleKey).toBe(String(stored?._id));
    expect(custom.roleKey).toBe(String(custom._id));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/data-schemas && npx jest src/methods/role.methods.spec.ts -t "mints roleKey"`
Expected: FAIL — `roleKey` is `undefined` (no schema path).
(If `mongodb-memory-server` will not boot on this machine, note it and move to Step 3 — CI covers execution.)

- [ ] **Step 3: Add the field, hook, and indexes**

In `packages/data-schemas/src/types/role.ts`, inside `IRole` after `tenantId?: string;`:

```ts
  /** Immutable role identifier. System roles: the uppercased name ("ADMIN"/"USER"). Custom roles: the doc `_id` as a string. Every role reference (`user.role`, `parentRole`, ROLE principals) holds this. */
  roleKey: string;
```

In `packages/data-schemas/src/schema/role.ts`, change the top import and add the field + hook + indexes:

```ts
import { Schema } from 'mongoose';
import { PermissionTypes, Permissions, SystemRoles } from 'librechat-data-provider';
import type { IRole } from '~/types';

const SYSTEM_ROLE_NAMES = new Set<string>(Object.values(SystemRoles));
```

In the `roleSchema` definition, add after `name`:

```ts
  roleKey: { type: String, required: true, index: true },
```

Replace the existing `roleSchema.index({ name: 1, tenantId: 1 }, { unique: true });` line with:

```ts
roleSchema.pre('validate', function (next) {
  if (!this.roleKey) {
    const upper = (this.name ?? '').toUpperCase();
    this.roleKey = SYSTEM_ROLE_NAMES.has(upper) ? upper : String(this._id);
  }
  next();
});

roleSchema.index({ roleKey: 1, tenantId: 1 }, { unique: true });
roleSchema.index({ parentRole: 1, name: 1, tenantId: 1 }, { unique: true });
```

Leave the `name: { type: String, required: true, index: true }` field-level index in place (non-unique search index).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/data-schemas && npx jest src/methods/role.methods.spec.ts -t "mints roleKey"`
Expected: PASS (or "cannot boot mongo" note).

- [ ] **Step 5: Typecheck + build**

Run: `cd packages/data-schemas && npx tsc --noEmit && cd ../.. && npm run build:data-schemas`
Expected: no errors. (`IRole.roleKey` is required; any in-repo `new Role({...})` literal that omits it still compiles because Mongoose's `Model<IRole>` create signature accepts partials — the hook fills it. If `tsc` flags a direct `IRole` object literal missing `roleKey`, add `roleKey: ''` there; the hook overwrites it.)

- [ ] **Step 6: Commit**

```bash
git add packages/data-schemas/src/schema/role.ts packages/data-schemas/src/types/role.ts packages/data-schemas/src/methods/role.methods.spec.ts
git commit -m "feat(role): add immutable roleKey field, validate hook, and index swap"
```

---

## Task 2: `getRoleByName` and `findRolesByNames` — resolve by key

**Files:**
- Modify: `packages/data-schemas/src/methods/role.ts` (`getRoleByName` ~line 174, `findRolesByNames` ~line 219)
- Test: `packages/data-schemas/src/methods/role.methods.spec.ts`

**Interfaces:**
- `getRoleByName(ref, fields?)` — query changes from `{ name: ref }` to `{ roleKey: ref }`. Name kept (81 callers pass `user.role` or a system literal, both keys). Cache key `scopedCacheKey(ref)` is now a `roleKey`. The system-role auto-create path still keys `roleDefaults` by name (`roleDefaults[ref]` where `ref` is `"ADMIN"`/`"USER"` — key === name for system roles, so unchanged).
- `findRolesByNames(names, fields?)` — **audit result:** its callers pass config-declared role names and `user.role`. Change the match to `roleKey` OR `name` (case-insensitive) so a config that still lists role *names* keeps working while `user.role` (a key) also resolves: `{ $or: [{ roleKey: { $in: refs } }, { name: <case-insensitive regexes> }] }`.

- [ ] **Step 1: Write the failing tests**

Add to `role.methods.spec.ts`:

```ts
it('getRoleByName resolves a custom role by its roleKey, not its name', async () => {
  const created = await createRoleByName({ name: 'RESOLVE_BY_KEY' });
  const byKey = await getRoleByName(created.roleKey);
  expect(byKey?.name).toBe('RESOLVE_BY_KEY');
  const byName = await getRoleByName('RESOLVE_BY_KEY');
  expect(byName).toBeNull();
});

it('getRoleByName still resolves ADMIN/USER by their sentinel key', async () => {
  await initializeRoles();
  expect((await getRoleByName(SystemRoles.ADMIN))?.name).toBe(SystemRoles.ADMIN);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/data-schemas && npx jest src/methods/role.methods.spec.ts -t "resolves a custom role by its roleKey"`
Expected: FAIL — currently resolves by name.

- [ ] **Step 3: Implement**

In `getRoleByName`, change `let query = Role.findOne({ name: roleName });` to `let query = Role.findOne({ roleKey: roleName });`. Rename the parameter `roleName` → `roleRef` throughout the function body and update the doc comment to: *"Retrieve a role by its `roleKey` (system-role sentinels `ADMIN`/`USER`, or a custom role's `_id`). Creates the system role on demand when missing."* Keep the `systemRoleValues.has(roleRef)` branch (a `roleRef` of `"ADMIN"` still matches).

In `findRolesByNames`, replace the `nameFilter` construction with:

```ts
      const nameFilter = {
        $or: [
          { roleKey: { $in: uniqueRoleNames } },
          ...uniqueRoleNames.map((roleName) => ({
            name: new RegExp(`^${escapeRegExp(roleName)}$`, 'i'),
          })),
        ],
      };
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd packages/data-schemas && npx jest src/methods/role.methods.spec.ts -t "getRoleByName"`
Expected: PASS.

- [ ] **Step 5: Grep the 81 callers for a raw custom-role name**

Run: `git grep -n "getRoleByName(" -- 'api/**' 'packages/**' | grep -v spec`
For each hit, confirm the argument is `req.user.role`, `user.role`, a `SystemRoles.*` literal, or a value that will be migrated to a key. Record the audit in the commit body. (Expected safe: all permission-middleware call sites pass `req.user.role`; `packages/api/src/admin/roles.ts` is rewritten in Task 9 to pass `roleKey`.)

- [ ] **Step 6: Typecheck + commit**

```bash
cd packages/data-schemas && npx tsc --noEmit && cd ../..
git add packages/data-schemas/src/methods/role.ts packages/data-schemas/src/methods/role.methods.spec.ts
git commit -m "refactor(role): resolve roles by roleKey in getRoleByName / findRolesByNames"
```

---

## Task 3: `migrateRoleKeys()` — backfill and rewrite existing data

**Files:**
- Modify: `packages/data-schemas/src/methods/role.ts` (add `migrateRoleKeys`; call it from `initializeRoles`)
- Create: `packages/data-schemas/src/methods/role.migration.spec.ts`

**Interfaces:**
- Produces: `migrateRoleKeys(options?: { dryRun?: boolean }): Promise<{ keyed: number; parentLinks: number; users: number; principals: number; dryRun: boolean; planned?: string[] }>` — added to the `createRoleMethods` return object and its return-type interface.
- `initializeRoles()` calls `await migrateRoleKeys()` immediately after the `ADMIN`/`USER` seed loop, before it returns.
- Idempotent: returns early (`keyed:0,...`) when `Role.countDocuments({ roleKey: { $exists: false } }) === 0` **and** no `Role` has a `parentRole` matching another role's `name`.

- [ ] **Step 1: Write the failing tests**

Create `packages/data-schemas/src/methods/role.migration.spec.ts` (copy the `mongodb-memory-server` + `createModels` setup from `role.methods.spec.ts`). Seed legacy-shaped data with the raw driver so the validate hook does **not** fire:

```ts
describe('migrateRoleKeys', () => {
  async function seedLegacy() {
    await mongoose.connection.collection('roles').insertMany([
      { name: 'ADMIN', permissions: {}, parentRole: null },
      { name: 'USER', permissions: {}, parentRole: null },
      { name: 'SUPERVISOR', permissions: {}, parentRole: null },
      { name: 'SALES_MGR', permissions: {}, parentRole: 'SUPERVISOR' },
      { name: 'SALES_EMP', permissions: {}, parentRole: 'SALES_MGR' },
    ]);
    const mgr = await mongoose.connection.collection('roles').findOne({ name: 'SALES_MGR' });
    await mongoose.connection.collection('users').insertOne({
      email: 'e@x.io', provider: 'local', role: 'SALES_MGR',
    });
    await mongoose.connection.collection('systemgrants').insertOne({
      principalType: 'role', principalId: 'SALES_MGR', capability: 'read:subordinates',
    });
    return mgr;
  }

  it('backfills roleKey (name for system, _id for custom) and rewrites parentRole to keys', async () => {
    await seedLegacy();
    await migrateRoleKeys();
    const admin = await Role.findOne({ name: 'ADMIN' }).lean();
    const sup = await Role.findOne({ name: 'SUPERVISOR' }).lean();
    const mgr = await Role.findOne({ name: 'SALES_MGR' }).lean();
    const emp = await Role.findOne({ name: 'SALES_EMP' }).lean();
    expect(admin?.roleKey).toBe('ADMIN');
    expect(sup?.roleKey).toBe(String(sup?._id));
    expect(mgr?.parentRole).toBe(sup?.roleKey);
    expect(emp?.parentRole).toBe(mgr?.roleKey);
  });

  it('rewrites user.role and ROLE-principal ids from name to key', async () => {
    await seedLegacy();
    await migrateRoleKeys();
    const mgr = await Role.findOne({ name: 'SALES_MGR' }).lean();
    const user = await User.findOne({ email: 'e@x.io' }).lean();
    const grant = await mongoose.models.SystemGrant.findOne({ capability: 'read:subordinates' }).lean();
    expect(user?.role).toBe(mgr?.roleKey);
    expect(grant?.principalId).toBe(mgr?.roleKey);
  });

  it('is a no-op on a second run', async () => {
    await seedLegacy();
    await migrateRoleKeys();
    const second = await migrateRoleKeys();
    expect(second).toEqual(expect.objectContaining({ keyed: 0, parentLinks: 0, users: 0, principals: 0 }));
  });

  it('dryRun reports the plan without writing', async () => {
    await seedLegacy();
    const res = await migrateRoleKeys({ dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.planned?.length).toBeGreaterThan(0);
    const mgr = await Role.findOne({ name: 'SALES_MGR' }).lean();
    expect(mgr?.roleKey).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/data-schemas && npx jest src/methods/role.migration.spec.ts`
Expected: FAIL — `migrateRoleKeys` is not a function.

- [ ] **Step 3: Implement `migrateRoleKeys`**

Add to `role.ts` (inside `createRoleMethods`, and to the return object + return-type):

```ts
  async function migrateRoleKeys(
    options: { dryRun?: boolean } = {},
  ): Promise<{
    keyed: number;
    parentLinks: number;
    users: number;
    principals: number;
    dryRun: boolean;
    planned?: string[];
  }> {
    const dryRun = options.dryRun === true;
    const Role = mongoose.models.Role as Model<IRole>;
    const User = mongoose.models.User as Model<IUser>;
    const planned: string[] = [];

    const rawRoles = await Role.collection
      .find({}, { projection: { name: 1, parentRole: 1, roleKey: 1 } })
      .toArray();

    const needsKey = rawRoles.filter((r) => !r.roleKey);
    const keyByName = new Map<string, string>();
    for (const r of rawRoles) {
      const key =
        r.roleKey ?? (isSystemRoleName(r.name) ? r.name.toUpperCase() : String(r._id));
      keyByName.set(r.name, key);
    }
    const knownKeys = new Set(keyByName.values());

    for (const r of needsKey) {
      const key = keyByName.get(r.name) as string;
      planned.push(`role "${r.name}" → roleKey ${key}`);
      if (!dryRun) {
        await Role.collection.updateOne({ _id: r._id }, { $set: { roleKey: key } });
      }
    }

    let parentLinks = 0;
    for (const r of rawRoles) {
      if (r.parentRole && !knownKeys.has(r.parentRole) && keyByName.has(r.parentRole)) {
        const key = keyByName.get(r.parentRole) as string;
        planned.push(`role "${r.name}".parentRole "${r.parentRole}" → ${key}`);
        parentLinks += 1;
        if (!dryRun) {
          await Role.collection.updateOne({ _id: r._id }, { $set: { parentRole: key } });
        }
      }
    }

    let users = 0;
    let principals = 0;
    const migratedUserIds: string[] = [];
    for (const r of rawRoles) {
      if (isSystemRoleName(r.name)) {
        continue;
      }
      const key = keyByName.get(r.name) as string;
      if (key === r.name) {
        continue;
      }
      const affected = await User.collection
        .find({ role: r.name }, { projection: { _id: 1 } })
        .toArray();
      if (affected.length > 0) {
        planned.push(`${affected.length} user(s) role "${r.name}" → ${key}`);
        users += affected.length;
        migratedUserIds.push(...affected.map((u) => String(u._id)));
        if (!dryRun) {
          await User.collection.updateMany({ role: r.name }, { $set: { role: key } });
        }
      }
      for (const coll of ['systemgrants', 'configs', 'aclentries']) {
        const filter = { principalType: 'role', principalId: r.name };
        const n = await mongoose.connection.collection(coll).countDocuments(filter);
        if (n > 0) {
          planned.push(`${n} ${coll} principal "${r.name}" → ${key}`);
          principals += n;
          if (!dryRun) {
            await mongoose.connection
              .collection(coll)
              .updateMany(filter, { $set: { principalId: key } });
          }
        }
      }
    }

    if (!dryRun && (needsKey.length > 0 || parentLinks > 0)) {
      await Role.collection.dropIndex('name_1_tenantId_1').catch(() => undefined);
      await Role.syncIndexes();
      const cache = deps.getCache?.(CacheKeys.ROLES);
      if (cache) {
        await Promise.all([...keyByName.values()].map((k) => cache.set(scopedCacheKey(k), null)));
      }
      await invalidateAuthUserDocCache(migratedUserIds);
      logger.info(
        `[migrateRoleKeys] keyed=${needsKey.length} parentLinks=${parentLinks} users=${users} principals=${principals}`,
      );
    }

    return { keyed: needsKey.length, parentLinks, users, principals, dryRun, planned };
  }
```

In `initializeRoles`, before the final closing brace of the function (after the `for` loop over `[ADMIN, USER]`), add:

```ts
    await migrateRoleKeys();
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd packages/data-schemas && npx jest src/methods/role.migration.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + build + commit**

```bash
cd packages/data-schemas && npx tsc --noEmit && cd ../.. && npm run build:data-schemas
git add packages/data-schemas/src/methods/role.ts packages/data-schemas/src/methods/role.migration.spec.ts
git commit -m "feat(role): migrateRoleKeys — backfill keys, rewrite parentRole/user.role/principals"
```

---

## Task 4: Resolver walks `roleKey` (renames + `fetchRoleGraph`)

**Files:**
- Modify: `packages/data-schemas/src/methods/role.ts` (resolver block ~lines 703–795 + return object + return-type)
- Modify: `packages/data-schemas/src/methods/role.hierarchy.spec.ts`

**Interfaces:**
- Renames (update the return-type interface, the `return { ... }` object, and every internal caller):
  - `getAncestorRoleNames` → `getAncestorRoleKeys(roleKey: string): Promise<string[]>`
  - `getDescendantRoleNames` → `getDescendantRoleKeys(roleKey: string): Promise<string[]>`
- Unchanged names, key semantics: `isDescendantOf(childKey, ancestorKey)`, `canViewRole(actorKey, targetKey)`, `wouldCreateCycle(roleKey, newParentKey)`.
- `fetchRoleGraph()` projects `roleKey parentRole`; `RoleGraphNode` becomes `{ roleKey: string; parentRole: string | null }`; `buildChildrenMap` keys by `roleKey`.
- New private helper: `rootKeyOf(graph, roleKey): string` — walks `parentRole` to the top; returns the role's own key if already top-level. Used by `setRoleParent` (Task 6). Add it here so Task 6 consumes it.

- [ ] **Step 1: Update the hierarchy spec fixtures + add a `rootKeyOf`-style assertion**

In `role.hierarchy.spec.ts`, change `seedTree()` to create roles through `methods.createRoleByName` (so `roleKey` is minted) and capture the keys:

```ts
async function seedTree() {
  const sup = await methods.createRoleByName({ name: 'SUPERVISOR' });
  const salesMgr = await methods.createRoleByName({ name: 'SALES_MANAGER', parentRole: sup.roleKey });
  const salesEmp = await methods.createRoleByName({ name: 'SALES_EMPLOYEE', parentRole: salesMgr.roleKey });
  const supportMgr = await methods.createRoleByName({ name: 'SUPPORT_MANAGER' });
  const supportEmp = await methods.createRoleByName({ name: 'SUPPORT_EMPLOYEE', parentRole: supportMgr.roleKey });
  return { sup, salesMgr, salesEmp, supportMgr, supportEmp };
}
```

Update every existing assertion in the file from role-name strings to `.roleKey` values, e.g.:

```ts
it('walks the whole subtree', async () => {
  const { sup, salesMgr, salesEmp } = await seedTree();
  const keys = await methods.getDescendantRoleKeys(sup.roleKey);
  expect(new Set(keys)).toEqual(new Set([salesMgr.roleKey, salesEmp.roleKey]));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/data-schemas && npx jest src/methods/role.hierarchy.spec.ts`
Expected: FAIL — `getDescendantRoleKeys` is not a function / name-based assertions mismatch.

- [ ] **Step 3: Rename + reproject in `role.ts`**

- In the return-type interface and `return { ... }`: `getAncestorRoleNames` → `getAncestorRoleKeys`, `getDescendantRoleNames` → `getDescendantRoleKeys`.
- `interface RoleGraphNode { roleKey: string; parentRole: string | null; }`
- `fetchRoleGraph`: `return await Role.find({}, 'roleKey parentRole').lean<RoleGraphNode[]>();`
- `buildChildrenMap`: iterate `{ roleKey, parentRole }`, push `roleKey` into `children.get(parentRole)`.
- `getAncestorRoleKeys` / `getDescendantRoleKeys` / `isDescendantOf` / `wouldCreateCycle`: replace every `name` local with `roleKey`; `parentByName` → `parentByKey` (`new Map(graph.map((n) => [n.roleKey, n.parentRole]))`).
- `canViewRole`: unchanged body (`if (actorKey === SystemRoles.ADMIN) return true; return isDescendantOf(targetKey, actorKey);`) — rename params `actorRole`/`targetRole` → `actorKey`/`targetKey`.
- Add:

```ts
  function rootKeyOf(graph: RoleGraphNode[], roleKey: string): string {
    const parentByKey = new Map(graph.map((n) => [n.roleKey, n.parentRole]));
    const seen = new Set<string>([roleKey]);
    let current = roleKey;
    let parent = parentByKey.get(current) ?? null;
    while (parent && !seen.has(parent)) {
      current = parent;
      seen.add(current);
      parent = parentByKey.get(current) ?? null;
    }
    return current;
  }
```

- [ ] **Step 4: Fix internal callers in `role.ts`**

`setRoleParent` currently calls `wouldCreateCycle`, `fetchRoleGraph`, `buildChildrenMap`, `findUserIdsByRole` — Task 6 rewrites it. For now just make `tsc` pass: `wouldCreateCycle(roleName, newParentName)` call sites still compile (params renamed only). Run `git grep -n "getDescendantRoleNames\|getAncestorRoleNames" packages/data-schemas` and fix the remaining (there should be none outside the two definitions).

- [ ] **Step 5: Run tests + typecheck**

Run: `cd packages/data-schemas && npx jest src/methods/role.hierarchy.spec.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/data-schemas/src/methods/role.ts packages/data-schemas/src/methods/role.hierarchy.spec.ts
git commit -m "refactor(role): hierarchy resolver walks roleKey; add rootKeyOf"
```

---

## Task 5: `createRoleByName` / `deleteRoleByName` / `updateRoleByName` / `countChildRoles` / `listRoles` by key

**Files:**
- Modify: `packages/data-schemas/src/methods/role.ts`
- Modify: `packages/data-schemas/src/methods/role.methods.spec.ts`

**Interfaces:**
- `createRoleByName(roleData: Partial<IRole>)` — `roleData.parentRole` is a `roleKey | null`. Behaviour:
  - reject reserved name (`isSystemRoleName`, existing);
  - reject if a role with the same `name` **and** same `parentRole` (`null` included) exists → `RoleConflictError`;
  - when `parentRole` set: look it up **by key** (`Role.findOne({ roleKey: parentRole })`), reject if missing or system; `depth = parent.depth + 1`;
  - the `pre('validate')` hook mints `roleKey` — do **not** set it here.
- `deleteRoleByName(roleKey)` — `User.updateMany({ role: roleKey }, { role: SystemRoles.USER })`; child check `countChildRoles(roleKey)`; cascade cleanup keyed by `roleKey` (done by the API handler in Task 9, not here).
- `countChildRoles(roleKey)` — `Role.countDocuments({ parentRole: roleKey })`.
- `updateRoleByName(roleKey, updates)` — `findOneAndUpdate({ roleKey }, ...)`; on `updates.name` change, pre-check `Role.exists({ parentRole: <this role's parentRole>, name: updates.name, _id: { $ne } })` → `RoleConflictError`; **remove** the `repointChildRoles` call and the rename→children coupling.
- `listRoles` — projection `'roleKey name description parentRole depth'`; return type `Pick<IRole, '_id' | 'roleKey' | 'name' | 'description' | 'parentRole' | 'depth'>[]`.
- `findUserIdsByRole(roleKey)` / `updateUsersByRole(oldKey, newKey)` / `listUsersByRole(roleKey)` / `countUsersByRole(roleKey)` — rename params to `roleKey`; queries already `{ role: <param> }`, semantics shift only.

- [ ] **Step 1: Write the failing tests**

Add to `role.methods.spec.ts`:

```ts
describe('name uniqueness', () => {
  it('allows the same child name under different parents', async () => {
    const a = await createRoleByName({ name: 'BRANCH_A' });
    const b = await createRoleByName({ name: 'BRANCH_B' });
    await createRoleByName({ name: 'DUPE', parentRole: a.roleKey });
    await expect(createRoleByName({ name: 'DUPE', parentRole: b.roleKey })).resolves.toBeDefined();
  });

  it('rejects a duplicate direct sibling name', async () => {
    const a = await createRoleByName({ name: 'BRANCH_C' });
    await createRoleByName({ name: 'SIB', parentRole: a.roleKey });
    await expect(createRoleByName({ name: 'SIB', parentRole: a.roleKey })).rejects.toThrow(RoleConflictError);
  });

  it('rejects a duplicate top-level name', async () => {
    await createRoleByName({ name: 'TOP_ONE' });
    await expect(createRoleByName({ name: 'TOP_ONE' })).rejects.toThrow(RoleConflictError);
  });

  it('rejects renaming a role onto a sibling name', async () => {
    const a = await createRoleByName({ name: 'BRANCH_D' });
    const x = await createRoleByName({ name: 'XX', parentRole: a.roleKey });
    await createRoleByName({ name: 'YY', parentRole: a.roleKey });
    await expect(updateRoleByName(x.roleKey, { name: 'YY' })).rejects.toThrow(RoleConflictError);
  });
});

it('deleteRoleByName resets affected users to USER and is keyed by roleKey', async () => {
  const r = await createRoleByName({ name: 'DEL_ME' });
  await User.create({ email: 'd@x.io', provider: 'local', role: r.roleKey });
  await deleteRoleByName(r.roleKey);
  const u = await User.findOne({ email: 'd@x.io' }).lean();
  expect(u?.role).toBe(SystemRoles.USER);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/data-schemas && npx jest src/methods/role.methods.spec.ts -t "name uniqueness"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Rewrite `createRoleByName`:

```ts
  async function createRoleByName(roleData: Partial<IRole>): Promise<IRole> {
    const { name } = roleData;
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new Error('Role name is required');
    }
    const trimmed = name.trim();
    if (isSystemRoleName(trimmed)) {
      throw new RoleConflictError(`Cannot create role with reserved system name: ${name}`);
    }
    const Role = mongoose.models.Role;

    const { parentRole } = roleData;
    let depth = 0;
    let parentKey: string | null = null;
    if (parentRole != null) {
      const parent = (await Role.findOne({ roleKey: parentRole }, 'depth name roleKey').lean()) as
        | { depth?: number; name: string; roleKey: string }
        | null;
      if (!parent) {
        throw new Error(`Parent role "${parentRole}" does not exist`);
      }
      if (isSystemRoleName(parent.name)) {
        throw new Error(`Cannot set parent to system role: ${parent.name}`);
      }
      parentKey = parent.roleKey;
      depth = (parent.depth ?? 0) + 1;
    }

    const sibling = await Role.findOne({ parentRole: parentKey, name: trimmed }).lean();
    if (sibling) {
      throw new RoleConflictError(
        parentKey
          ? `A role named "${trimmed}" already exists under this parent`
          : `A top-level role named "${trimmed}" already exists`,
      );
    }

    let role;
    try {
      role = await new Role({ ...roleData, name: trimmed, parentRole: parentKey, depth }).save();
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 11000) {
        throw new RoleConflictError(`A role named "${trimmed}" already exists here`);
      }
      throw err;
    }
    try {
      const cache = deps.getCache?.(CacheKeys.ROLES);
      if (cache) {
        await cache.set(scopedCacheKey(role.roleKey), role.toObject());
      }
    } catch (cacheError) {
      logger.error(`[createRoleByName] cache set failed for "${role.roleKey}":`, cacheError);
    }
    return role.toObject() as IRole;
  }
```

In `updateRoleByName(roleRef, updates)`: rename `roleName` → `roleRef`; change `findOneAndUpdate({ name: roleName }, ...)` → `findOneAndUpdate({ roleKey: roleRef }, ...)`. Before the update, if `updates.name`:

```ts
      if (updates.name) {
        const self = await Role.findOne({ roleKey: roleRef }, 'parentRole').lean();
        const clash = await Role.exists({
          parentRole: self?.parentRole ?? null,
          name: updates.name,
          roleKey: { $ne: roleRef },
        });
        if (clash) {
          throw new RoleConflictError(`A role named "${updates.name}" already exists here`);
        }
      }
```

Delete the `if (updates.name && updates.name !== roleName) { await repointChildRoles(...); }` block and the matching cache branch (collapse to a single `cache.set(scopedCacheKey(roleRef), role)`). Delete the now-unused private `repointChildRoles` function.

In `deleteRoleByName(roleRef)`: rename param; `isSystemRoleName` guard stays but must look up the name — change to load the role first: `const doc = await Role.findOne({ roleKey: roleRef }, 'name roleKey').lean(); if (!doc) return null; if (isSystemRoleName(doc.name)) throw ...`. Then `countChildRoles(roleRef)`, `findUserIdsByRole(roleRef)`, `User.updateMany({ role: roleRef }, { $set: { role: SystemRoles.USER } })`, `Role.findOneAndDelete({ roleKey: roleRef })`, cache `scopedCacheKey(roleRef)`.

In `countChildRoles(roleRef)`: `Role.countDocuments({ parentRole: roleRef })`.

In `listRoles`: `.select('roleKey name description parentRole depth')`; update the `Pick<...>` return type in the signature and the return-type interface.

In `findUserIdsByRole` / `updateUsersByRole` / `listUsersByRole` / `countUsersByRole`: rename the `roleName` param to `roleRef` (queries unchanged).

- [ ] **Step 4: Run tests + typecheck**

Run: `cd packages/data-schemas && npx jest src/methods/role.methods.spec.ts && npx tsc --noEmit`
Expected: PASS. Fix any existing spec assertions that used names where a key is now required (seed via `createRoleByName` and use `.roleKey`).

- [ ] **Step 5: Commit**

```bash
git add packages/data-schemas/src/methods/role.ts packages/data-schemas/src/methods/role.methods.spec.ts
git commit -m "feat(role): key-addressed CRUD + sibling/top-level name uniqueness"
```

---

## Task 6: `setRoleParent` — branch isolation + sibling guard

**Files:**
- Modify: `packages/data-schemas/src/methods/role.ts` (`setRoleParent` ~line 822)
- Modify: `packages/data-schemas/src/methods/role.hierarchy.spec.ts`

**Interfaces:**
- `setRoleParent(roleKey: string, newParentKey: string | null): Promise<IRole>`:
  - reject if `roleKey`/`newParentKey` resolves to a system role (plain `Error`);
  - reject if missing parent (plain `Error`);
  - reject cycle (`RoleConflictError`, existing message contains "cycle");
  - **reject if `rootKeyOf(newParent) !== rootKeyOf(role)`** → `RoleConflictError('cannot move a role to a different branch')`. A `newParentKey` of `null` fails this for any non-top-level role and is a no-op for a top-level role;
  - **reject if `newParentKey` already has a child (other than `roleKey`) whose `name` equals the moved role's `name`** → `RoleConflictError`;
  - recompute `depth` for the whole subtree via BFS (existing logic, keyed by `roleKey`);
  - invalidate `CacheKeys.ROLES` per affected key + `invalidateAuthUserDocCache` for subtree users.

- [ ] **Step 1: Write the failing tests**

Add to `role.hierarchy.spec.ts`:

```ts
describe('setRoleParent', () => {
  it('allows a same-branch move and recomputes depth', async () => {
    const { sup, salesMgr, salesEmp } = await seedTree();
    await methods.setRoleParent(salesEmp.roleKey, sup.roleKey);
    const moved = await Role.findOne({ roleKey: salesEmp.roleKey }).lean();
    expect(moved?.parentRole).toBe(sup.roleKey);
    expect(moved?.depth).toBe(1);
  });

  it('rejects a cross-branch move', async () => {
    const { salesEmp, supportMgr } = await seedTree();
    await expect(methods.setRoleParent(salesEmp.roleKey, supportMgr.roleKey)).rejects.toThrow(
      /different branch/,
    );
  });

  it('rejects a move that would duplicate a sibling name', async () => {
    const { sup, salesMgr } = await seedTree();
    const dupe = await methods.createRoleByName({ name: 'SALES_MANAGER', parentRole: salesMgr.roleKey });
    await expect(methods.setRoleParent(dupe.roleKey, sup.roleKey)).rejects.toThrow(RoleConflictError);
  });

  it('rejects a cycle', async () => {
    const { sup, salesMgr } = await seedTree();
    await expect(methods.setRoleParent(sup.roleKey, salesMgr.roleKey)).rejects.toThrow(/cycle/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/data-schemas && npx jest src/methods/role.hierarchy.spec.ts -t "setRoleParent"`
Expected: FAIL — cross-branch move currently succeeds.

- [ ] **Step 3: Implement**

Rewrite `setRoleParent` to key semantics:

```ts
  async function setRoleParent(roleKey: string, newParentKey: string | null): Promise<IRole> {
    const Role = mongoose.models.Role as Model<IRole>;
    const self = await Role.findOne({ roleKey }, 'name roleKey parentRole').lean();
    if (!self) {
      throw new Error(`Role "${roleKey}" not found`);
    }
    if (isSystemRoleName(self.name)) {
      throw new Error(`Cannot re-parent system role: ${self.name}`);
    }

    let parentDoc: { depth?: number; name: string; roleKey: string } | null = null;
    if (newParentKey != null) {
      parentDoc = (await Role.findOne({ roleKey: newParentKey }, 'depth name roleKey').lean()) as
        | { depth?: number; name: string; roleKey: string }
        | null;
      if (!parentDoc) {
        throw new Error(`Parent role "${newParentKey}" does not exist`);
      }
      if (isSystemRoleName(parentDoc.name)) {
        throw new Error(`Cannot set parent to system role: ${parentDoc.name}`);
      }
    }

    const graph = await fetchRoleGraph();
    if (await wouldCreateCycle(roleKey, newParentKey)) {
      throw new RoleConflictError(`Setting parent to "${newParentKey}" would create a cycle`);
    }
    const currentRoot = rootKeyOf(graph, roleKey);
    const newRoot = newParentKey != null ? rootKeyOf(graph, newParentKey) : roleKey;
    if (currentRoot !== newRoot) {
      throw new RoleConflictError('cannot move a role to a different branch');
    }

    if (newParentKey != null) {
      const clash = await Role.exists({
        parentRole: newParentKey,
        name: self.name,
        roleKey: { $ne: roleKey },
      });
      if (clash) {
        throw new RoleConflictError(
          `A role named "${self.name}" already exists under the target parent`,
        );
      }
    }

    const children = buildChildrenMap(graph);
    const newRootDepth = (parentDoc?.depth ?? -1) + 1;
    const depthByKey = new Map<string, number>([[roleKey, newRootDepth]]);
    const queue = [roleKey];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      const currentDepth = depthByKey.get(current) as number;
      for (const child of children.get(current) ?? []) {
        depthByKey.set(child, currentDepth + 1);
        queue.push(child);
      }
    }

    const affected = [...depthByKey.keys()];
    await Promise.all(
      affected.map((key) =>
        Role.updateOne(
          { roleKey: key },
          key === roleKey
            ? { $set: { parentRole: newParentKey, depth: newRootDepth } }
            : { $set: { depth: depthByKey.get(key) } },
        ),
      ),
    );

    const [updated, subtreeUserIds] = await Promise.all([
      Role.findOne({ roleKey }).select('-__v').lean(),
      Promise.all(affected.map((key) => findUserIdsByRole(key))).then((ids) => ids.flat()),
    ]);
    const cache = deps.getCache?.(CacheKeys.ROLES);
    if (cache) {
      await Promise.all(affected.map((key) => cache.set(scopedCacheKey(key), null)));
    }
    await invalidateAuthUserDocCache(subtreeUserIds);
    if (!updated) {
      throw new Error(`Role "${roleKey}" not found after re-parenting`);
    }
    return updated as unknown as IRole;
  }
```

`wouldCreateCycle(roleKey, newParentKey)` — verify its body already compares keys after Task 4 (it uses `getDescendantRoleKeys`); adjust the `newParentName === roleName` early check to `newParentKey === roleKey`.

- [ ] **Step 4: Run tests + typecheck + build**

Run: `cd packages/data-schemas && npx jest src/methods/role.hierarchy.spec.ts && npx tsc --noEmit && cd ../.. && npm run build:data-schemas`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/data-schemas/src/methods/role.ts packages/data-schemas/src/methods/role.hierarchy.spec.ts
git commit -m "feat(role): setRoleParent enforces branch isolation and sibling uniqueness"
```

---

## Task 7: `--dry-run` CLI wrapper

**Files:**
- Create: `scripts/migrate-role-keys.mts`
- Modify: `package.json` (root `scripts`)

**Interfaces:**
- Consumes: `migrateRoleKeys({ dryRun })` from Task 3, reachable via `require('~/models')` style. Match an existing script (`scripts/` has `.mts` files run via `tsx`/`node --import`).

- [ ] **Step 1: Inspect an existing script for the connect pattern**

Run: `ls scripts/*.mts && sed -n '1,30p' scripts/*.mts | head -40`
Use the same Mongo connect helper the neighbours use (`connectDb` / `mongoose.connect(process.env.MONGO_URI)`).

- [ ] **Step 2: Write the script**

```ts
/* Prints the role-key migration plan without applying it. Run: npm run migrate:role-keys -- --dry-run */
import mongoose from 'mongoose';
import { createModels, createMethods } from '@librechat/data-schemas';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  await mongoose.connect(uri);
  createModels(mongoose);
  const methods = createMethods(mongoose);
  const res = await methods.migrateRoleKeys({ dryRun });
  console.log(`\nmode: ${dryRun ? 'DRY RUN (no writes)' : 'APPLIED'}`);
  for (const line of res.planned ?? []) console.log('  •', line);
  console.log(
    `\nsummary: keyed=${res.keyed} parentLinks=${res.parentLinks} users=${res.users} principals=${res.principals}`,
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Add the npm script**

In root `package.json` `scripts`: `"migrate:role-keys": "node --import=tsx scripts/migrate-role-keys.mts"` (match the runner the other `.mts` scripts use).

- [ ] **Step 4: Smoke it against the dev DB**

Run: `npm run migrate:role-keys -- --dry-run`
Expected: prints a plan (or "keyed=0 ... " if already migrated). No writes.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-role-keys.mts package.json
git commit -m "chore(role): add migrate:role-keys --dry-run script"
```

---

## Task 8: `packages/api` hierarchy — `viewableRoleKeys` / `getDescendantRoleKeys`

**Files:**
- Modify: `packages/api/src/types/http.ts:37`
- Modify: `packages/api/src/middleware/hierarchy.ts`
- Modify: `packages/api/src/middleware/hierarchy.spec.ts`
- Modify: `packages/api/src/admin/hierarchy.ts`
- Modify: `packages/api/src/admin/hierarchy.spec.ts`

**Interfaces:**
- `ServerRequest.hierarchyScope?: { viewableRoleKeys: string[] } | null;`
- `HierarchyDeps.getDescendantRoleNames` → `getDescendantRoleKeys: (roleKey: string) => Promise<string[]>`
- `AdminHierarchyDeps.getDescendantRoleNames` → `getDescendantRoleKeys`
- `GET /api/admin/hierarchy/me` response: `{ isAdmin, canViewSubordinates, viewableRoleKeys: string[], manageableRoleKeys: string[] }`

- [ ] **Step 1: Update the specs**

In `hierarchy.spec.ts` (middleware) and `hierarchy.spec.ts` (admin), rename every `getDescendantRoleNames` mock → `getDescendantRoleKeys`, every `viewableRoleNames` → `viewableRoleKeys`, `manageableRoleNames` → `manageableRoleKeys`. Adjust fixture role strings to look like keys where it aids clarity (not required — they're opaque strings).

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/api && npx jest src/middleware/hierarchy.spec.ts src/admin/hierarchy.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the renames**

- `http.ts`: field + doc comment (`the role keys they may see`).
- `middleware/hierarchy.ts`: `HierarchyDeps.getDescendantRoleKeys`; destructure rename; `attachHierarchyScope` sets `req.hierarchyScope = { viewableRoleKeys: await getDescendantRoleKeys(user.role) }`; `requireSubordinateAccess` calls `canViewRole(user.role, target.role ?? '')` (unchanged — `user.role`/`target.role` are keys now). Update the block comment.
- `admin/hierarchy.ts`: `AdminHierarchyDeps.getDescendantRoleKeys`; both response objects use `viewableRoleKeys` / `manageableRoleKeys`; local `roleNames` → `roleKeys`.

- [ ] **Step 4: Run tests + typecheck + build**

Run: `cd packages/api && npx jest src/middleware/hierarchy.spec.ts src/admin/hierarchy.spec.ts && npx tsc --noEmit && cd ../.. && npm run build:api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/types/http.ts packages/api/src/middleware/hierarchy.ts packages/api/src/middleware/hierarchy.spec.ts packages/api/src/admin/hierarchy.ts packages/api/src/admin/hierarchy.spec.ts
git commit -m "refactor(api): hierarchy middleware + /hierarchy/me speak roleKeys"
```

---

## Task 9: `packages/api/src/admin/roles.ts` — `:roleKey` addressing

**Files:**
- Modify: `packages/api/src/admin/roles.ts`
- Modify: `packages/api/src/admin/roles.spec.ts`

**Interfaces:**
- Route param is `roleKey` (system name or 24-hex). New validator `validateRoleKeyParam(roleKey): string | null` — non-empty, `<= 100` chars, no control chars, and (`isSystemRoleName(roleKey)` OR `/^[0-9a-f]{24}$/i.test(roleKey)`).
- `createRoleHandler`: body `{ name, description?, permissions?, parentRole? }` where `parentRole` is a `roleKey | null`.
  - `parentRole != null`: `getRoleByName(parentRole)` must exist and not be system (`isSystemRoleName(parent.name)`) → 400.
  - `createRoleByName` throws `RoleConflictError` on a sibling/top-level clash → 409.
  - grant `VIEW_SUBORDINATES` with `principalId: role.roleKey`.
- `updateRoleHandler`:
  - re-parent branch (`body.parentRole !== undefined`): `setRoleParent(roleKey, body.parentRole)`; `RoleConflictError` (cycle / cross-branch / sibling clash) → 400; `/does not exist|system role/` `Error` → 400.
  - rename path: `updateRoleByName(roleKey, { name?, description? })`; `RoleConflictError` → 409. **Delete** `renameRole`, `rollbackMigratedUsers`, `findUserIdsByRole`/`updateUsersByRole` deps usage in this file, and the manual `getRoleByName(trimmedName)` duplicate guard.
- `deleteRoleHandler`: `countChildRoles(roleKey)` → 409; `deleteRoleByName(roleKey)`; cascade `deleteConfig(ROLE, roleKey)`, `deleteAclEntries({ principalId: roleKey })`, `deleteGrantsForPrincipal(ROLE, roleKey)`; audit `target: { id: roleKey, name: role.name }` (load the role's name before delete for the audit label).
- Remove `RESERVED_ROLE_NAMES` and its use in `validateRoleName` (a `roleKey` route segment is never `members`/`permissions`).
- `RoleListItem` type gains `roleKey: string`.

- [ ] **Step 1: Rewrite the spec around roleKey**

`roles.spec.ts` currently drives handlers with fake deps and `:name` params. Update the fake `createRoleByName` to return `{ ...data, roleKey: data.parentRole ? 'child-key' : 'top-key', _id: 'x' }`, `getRoleByName` to match on a `roleKey` map, and add:

```ts
it('createRole under a parent passes parentRole as a key and grants VIEW_SUBORDINATES by key', async () => {
  const grant = jest.fn().mockResolvedValue({ created: true });
  const handlers = makeHandlers({ grantCapability: grant, getRoleByName: keyLookup({ 'p-key': { name: 'PARENT', roleKey: 'p-key' } }) });
  const res = mockRes();
  await handlers.createRole(mockReq({ body: { name: 'CHILD', parentRole: 'p-key' } }), res);
  expect(res.status).toHaveBeenCalledWith(201);
  expect(grant).toHaveBeenCalledWith(expect.objectContaining({ principalId: expect.any(String), capability: 'read:subordinates' }));
});

it('createRole returns 409 when createRoleByName throws RoleConflictError', async () => {
  const handlers = makeHandlers({ createRoleByName: jest.fn().mockRejectedValue(new RoleConflictError('dup')) });
  const res = mockRes();
  await handlers.createRole(mockReq({ body: { name: 'DUPE' } }), res);
  expect(res.status).toHaveBeenCalledWith(409);
});

it('updateRole re-parent maps RoleConflictError to 400', async () => {
  const handlers = makeHandlers({ setRoleParent: jest.fn().mockRejectedValue(new RoleConflictError('cannot move a role to a different branch')) });
  const res = mockRes();
  await handlers.updateRole(mockReq({ params: { roleKey: 'k1' }, body: { parentRole: 'k2' } }), res);
  expect(res.status).toHaveBeenCalledWith(400);
});

it('updateRole rename no longer migrates users', async () => {
  const updateUsersByRole = jest.fn();
  const handlers = makeHandlers({ updateUsersByRole, updateRoleByName: jest.fn().mockResolvedValue({ name: 'NEW', roleKey: 'k1' }), getRoleByName: keyLookup({ k1: { name: 'OLD', roleKey: 'k1' } }) });
  const res = mockRes();
  await handlers.updateRole(mockReq({ params: { roleKey: 'k1' }, body: { name: 'NEW' } }), res);
  expect(updateUsersByRole).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(200);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/api && npx jest src/admin/roles.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Apply the interface changes above. Key edits:
- Add `validateRoleKeyParam`; replace `validateNameParam(name)` calls in `getRoleHandler`/`updateRoleHandler`/`updateRolePermissionsHandler`/`deleteRoleHandler`/members handlers with `validateRoleKeyParam(roleKey)` and read `req.params.roleKey`.
- `createRoleHandler`: keep `validateRoleName(name, true)` for the *body* name. `parentRole` validation via `getRoleByName(parentRole)`. Pass `roleData.parentRole = parentRole` (a key) through. After `createRoleByName`, `grantCapability({ ..., principalId: role.roleKey })`.
- `updateRoleHandler`: strip the rename-migration machinery; the whole `isRename` block becomes:

```ts
      const updates: Partial<IRole> = {};
      if (body.name?.trim() && body.name.trim() !== existing.name) {
        if (isSystemRoleName(existing.name)) {
          return res.status(403).json({ error: 'Cannot rename system role' });
        }
        if (isSystemRoleName(body.name.trim())) {
          return res.status(403).json({ error: 'Cannot use a reserved system role name' });
        }
        updates.name = body.name.trim();
      }
      if (body.description !== undefined) {
        updates.description = body.description;
      }
      if (Object.keys(updates).length === 0) {
        return res.status(200).json({ role: existing });
      }
      try {
        const role = await updateRoleByName(roleKey, updates);
        if (!role) {
          return res.status(404).json({ error: 'Role not found' });
        }
        return res.status(200).json({ role });
      } catch (error) {
        if (error instanceof RoleConflictError) {
          return res.status(409).json({ error: error.message });
        }
        throw error;
      }
```

- `deleteRoleHandler`: load `const role = await getRoleByName(roleKey);` first (404 if missing, 403 if `isSystemRoleName(role.name)`); use `roleKey` for `countChildRoles`, `deleteRoleByName`, and all three cascade calls; `emitGrantRemovals(req, roleKey, role.name, grants)` — update its signature to take both key and name (audit `target.id = roleKey`, `target.name = roleName`).
- Remove from `AdminRolesDeps` and the destructure: nothing (keep `updateUsersByRole`, `findUserIdsByRole`, `updateUsersRoleByIds` — still used by members handlers), but delete `renameRole` and `rollbackMigratedUsers` local functions.
- `RoleListItem`: add `roleKey: string`.

- [ ] **Step 4: Run tests + typecheck + build**

Run: `cd packages/api && npx jest src/admin/roles.spec.ts && npx tsc --noEmit && cd ../.. && npm run build:api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/admin/roles.ts packages/api/src/admin/roles.spec.ts
git commit -m "feat(api): admin roles API is roleKey-addressed; rename is a one-doc write"
```

---

## Task 10: `packages/api/src/admin/users.ts` — scope + reassignment by key

**Files:**
- Modify: `packages/api/src/admin/users.ts` (`withHierarchyScope` line 70; `reassignUserRoleHandler` line 297)
- Modify: `packages/api/src/admin/users.spec.ts`

**Interfaces:**
- `withHierarchyScope(filter, scope)` → `{ ...filter, role: { $in: scope.viewableRoleKeys } }`.
- `reassignUserRoleHandler` — body `{ role }` is a `roleKey`. Logic unchanged (`getRoleByName(trimmedRole)` already resolves by key after Task 2; `canViewRole(actorRole, trimmedRole)` compares keys). Update the JSDoc to say "the requested `roleKey`".

- [ ] **Step 1: Update the spec**

In `users.spec.ts`, rename `viewableRoleNames` → `viewableRoleKeys` in every `req.hierarchyScope` fixture. Add:

```ts
it('reassignUserRole accepts a roleKey body and checks canViewRole with keys', async () => {
  const canViewRole = jest.fn().mockResolvedValue(true);
  const updateUsersRoleByIds = jest.fn().mockResolvedValue(undefined);
  const handlers = makeHandlers({
    canViewRole,
    updateUsersRoleByIds,
    getRoleByName: jest.fn().mockResolvedValue({ name: 'SALES_EMP', roleKey: 'emp-key' }),
    findUsers: jest.fn().mockResolvedValue([{ _id: 'u1', role: 'other-key' }]),
  });
  const res = mockRes();
  await handlers.reassignUserRole(
    mockReq({ params: { userId: '5f'.padEnd(24, '0') }, body: { role: 'emp-key' }, user: { role: 'mgr-key' } }),
    res,
  );
  expect(canViewRole).toHaveBeenCalledWith('mgr-key', 'emp-key');
  expect(updateUsersRoleByIds).toHaveBeenCalledWith([expect.any(String)], 'emp-key');
  expect(res.status).toHaveBeenCalledWith(200);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/api && npx jest src/admin/users.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`withHierarchyScope`: `role: { $in: scope.viewableRoleKeys }`. Update the JSDoc lines on both functions.

- [ ] **Step 4: Run tests + typecheck + build + commit**

```bash
cd packages/api && npx jest src/admin/users.spec.ts && npx tsc --noEmit && cd ../.. && npm run build:api
git add packages/api/src/admin/users.ts packages/api/src/admin/users.spec.ts
git commit -m "refactor(api): admin users scope + reassignment keyed by roleKey"
```

---

## Task 11: `api/server` route wiring + integration test

**Files:**
- Modify: `api/server/routes/admin/roles.js` (route params `:name` → `:roleKey`)
- Modify: `api/server/routes/admin/users.js` (dep `getDescendantRoleNames` → `getDescendantRoleKeys`)
- Modify: `api/server/routes/__tests__/admin.hierarchy.spec.js`

**Interfaces:**
- `roles.js`: change `/:name`, `/:name/permissions`, `/:name/members`, `/:name/members/:userId` to `/:roleKey`, `/:roleKey/permissions`, `/:roleKey/members`, `/:roleKey/members/:userId`. Dep object unchanged (method names in `db` are stable).
- `users.js`: `createHierarchyMiddleware({ ..., getDescendantRoleKeys: db.getDescendantRoleKeys })`.

- [ ] **Step 1: Update the integration spec**

In `admin.hierarchy.spec.js`:
- `seedTree()` — create roles through `db.createRoleByName` and keep the returned docs; grant `read:subordinates` with `principalId: <role>.roleKey`.
- `as(userId, roleKey)` — pass keys, not names, in `x-test-user`.
- The `getDescendantRoleNames` dep in `createApp()` → `getDescendantRoleKeys`.
- Update assertions: `roles = res.body.users.map((u) => u.role)` now yields keys — compare against `salesEmp.roleKey` etc.
- The "listRoles projects parentRole and depth" test also asserts `salesEmployee.roleKey === String(salesEmployee._id)` and `supervisor.parentRole == null`.
- Add:

```ts
it('rejects a cross-branch re-parent via PATCH /roles/:roleKey', async () => {
  const { salesMgr, supportMgr } = await seedTree();
  await grantAdmin();
  const res = await request(app)
    .patch(`/api/admin/roles/${salesMgr.roleKey}`)
    .set('x-test-user', as(adminId, SystemRoles.ADMIN))
    .send({ parentRole: supportMgr.roleKey });
  expect(res.status).toBe(400);
});

it('rejects creating a duplicate sibling name', async () => {
  const { salesMgr } = await seedTree();
  await grantAdmin();
  await request(app).post('/api/admin/roles').set('x-test-user', as(adminId, SystemRoles.ADMIN))
    .send({ name: 'DUP_SIB', parentRole: salesMgr.roleKey }).expect(201);
  const res = await request(app).post('/api/admin/roles').set('x-test-user', as(adminId, SystemRoles.ADMIN))
    .send({ name: 'DUP_SIB', parentRole: salesMgr.roleKey });
  expect(res.status).toBe(409);
});
```

(The test app needs the roles router mounted — extend `createApp()` with `createAdminRolesHandlers` + an ADMIN-gated `/api/admin/roles` router if not present; wire `db.*` deps.)

- [ ] **Step 2: Run to verify failure**

Run: `cd api && npx jest server/routes/__tests__/admin.hierarchy.spec.js`
Expected: FAIL (needs Atlas `MONGO_URI_TEST`; if unreachable, note and rely on CI).

- [ ] **Step 3: Implement the route param renames**

`roles.js` — the four route strings. `users.js` — the one dep name.

- [ ] **Step 4: Build + run integration + regression**

Run: `npm run build:data-schemas && npm run build:api && cd api && npx jest server/routes/__tests__/admin.hierarchy.spec.js server/routes/__tests__/admin.users.conversations.spec.js`
Expected: PASS when Atlas reachable.

- [ ] **Step 5: Commit**

```bash
git add api/server/routes/admin/roles.js api/server/routes/admin/users.js api/server/routes/__tests__/admin.hierarchy.spec.js
git commit -m "feat(api): wire roleKey routes; integration coverage for branch/sibling rules"
```

---

## Task 12: `packages/data-provider` — types, endpoint, data-service

**Files:**
- Modify: `packages/data-provider/src/types/admin.ts`
- Modify: `packages/data-provider/src/api-endpoints.ts:504`
- Modify: `packages/data-provider/src/data-service.ts` (roles/hierarchy block ~1346–1434)
- Modify: `packages/data-provider/src/api-endpoints.admin.spec.ts`

**Interfaces:**
- `TAdminRole` gains `roleKey: string;` (required); `parentRole` doc comment: "Parent role's `roleKey`".
- `TMyHierarchy`: `viewableRoleKeys: string[]; manageableRoleKeys: string[];`
- `adminRole(roleKey: string)` — rename param only (path unchanged: `${adminRoles()}/${encodeURIComponent(roleKey)}`). `adminRoleMembers(roleKey, params?)`, `adminRoleMember(roleKey, userId)` — param renames.
- `data-service.ts`:
  - `createAdminRole(body: { name: string; description?: string; parentRole?: string | null })` — doc: `parentRole` is a `roleKey`.
  - `updateAdminRole(roleKey, body)`, `setAdminRoleParent(roleKey, parentRole)`, `deleteAdminRole(roleKey)`, `listAdminRoleMembers(roleKey, params?)`, `addAdminRoleMember(roleKey, userId)`, `removeAdminRoleMember(roleKey, userId)` — first param renamed `name` → `roleKey`.
  - `getMyHierarchy()` return type now has `viewableRoleKeys`/`manageableRoleKeys` (via `TMyHierarchy`).

- [ ] **Step 1: Update the endpoint spec**

In `api-endpoints.admin.spec.ts`, rename any `adminRole('SOME_NAME')` fixture to `adminRole('6a9e5db352b2842e907dc5f0')` and assert the URL contains the hex. Add an assertion that `adminHierarchyMe()` is unchanged.

- [ ] **Step 2: Run to verify (mostly a rename; may still pass)**

Run: `cd packages/data-provider && npx jest src/api-endpoints.admin.spec.ts`

- [ ] **Step 3: Implement the renames**

Apply all interface changes. In `data-service.ts` the bodies are unchanged apart from parameter names.

- [ ] **Step 4: Build + typecheck + commit**

```bash
cd packages/data-provider && npx tsc --noEmit && cd ../.. && npm run build:data-provider
git add packages/data-provider/src/types/admin.ts packages/data-provider/src/api-endpoints.ts packages/data-provider/src/data-service.ts packages/data-provider/src/api-endpoints.admin.spec.ts
git commit -m "feat(data-provider): TAdminRole.roleKey, TMyHierarchy keys, roleKey params"
```

---

## Task 13: Client data-provider — mutation/query payload renames

**Files:**
- Modify: `client/src/data-provider/Admin/mutations.ts`
- Modify: `client/src/data-provider/Admin/queries.ts` (`useAdminRoleMembers`)
- Modify: `client/src/data-provider/Admin/__tests__/mutations.test.ts`

**Interfaces:**
- `useCreateRole` — body `{ name; description?; parentRole?: string | null }` where `parentRole` is a `roleKey` (type unchanged; doc comment).
- `useUpdateRole` — `{ roleKey: string; updates: { name?: string; description?: string } }`
- `useSetRoleParent` — `{ roleKey: string; parentRole: string | null }`
- `useDeleteRole` — `{ roleKey: string }`
- `useSetUserRole` — `{ userId: string; role: string }` where `role` is a `roleKey` (unchanged shape).
- `useAddRoleMember` / `useRemoveRoleMember` — `{ roleKey: string; userId: string }`
- `useAdminRoleMembers(roleKey: string, page, config?)` — param + query-key part renamed.

- [ ] **Step 1: Update the mutations test**

In `mutations.test.ts`, rename `{ name: 'X', ... }` payloads to `{ roleKey: 'k1', ... }` and assert `dataService.updateAdminRole` / `setAdminRoleParent` / `deleteAdminRole` are called with `'k1'`.

- [ ] **Step 2: Run to verify failure**

Run: `cd client && npx jest src/data-provider/Admin/__tests__/mutations.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Rename the mutation-variable destructures and generic type params. In `useSetRoleParent`: `useMutation(({ roleKey, parentRole }) => dataService.setAdminRoleParent(roleKey, parentRole), ...)`. Same shape for the others. `useAddRoleMember`/`useRemoveRoleMember` `onSuccess` invalidation key `[QueryKeys.adminRoleMembers, roleKey]`.

- [ ] **Step 4: Run tests + typecheck**

Run: `cd client && npx jest src/data-provider/Admin/__tests__/mutations.test.ts && npm run typecheck`
Expected: PASS. (typecheck will flag consumer components — fixed in Tasks 14–15; if the checkpoint runs typecheck now, expect known errors in `EditRoleDialog.tsx` / `CreateRoleDialog.tsx` / `RoleMembersPanel.tsx` / `UserRow.tsx` and proceed.)

- [ ] **Step 5: Commit**

```bash
git add client/src/data-provider/Admin/mutations.ts client/src/data-provider/Admin/queries.ts client/src/data-provider/Admin/__tests__/mutations.test.ts
git commit -m "refactor(client): admin role mutations/queries take roleKey"
```

---

## Task 14: `roleTree.ts` key-matching + `roleLabels.ts` disambiguation

**Files:**
- Modify: `client/src/components/Admin/Access/roleTree.ts`
- Modify: `client/src/components/Admin/Access/__tests__/roleTree.test.ts`
- Create: `client/src/components/Admin/Access/roleLabels.ts`
- Create: `client/src/components/Admin/Access/roleLabels.test.ts`

**Interfaces:**
- `orderRolesByTree(roles: TAdminRole[]): OrderedRole[]` — unchanged signature; internally match `role.parentRole` against the set of `role.roleKey` values (`present` becomes `new Set(roles.map((r) => r.roleKey))`, `childrenOf` keyed by parent `roleKey`, `walk` recurses on `role.roleKey`). Sibling sort stays `a.name.localeCompare(b.name)`.
- `buildRoleLabels(roles: TAdminRole[]): Map<string, string>` — key = `roleKey`, value = display label. Default `role.name`; for any `name` shared by ≥2 roles, append ` — ${parentName}`, walking further up the chain (by `parentRole` → `roleKey`) until every colliding label is distinct.

- [ ] **Step 1: Write the failing tests**

`roleLabels.test.ts`:

```ts
import type { TAdminRole } from 'librechat-data-provider';
import { buildRoleLabels } from './roleLabels';

const r = (roleKey: string, name: string, parentRole: string | null = null): TAdminRole =>
  ({ roleKey, name, parentRole });

describe('buildRoleLabels', () => {
  it('uses the bare name when unique', () => {
    const labels = buildRoleLabels([r('k1', 'SALES_MANAGER'), r('k2', 'HR_MANAGER')]);
    expect(labels.get('k1')).toBe('SALES_MANAGER');
  });

  it('appends the parent name when two roles share a name', () => {
    const roles = [
      r('p1', 'OPS_SALES'),
      r('p2', 'OPS_HR'),
      r('c1', 'LEAD', 'p1'),
      r('c2', 'LEAD', 'p2'),
    ];
    const labels = buildRoleLabels(roles);
    expect(labels.get('c1')).toBe('LEAD — OPS_SALES');
    expect(labels.get('c2')).toBe('LEAD — OPS_HR');
  });

  it('walks further up when the parent names also collide', () => {
    const roles = [
      r('g1', 'SALES'),
      r('g2', 'HR'),
      r('p1', 'OPS', 'g1'),
      r('p2', 'OPS', 'g2'),
      r('c1', 'LEAD', 'p1'),
      r('c2', 'LEAD', 'p2'),
    ];
    const labels = buildRoleLabels(roles);
    expect(labels.get('c1')).toBe('LEAD — OPS — SALES');
    expect(labels.get('c2')).toBe('LEAD — OPS — HR');
  });
});
```

Update `roleTree.test.ts` fixtures: `const r = (roleKey, name, parentRole = null) => ({ roleKey, name, parentRole })` and change the tree-shape assertions to reference the new fixtures (parent links now by key).

- [ ] **Step 2: Run to verify failure**

Run: `cd client && npx jest src/components/Admin/Access/roleLabels.test.ts src/components/Admin/Access/__tests__/roleTree.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`roleLabels.ts`:

```ts
import type { TAdminRole } from 'librechat-data-provider';

export function buildRoleLabels(roles: TAdminRole[]): Map<string, string> {
  const byKey = new Map(roles.map((r) => [r.roleKey, r]));
  const nameCount = new Map<string, number>();
  for (const r of roles) {
    nameCount.set(r.name, (nameCount.get(r.name) ?? 0) + 1);
  }

  const labels = new Map<string, string>();
  for (const role of roles) {
    if ((nameCount.get(role.name) ?? 0) < 2) {
      labels.set(role.roleKey, role.name);
    }
  }

  const ambiguous = roles.filter((r) => !labels.has(r.roleKey));
  for (const role of ambiguous) {
    const parts = [role.name];
    let current = role.parentRole ? byKey.get(role.parentRole) : undefined;
    while (current) {
      parts.push(current.name);
      const candidate = parts.join(' — ');
      const clash = ambiguous.some(
        (other) => other.roleKey !== role.roleKey && labelChain(other, byKey, parts.length) === candidate,
      );
      if (!clash) {
        break;
      }
      current = current.parentRole ? byKey.get(current.parentRole) : undefined;
    }
    labels.set(role.roleKey, parts.join(' — '));
  }
  return labels;
}

function labelChain(role: TAdminRole, byKey: Map<string, TAdminRole>, depth: number): string {
  const parts = [role.name];
  let current = role.parentRole ? byKey.get(role.parentRole) : undefined;
  while (current && parts.length < depth) {
    parts.push(current.name);
    current = current.parentRole ? byKey.get(current.parentRole) : undefined;
  }
  return parts.join(' — ');
}
```

`roleTree.ts`: `const present = new Set(roles.map((r) => r.roleKey));`; in the first loop `const parent = role.parentRole && present.has(role.parentRole) ? role.parentRole : ROOT;`; in `walk`, `walk(role.roleKey, depth + 1)` and the stranded-role fallback checks `seen.has(role.roleKey)`; `seen` holds `roleKey`s.

- [ ] **Step 4: Run tests + typecheck**

Run: `cd client && npx jest src/components/Admin/Access/roleLabels.test.ts src/components/Admin/Access/__tests__/roleTree.test.ts && npm run typecheck`
Expected: PASS (Access components still error — fixed next).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Admin/Access/roleTree.ts client/src/components/Admin/Access/roleLabels.ts client/src/components/Admin/Access/roleLabels.test.ts client/src/components/Admin/Access/__tests__/roleTree.test.ts
git commit -m "feat(client): key-matched role tree + disambiguated labels"
```

---

## Task 15: `CreateRoleDialog` — top-level only + `parent` prop

**Files:**
- Modify: `client/src/components/Admin/Access/CreateRoleDialog.tsx`
- Modify: `client/src/components/Admin/Access/__tests__/CreateRoleDialog.test.tsx`

**Interfaces:**
- Props: `{ open: boolean; onOpenChange: (v: boolean) => void; parent?: TAdminRole }`.
- `parent` absent → title `com_admin_access_create_title`; submits `{ name, description, parentRole: null }`.
- `parent` present → title `localize('com_admin_role_add_under', { 0: parent.name })`; renders a read-only line `Parent: {parent.name}`; submits `{ name, description, parentRole: parent.roleKey }`.
- No `<select>`, no `useAdminRoles` import, no `parentRole` state.

- [ ] **Step 1: Rewrite the test**

```tsx
it('creates a top-level role with a null parent', async () => {
  const mutate = jest.fn((_b, o) => o?.onSuccess?.());
  mockUseCreateRole({ mutate });
  render(<CreateRoleDialog open onOpenChange={jest.fn()} />);
  fireEvent.change(screen.getByLabelText(/role name/i), { target: { value: 'NEWROLE' } });
  fireEvent.click(screen.getByRole('button', { name: /create/i }));
  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'NEWROLE', parentRole: null }),
    expect.anything(),
  );
  expect(screen.queryByText(/reports to/i)).not.toBeInTheDocument();
});

it('in add-under mode submits the parent roleKey', async () => {
  const mutate = jest.fn((_b, o) => o?.onSuccess?.());
  mockUseCreateRole({ mutate });
  render(
    <CreateRoleDialog open onOpenChange={jest.fn()} parent={{ roleKey: 'p-key', name: 'SALES_MGR', parentRole: null }} />,
  );
  expect(screen.getByText(/SALES_MGR/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/role name/i), { target: { value: 'CHILD' } });
  fireEvent.click(screen.getByRole('button', { name: /create/i }));
  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'CHILD', parentRole: 'p-key' }),
    expect.anything(),
  );
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd client && npx jest src/components/Admin/Access/__tests__/CreateRoleDialog.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Remove the `parentRole` state, `TOP_LEVEL_VALUE`, `useAdminRoles`, `parentOptions`, and the entire `<label>`-wrapped `<select>`. Add the `parent` prop. `submit()` sends `parentRole: parent?.roleKey ?? null`. When `parent`, render:

```tsx
<p className="text-sm text-text-secondary">
  {localize('com_admin_role_parent_label')}: <span className="text-text-primary">{parent.name}</span>
</p>
```

Title: `title={parent ? localize('com_admin_role_add_under', { 0: parent.name }) : localize('com_admin_access_create_title')}`.

- [ ] **Step 4: Run tests + typecheck + commit**

```bash
cd client && npx jest src/components/Admin/Access/__tests__/CreateRoleDialog.test.tsx
git add client/src/components/Admin/Access/CreateRoleDialog.tsx client/src/components/Admin/Access/__tests__/CreateRoleDialog.test.tsx
git commit -m "feat(client): CreateRoleDialog creates top-level roles or a child of a given parent"
```

---

## Task 16: `RoleRow` action buttons + `EditRoleDialog` static label + locale keys

**Files:**
- Modify: `client/src/components/Admin/Access/RoleRow.tsx`
- Modify: `client/src/components/Admin/Access/EditRoleDialog.tsx`
- Modify: `client/src/components/Admin/Access/RoleMembersPanel.tsx`
- Modify: `client/src/components/Admin/Access/__tests__/EditRoleDialog.test.tsx`
- Modify: `client/src/components/Admin/Access/__tests__/AccessView.test.tsx`
- Modify: `client/src/locales/en/translation.json`

**Interfaces:**
- `RoleRow` props: `{ role: TAdminRole; isSystem: boolean; isTopLevel: boolean; label: string; onEdit: () => void; onAdd: () => void; dragHandleRef?: (el: HTMLElement | null) => void; isDragging?: boolean }`.
  - Root `<div>` (not `<button>`), `data-role-key={role.roleKey}`, highlight classes when `isDragging`.
  - Buttons cluster (right-aligned): `GripVertical` (only when `!isSystem && !isTopLevel`, `ref={dragHandleRef}`, `title`/`aria-label` = `com_admin_role_action_move`), `Plus` (only when `!isSystem`, `onClick={onAdd}`, `com_admin_role_action_add`), `Pencil` (always, `onClick={onEdit}`, `com_admin_role_action_edit`).
  - Show `label` instead of `role.name`. Keep the `System` badge for `isSystem`.
- `EditRoleDialog`: drop `useSetRoleParent`, `useAdminRoles`, `parentRole`/`parentChoices` state, and the `parentChanged` branch. `saveDetails` sends only `{ name?, description? }` via `updateMutation.mutateAsync({ roleKey: role.roleKey, updates })`. Add a read-only line when `!isSystem`:

```tsx
<p className="text-sm text-text-secondary">
  {localize('com_admin_role_parent_label')}:{' '}
  <span className="text-text-primary">{parentName ?? localize('com_admin_role_top_level')}</span>
</p>
```

where `parentName` = `rolesData?.roles.find((r) => r.roleKey === role.parentRole)?.name`. Keep `useAdminRoles` **only** for that lookup (or accept a `parentName` prop from `AccessView` — prefer the prop to drop the query).
- `RoleMembersPanel` prop `roleName` → `roleKey`; pass to `useAdminRoleMembers`, `useAddRoleMember`, `useRemoveRoleMember`.
- Locale keys to add:
  - `com_admin_role_action_move`: "Move role"
  - `com_admin_role_action_add`: "Add child role"
  - `com_admin_role_action_edit`: "Edit role"
  - `com_admin_role_add_under`: "Add role under {{0}}"
  - `com_admin_role_move_out_of_branch`: "Can't move outside the {{0}} branch"
  - `com_admin_role_move_name_clash`: "A role named {{0}} already exists under {{1}}"
  - `com_admin_role_move_confirm`: "Move {{0}} under {{1}}? Its {{2}} sub-role(s) move with it."

- [ ] **Step 1: Update the tests**

`EditRoleDialog.test.tsx`: assert the "Reports to" text is static (no `combobox`), and that saving a description does **not** call `dataService.setAdminRoleParent`. `AccessView.test.tsx`: assert a custom non-top-level row shows 3 buttons (`move`/`add child`/`edit` by accessible name), a top-level row shows 2, an ADMIN row shows 1, and the row container is not a `button`.

- [ ] **Step 2: Run to verify failure**

Run: `cd client && npx jest src/components/Admin/Access/__tests__/EditRoleDialog.test.tsx src/components/Admin/Access/__tests__/AccessView.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Rewrite `RoleRow.tsx` per the interface (icon buttons from `lucide-react`: `GripVertical`, `Plus`, `Pencil`; each `<button type="button" title={...} aria-label={...}>`). Update `EditRoleDialog.tsx` and `RoleMembersPanel.tsx`. Add the 7 locale keys to `translation.json` (alphabetical position within the `com_admin_` block).

- [ ] **Step 4: Run tests + typecheck**

Run: `cd client && npx jest src/components/Admin/Access && npm run typecheck`
Expected: PASS (AccessView itself is finished in Task 17 — its test may still fail on drag wiring; scope this task's `AccessView.test.tsx` edits to button visibility only).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Admin/Access/RoleRow.tsx client/src/components/Admin/Access/EditRoleDialog.tsx client/src/components/Admin/Access/RoleMembersPanel.tsx client/src/components/Admin/Access/__tests__ client/src/locales/en/translation.json
git commit -m "feat(client): RoleRow action buttons + EditRoleDialog static Reports-to label"
```

---

## Task 17: `AccessView` drag-and-drop re-parenting + `MoveRoleDialog`

**Files:**
- Modify: `client/src/components/Admin/Access/AccessView.tsx`
- Create: `client/src/components/Admin/Access/MoveRoleDialog.tsx`
- Create: `client/src/components/Admin/Access/__tests__/MoveRoleDialog.test.tsx`
- Create: `client/src/components/Admin/Access/__tests__/AccessTreeDnd.test.tsx`

**Interfaces:**
- `AccessView` computes, from `orderRolesByTree(roles)`:
  - `labelMap = buildRoleLabels(roles)`
  - `rootKeyByKey: Map<string, string>` — each role's top-level ancestor key (walk `parentRole` via a `byKey` map).
  - `childNamesByParent: Map<string, Set<string>>` — for the sibling-clash `canDrop` check.
  - `descendantKeys(roleKey): Set<string>` — for the cycle `canDrop` check.
- Drag item type `'access-role'`, payload `{ roleKey: string; rootKey: string; name: string }`.
- `useDrop` on each row: `canDrop(item)` = `item.rootKey === rootKeyByKey.get(targetKey)` AND `targetKey !== item.roleKey` AND `!descendantKeys(item.roleKey).has(targetKey)` AND `roleByKey.get(item.roleKey)?.parentRole !== targetKey` AND `!childNamesByParent.get(targetKey)?.has(item.name)`.
- `hover(item, monitor)` when `monitor.isOver({ shallow: true }) && !monitor.canDrop()`: set `dropNotice` — `com_admin_role_move_out_of_branch` (rootKey mismatch) or `com_admin_role_move_name_clash` (name in `childNamesByParent`). Clear `dropNotice` on `drop`/drag-end and when a `canDrop` target is hovered.
- `drop(item, monitor)`: if `monitor.canDrop()` set `moveTarget = { role: roleByKey.get(item.roleKey), newParentKey: targetKey }` → opens `MoveRoleDialog`.
- `MoveRoleDialog` props: `{ move: { role: TAdminRole; newParentKey: string } | null; roles: TAdminRole[]; labelMap: Map<string,string>; onClose: () => void }`. Renders the confirm text `com_admin_role_move_confirm` with `{0: labelMap.get(role.roleKey), 1: labelMap.get(newParentKey), 2: <descendant count>}`; **Confirm** → `useSetRoleParent().mutate({ roleKey: role.roleKey, parentRole: newParentKey }, { onSuccess: onClose })`; **Cancel** → `onClose`. Surfaces `RoleConflictError` text from the mutation.
- Keyboard fallback: `RoleRow`'s grip is a `<button>`; `onClick`/Enter on it (when not mid-drag) calls `onStartKeyboardMove(role)` → `AccessView` opens `MoveRoleDialog` with `move.newParentKey` unset and a `<select>` of same-branch, non-self, non-descendant roles (labels from `labelMap`, values = `roleKey`); selecting one sets `newParentKey`.
- No `DndProvider` here — `client/src/App.jsx` already mounts one.

- [ ] **Step 1: Write the DnD tests**

`AccessTreeDnd.test.tsx` — render `AccessView` inside `<DndProvider backend={HTML5Backend}>` (see `FavoritesList.spec.tsx` for the helper) with a mocked `useAdminRoles` returning a two-branch tree. Use `react-dnd-test-backend` if present, else assert the pure helpers via exported functions. Minimum assertions:
- a `canDrop`-style helper returns `false` for a cross-branch pair and `true` for same-branch non-descendant.
- dropping a valid pair renders `MoveRoleDialog` (query the confirm text).
- `MoveRoleDialog` Confirm calls the `useSetRoleParent` mock with `{ roleKey, parentRole }`.

Extract the predicate logic into an exported `canReparent({ roles, sourceKey, targetKey })` pure function in `AccessView.tsx` (or a sibling `reparent.ts`) so it is unit-testable without the DnD backend.

`MoveRoleDialog.test.tsx` — Confirm/Cancel behaviour, error surfacing, keyboard-mode `<select>` options limited to same branch.

- [ ] **Step 2: Run to verify failure**

Run: `cd client && npx jest src/components/Admin/Access/__tests__/AccessTreeDnd.test.tsx src/components/Admin/Access/__tests__/MoveRoleDialog.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `reparent.ts`, `MoveRoleDialog.tsx`, and the `AccessView` wiring**

Create `client/src/components/Admin/Access/reparent.ts`:

```ts
import type { TAdminRole } from 'librechat-data-provider';

export function buildRoleMaps(roles: TAdminRole[]) {
  const byKey = new Map(roles.map((r) => [r.roleKey, r]));
  const rootKeyByKey = new Map<string, string>();
  const childNamesByParent = new Map<string, Set<string>>();
  for (const role of roles) {
    const set = childNamesByParent.get(role.parentRole ?? '') ?? new Set<string>();
    set.add(role.name);
    childNamesByParent.set(role.parentRole ?? '', set);
  }
  const rootOf = (key: string): string => {
    const seen = new Set<string>([key]);
    let current = key;
    let parent = byKey.get(current)?.parentRole ?? null;
    while (parent && byKey.has(parent) && !seen.has(parent)) {
      current = parent;
      seen.add(current);
      parent = byKey.get(current)?.parentRole ?? null;
    }
    return current;
  };
  for (const role of roles) {
    rootKeyByKey.set(role.roleKey, rootOf(role.roleKey));
  }
  return { byKey, rootKeyByKey, childNamesByParent };
}

export function descendantKeys(roles: TAdminRole[], roleKey: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const r of roles) {
    if (!r.parentRole) continue;
    (childrenOf.get(r.parentRole) ?? childrenOf.set(r.parentRole, []).get(r.parentRole)!).push(r.roleKey);
  }
  const out = new Set<string>();
  const queue = [...(childrenOf.get(roleKey) ?? [])];
  while (queue.length) {
    const next = queue.shift() as string;
    if (out.has(next)) continue;
    out.add(next);
    queue.push(...(childrenOf.get(next) ?? []));
  }
  return out;
}

export type ReparentBlock = 'cross-branch' | 'name-clash' | 'cycle' | 'no-op' | null;

export function reparentBlock(roles: TAdminRole[], sourceKey: string, targetKey: string): ReparentBlock {
  if (sourceKey === targetKey) return 'no-op';
  const { byKey, rootKeyByKey, childNamesByParent } = buildRoleMaps(roles);
  const source = byKey.get(sourceKey);
  if (!source) return 'no-op';
  if (rootKeyByKey.get(sourceKey) !== rootKeyByKey.get(targetKey)) return 'cross-branch';
  if (descendantKeys(roles, sourceKey).has(targetKey)) return 'cycle';
  if (source.parentRole === targetKey) return 'no-op';
  if (childNamesByParent.get(targetKey)?.has(source.name)) return 'name-clash';
  return null;
}
```

`MoveRoleDialog.tsx` — an `OGDialog` + `OGDialogTemplate` (match `EditRoleDialog`), the confirm sentence, Confirm/Cancel buttons, `getResponseErrorMessage(mutation.error)` on failure, and (keyboard mode) a `<select>` built from `roles` filtered by `reparentBlock(roles, role.roleKey, r.roleKey) === null`.

`AccessView.tsx` — build `labelMap`, the maps from `buildRoleMaps`, `dropNotice` state, `moveTarget` state. Render each ordered role inside a wrapper `<div ref={ref}>` with `useDrop({ accept: 'access-role', canDrop: (item) => reparentBlock(roles, item.roleKey, role.roleKey) === null, hover, drop, collect })`. Pass `dragHandleRef` from a per-row `useDrag({ type: 'access-role', item: { roleKey, rootKey, name }, collect })` to `RoleRow`. Render `dropNotice` in a `role="status"` banner above the list. Render `<MoveRoleDialog move={moveTarget} roles={roles} labelMap={labelMap} onClose={() => setMoveTarget(null)} />` and `<CreateRoleDialog open={createOpen} onOpenChange={setCreateOpen} />` + `<CreateRoleDialog open={addUnder != null} parent={addUnder ?? undefined} onOpenChange={(v) => !v && setAddUnder(null)} />`.

- [ ] **Step 4: Run all Access tests + typecheck**

Run: `cd client && npx jest src/components/Admin/Access && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Admin/Access/
git commit -m "feat(client): branch-isolated drag-and-drop re-parenting in the Access tree"
```

---

## Task 18: Users tab — key-based reassignment + disambiguated role column

**Files:**
- Modify: `client/src/components/Admin/Users/UserRow.tsx`
- Modify: `client/src/components/Admin/Users/UsersView.tsx`
- Modify: `client/src/components/Admin/Users/__tests__/UsersScreens.test.tsx`

**Interfaces:**
- `UserRow` props: `manageableRoleNames` → `manageableRoleKeys?: string[]`; new `roleLabel?: (roleKey: string) => string`.
  - role cell `<select>`: `value={user.role ?? ''}`, options are `manageableRoleKeys` with `roleLabel(key)` text; keep the "current role not in list" fallback option using `roleLabel(user.role)`. `onChange` → `setUserRole.mutate({ userId: user.id, role: e.target.value })`.
  - badge (read-only viewers): `roleLabel(user.role)`.
- `UsersView`: `const { data: rolesData } = useAdminRoles();` → `const roleLabelMap = useMemo(() => buildRoleLabels(rolesData?.roles ?? []), [rolesData]);` → `roleLabel = (k) => roleLabelMap.get(k) ?? k`. `manageableRoleKeys = hierarchy?.isAdmin ? undefined : hierarchy?.manageableRoleKeys`.
  - `useAdminRoles` for a non-admin hierarchy viewer: the `/api/admin/roles` route is ADMIN-only, so a subordinate viewer will 403. Guard: only call `useAdminRoles({ enabled: hierarchy?.isAdmin === true })`; for non-admin viewers, fall back to `roleLabel = (k) => k` (their `manageableRoleKeys` are opaque keys, and the spec's disambiguation is an ADMIN-tab concern — a subordinate manager sees a small fixed set). Document this with a comment.

- [ ] **Step 1: Update the tests**

In `UsersScreens.test.tsx`, rename `manageableRoleNames` → `manageableRoleKeys` in fixtures; assert the `<select>` options render `roleLabel` text (pass a stub `roleLabel`); assert `onChange` calls the mutation with the selected `roleKey`.

- [ ] **Step 2: Run to verify failure**

Run: `cd client && npx jest src/components/Admin/Users/__tests__/UsersScreens.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Apply the interface changes. Import `buildRoleLabels` from `../Access/roleLabels`.

- [ ] **Step 4: Run tests + typecheck + commit**

```bash
cd client && npx jest src/components/Admin/Users && npm run typecheck
git add client/src/components/Admin/Users/
git commit -m "feat(client): Users tab reassignment by roleKey with disambiguated labels"
```

---

## Task 19: Full typecheck / lint / build sweep

**Files:** none (verification only)

- [ ] **Step 1: Build every workspace in dependency order**

Run: `npm run build:data-provider && npm run build:data-schemas && npm run build:api`
Expected: clean.

- [ ] **Step 2: Typecheck all four workspaces**

Run: `cd packages/data-schemas && npx tsc --noEmit && cd ../data-provider && npx tsc --noEmit && cd ../api && npx tsc --noEmit && cd ../../client && npm run typecheck`
Expected: no errors. Fix any stragglers (likely a missed `viewableRoleNames` / `name` → `roleKey` reference).

- [ ] **Step 3: Grep for stale identifiers**

Run: `git grep -n "viewableRoleNames\|manageableRoleNames\|getDescendantRoleNames\|getAncestorRoleNames\|repointChildRoles" -- 'packages/**' 'client/**' 'api/**' | grep -v spec | grep -v docs`
Expected: no hits (specs updated separately; docs intentionally left).

- [ ] **Step 4: Lint + import-sort touched files**

Run: `npm run sort-imports -- $(git diff --name-only main...HEAD | grep -E '\.(ts|tsx)$' | tr '\n' ' ') && npm run lint`
Expected: clean (auto-fix trailing-space/import-order; resolve any remaining warnings — zero tolerance).

- [ ] **Step 5: Static checks**

Run: `npm run static-checks`
Expected: pass.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "chore(role): typecheck/lint sweep for roleKey migration"
```

---

## Task 20: Integration run + migration smoke on a copy

**Files:** none (verification only — needs a reachable MongoDB)

- [ ] **Step 1: Backend unit + integration suites**

Run: `cd packages/data-schemas && npx jest src/methods/role && cd ../api && npx jest src/admin src/middleware/hierarchy`
Expected: PASS (or the documented `mongodb-memory-server` boot failure on this machine — then rely on CI).

- [ ] **Step 2: Route integration (Atlas)**

Run: `cd api && npx jest server/routes/__tests__/admin.hierarchy.spec.js server/routes/__tests__/admin.users.conversations.spec.js server/routes/__tests__/roles.spec.js server/routes/__tests__/grants.spec.js`
Expected: PASS when `MONGO_URI_TEST` reachable. `roles.spec.js` / `grants.spec.js` are the regression guard for `getRoleByName`-by-key.

- [ ] **Step 3: Client Admin suite**

Run: `cd client && npx jest src/components/Admin src/data-provider/Admin`
Expected: PASS.

- [ ] **Step 4: Migration dry-run against the dev DB**

Run: `npm run migrate:role-keys -- --dry-run`
Expected: a printed plan (first run) or `keyed=0 parentLinks=0 users=0 principals=0` (already migrated). Then start the backend (`npm run backend`) and confirm the boot log shows `[migrateRoleKeys] ...` exactly once and the server reaches "listening".

- [ ] **Step 5: Manual smoke (browser, backend + `npm run frontend:dev`)**

- Access tab: "Create role" → only Name/Description (no "Reports to"); create `SALES`. Row shows `+` and `✎` (no grip — it's top-level). ADMIN/USER rows show `✎` only.
- `+` on `SALES` → "Add role under SALES"; create two children both named `LEAD`. Both appear as `LEAD — SALES`… (they're siblings — expect the **second create to 409**; create `LEAD` and `LEAD2` instead).
- Drag `LEAD2`'s grip onto `LEAD` → confirm dialog → Confirm → `LEAD2` nests under `LEAD`.
- Drag `LEAD` toward a second top-level branch's row → notice "Can't move outside the SALES branch"; drop does nothing.
- Edit `LEAD2` → "Reports to : LEAD" as static text; saving a description sends one request.
- Users tab as ADMIN: role column unchanged; as a subordinate manager: `<select>` reassigns within the subtree.

- [ ] **Step 6: Commit the plan-completion note**

```bash
git commit --allow-empty -m "test(role): full role-identity-keys verification pass"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task(s) |
|---|---|
| §3.1 `roleKey` (system sentinel / `_id`) | 1 (hook), 3 (backfill) |
| §3.2 index swap | 1 (schema), 3 (drop old + syncIndexes) |
| §3.3 field semantics | 1–5, 9, 12 |
| §3.4 `IRole.roleKey` | 1 |
| §3.5 `TAdminRole` / `TMyHierarchy` | 12 |
| §4 migration (7 steps + index handling + dry-run) | 3, 7 |
| §5 resolver → keys | 4 |
| §5 `getRoleByName` by key + 81-caller audit | 2 |
| §5 `createRoleByName` / rename / delete / `countChildRoles` / `listRoles` | 5 |
| §5 `setRoleParent` branch isolation + sibling | 6 |
| §6.1 admin roles API `:roleKey` | 9 |
| §6.2 reassignment by key | 10 |
| §6.3 `/hierarchy/me` keys | 8 |
| §6.4 data-provider | 12 |
| §7.1 CreateRoleDialog | 15 |
| §7.2 RoleRow buttons | 16 |
| §7.3 drag-and-drop (branch isolation, notice, confirm, keyboard) | 17 |
| §7.4 EditRoleDialog static label | 16 |
| §7.5 `buildRoleLabels` + `orderRolesByTree` key-match | 14 |
| §7.6 client query/mutation wiring | 13 |
| §8 name-uniqueness table | 5 (create/rename), 6 (re-parent), 9 (API 409/400), 11 (integration) |
| §9 testing (all layers) | every task's tests + 19, 20 |
| §10 rollout | 7, 20 |
| §11 file inventory | File Structure table above |
| §12 open risks: `getRoleByName` audit | 2 step 5 |
| §12 open risks: compound-index null segments | 3 (migration test) |
| §12 open risks: HTML5 drag on touch | 17 (mirror `FavoritesList` `useMediaQuery('(hover: hover)')` on the grip) |

No gaps.

**2. Placeholder scan** — no "TBD"/"handle edge cases"/"similar to Task N"; every code step has real code or a concrete command.

**3. Type consistency**

- `roleKey` is `string` everywhere (Task 1 type, Task 3 backfill, Task 12 `TAdminRole`).
- Resolver renames used consistently: `getDescendantRoleKeys` (Tasks 4, 8, 11), `getAncestorRoleKeys` (Task 4), `rootKeyOf` (Tasks 4→6).
- `req.hierarchyScope.viewableRoleKeys` (Tasks 8, 10) — matches `withHierarchyScope` (Task 10).
- Mutation payloads: `{ roleKey, ... }` (Task 13) consumed by `EditRoleDialog`/`AccessView`/`MoveRoleDialog` (Tasks 16, 17) and `RoleMembersPanel` (Task 16).
- `buildRoleLabels(roles): Map<string,string>` (Task 14) consumed by `AccessView` (17) and `UsersView` (18).
- `reparentBlock(roles, sourceKey, targetKey)` (Task 17) — single predicate for `canDrop` + keyboard `<select>` filter + notice reason.
- `CreateRoleDialog` `parent?: TAdminRole` prop (Task 15) consumed by `AccessView` (Task 17).

One fix applied inline: Task 16 originally left `EditRoleDialog` calling `updateMutation.mutateAsync({ name: role.name, ... })` — corrected to `{ roleKey: role.roleKey, updates }` to match Task 13's `useUpdateRole` signature.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-09-role-identity-and-access-tree.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — a fresh subagent per task, two-stage review between tasks, fast iteration.

**2. Inline Execution** — tasks run in this session via `superpowers:executing-plans`, batched with checkpoints for review.

**Which approach?**
