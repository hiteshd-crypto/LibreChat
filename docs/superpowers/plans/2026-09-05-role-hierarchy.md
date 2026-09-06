# Role Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore ADMIN's "Create role" affordance and let ADMIN arrange custom roles into a branch-isolated tree (`parentRole`), so a role higher in a branch can view, list, and reassign the role of any user whose role is a strict descendant of its own — never a sibling branch, never `USER`.

**Architecture:** A single hierarchy resolver in `packages/data-schemas/src/methods/role.ts` (ancestor/descendant walks, cycle detection, `setRoleParent`) is the only place tree logic lives. A new `read:subordinates` capability, checked by new hierarchy middleware in `packages/api`, gates non-ADMIN access to a role-filtered user list, the existing read-only conversation viewer, and a new role-reassignment endpoint — all three reuse the resolver rather than re-implementing any walk. The Access tab (role/tree editing) stays ADMIN-only; the Users tab opens to any role with descendants, scoped server-side.

**Tech Stack:** Same as the in-app admin area this extends — React 19 + react-router-dom, `@tanstack/react-query` v4 array-key style, `@librechat/client` UI primitives, Tailwind semantic tokens, Express 5 (`api/`), TypeScript backend logic (`packages/api`), Mongoose models (`packages/data-schemas`), shared types/endpoints (`packages/data-provider`). Jest + `mongodb-memory-server` for backend unit tests (note: this dev machine's local run has had trouble with `mongodb-memory-server` per project memory — CI and other environments run it fine; if it fails to boot locally, note it and continue, don't rewrite the test around it), `connectTestDb`/supertest for backend route integration tests, Jest + `test/layout-test-utils` for client tests.

**Spec:** `docs/superpowers/specs/2026-09-05-role-hierarchy-design.md`

## Global Constraints

- **New backend logic is TypeScript in `packages/api`** (or `packages/data-schemas` for DB-model logic); `api/` changes are thin wiring only (LibreChat CLAUDE.md).
- **Never use `any`**; no `unknown`/`Record<string, unknown>` where an explicit type exists. Reuse `IRole`, `IUser`, `SystemCapability`, `CapabilityUser`, `TAdminRole` — do not redefine.
- **Roles are referenced by name everywhere** — `parentRole` is a role **name** string, matching `user.role`. Never introduce a separate role-id reference.
- **The resolver is the single source of truth for tree logic.** No call site outside `packages/data-schemas/src/methods/role.ts` re-implements a parent walk, cycle check, or descendant computation.
- **`ADMIN` and `USER` never enter the tree.** Both keep `parentRole: null`; both are rejected wherever a parent or re-parent target is validated (`isSystemRoleName`, already in `role.ts`).
- **`depth` is a display/pre-check value only, never an authorization input.** Every access decision goes through `canViewRole`, which walks `parentRole` directly.
- **The new `read:subordinates` capability is independent** of `access:admin` and `read:users` — never implied by, and never implying, either.
- **All user-facing client strings** go through `useLocalize()`; add keys only to `client/src/locales/en/translation.json`, prefix `com_admin_`.
- **Tailwind: semantic tokens only** — no raw palette utilities, no hex, no `dark:` literals in feature components.
- **Authorization is server-side.** No endpoint may read a role, userId, or acting identity from a request body/query/header for authz, except the reassignment endpoint's `{ role }` body, which is validated against `canViewRole` before being written — never trusted as the caller's own identity.
- **Do not modify** `/api/convos/*`, `/api/messages/*`, the external `librechat-admin-panel` repo, or the role feature-permission matrix.
- After editing `packages/data-provider`, run `npm run build:data-provider` before client typecheck. After editing `packages/api`, run `npm run build:api` before route-level (`api/`) tests.
- Run `npx tsc --noEmit` in every workspace you touched; `npm run lint` and `npm run sort-imports -- <files>` on touched files.
- React Query here is v4: `useQuery([key, ...parts], fn, optionsObject)` — match `client/src/data-provider/Admin/queries.ts`.
- Commit after every task with a `feat:` / `test:` message. Work on a branch, not `main`.

---

## File Structure

**New files:**

| File | Responsibility |
|---|---|
| `packages/data-schemas/src/methods/role.hierarchy.spec.ts` | Unit tests for the resolver functions added to `role.ts` |
| `packages/api/src/middleware/hierarchy.ts` | `createHierarchyMiddleware` — `requireSubordinateAccess`, `attachHierarchyScope` |
| `packages/api/src/middleware/hierarchy.spec.ts` | DI-style unit tests for the above |
| `packages/api/src/admin/hierarchy.ts` | `createAdminHierarchyHandlers` — `GET /api/admin/hierarchy/me` |
| `packages/api/src/admin/hierarchy.spec.ts` | Unit tests for the above |
| `api/server/routes/admin/hierarchy.js` | Route wiring for `/api/admin/hierarchy/me` |
| `api/server/routes/__tests__/admin.hierarchy.spec.js` | End-to-end multi-branch tree integration test |
| `client/src/components/Admin/Access/CreateRoleDialog.tsx` | Restored create-role dialog + parent picker |
| `client/src/components/Admin/Access/__tests__/CreateRoleDialog.test.tsx` | Tests for the above |

**Modified files:**

| File | Change |
|---|---|
| `packages/data-schemas/src/types/role.ts` | `IRole.parentRole`, `IRole.depth` (optional) |
| `packages/data-schemas/src/schema/role.ts` | `parentRole`, `depth` schema fields |
| `packages/data-schemas/src/methods/role.ts` | Resolver reads (`getAncestorRoleNames`, `getDescendantRoleNames`, `isDescendantOf`, `canViewRole`, `wouldCreateCycle`), `setRoleParent`, `countChildRoles` exported; private `repointChildRoles`; `createRoleByName`/`deleteRoleByName`/`updateRoleByName` made tree-aware |
| `packages/data-schemas/src/methods/role.methods.spec.ts` | Tests for the tree-aware CRUD changes |
| `packages/data-schemas/src/admin/capabilities.ts` | `VIEW_SUBORDINATES` capability + category entry |
| `packages/data-schemas/src/admin/capabilities.spec.ts` | Test for the new capability |
| `packages/api/src/middleware/capabilities.ts` | `requireAnyCapability` |
| `packages/api/src/middleware/capabilities.spec.ts` | Tests for `requireAnyCapability` |
| `packages/api/src/types/http.ts` | `ServerRequest.hierarchyScope` |
| `packages/api/src/admin/roles.ts` | `parentRole` in create/update, capability grant on create, child-count delete guard |
| `packages/api/src/admin/roles.spec.ts` | Tests for the above |
| `packages/api/src/admin/users.ts` | Hierarchy-scoped `listUsers`/`searchUsers`, new `reassignUserRole` |
| `packages/api/src/admin/users.spec.ts` | Tests for the above |
| `api/server/middleware/roles/capabilities.js` | Export `requireAnyCapability` |
| `api/server/routes/admin/roles.js` | Wire `grantCapability`, `countChildRoles`, `setRoleParent` deps |
| `api/server/routes/admin/users.js` | Widen router gate, swap `requireReadUsers` for hierarchy middleware, add `PATCH /:userId/role` |
| `api/server/routes/index.js` | Export `adminHierarchy` |
| `api/server/index.js` | Mount `/api/admin/hierarchy` |
| `packages/data-provider/src/types/admin.ts` | `TAdminRole.parentRole`/`depth`, `TMyHierarchy` |
| `packages/data-provider/src/api-endpoints.ts` | `adminHierarchyMe`, `adminUserRole` |
| `packages/data-provider/src/data-service.ts` | Restore `createAdminRole`; add `setAdminRoleParent`, `getMyHierarchy`, `setAdminUserRole` |
| `packages/data-provider/src/keys.ts` | `myHierarchy` query key |
| `packages/data-provider/src/api-endpoints.admin.spec.ts` | Tests for new endpoint builders |
| `client/src/data-provider/Admin/queries.ts` | `useMyHierarchy` |
| `client/src/data-provider/Admin/mutations.ts` | Restore `useCreateRole`; add `useSetRoleParent`, `useSetUserRole` |
| `client/src/data-provider/Admin/__tests__/queries.test.ts` (create if absent) | Tests for `useMyHierarchy` |
| `client/src/components/Admin/guard.tsx` | Capability-aware guard |
| `client/src/components/Admin/__tests__/guard.test.tsx` (create if absent) | Tests for the widened guard |
| `client/src/components/Admin/AdminLayout.tsx` | Access tab rendered only for `isAdmin` |
| `client/src/hooks/Nav/useUnifiedSidebarLinks.ts` | Sidebar link shown for `isAdmin \|\| canViewSubordinates` |
| `client/src/components/Admin/Access/AccessView.tsx` | "Create role" button, depth indent |
| `client/src/components/Admin/Access/EditRoleDialog.tsx` | "Reports to" field, delete-blocked-with-children message |
| `client/src/components/Admin/Users/UserRow.tsx` | "Change role" control for non-ADMIN viewers |
| `client/src/components/Admin/Users/UsersView.tsx` | Wire the role-change control through to `UserRow` |
| `client/src/locales/en/translation.json` | New `com_admin_*` keys |

---

## Task 1: Data model — `parentRole` and `depth` on the role schema

**Files:**
- Modify: `packages/data-schemas/src/types/role.ts`
- Modify: `packages/data-schemas/src/schema/role.ts`
- Test: `packages/data-schemas/src/methods/role.methods.spec.ts`

**Interfaces:**
- Produces: `IRole.parentRole: string | null`, `IRole.depth: number`, both optional on the TS type (Mongoose supplies the schema default) so existing object literals that omit them still typecheck.

- [ ] **Step 1: Write the failing test**

Add to `packages/data-schemas/src/methods/role.methods.spec.ts` (near the other `createRoleByName` tests):

```ts
it('defaults a newly created role to a null parent and depth 0', async () => {
  const role = await createRoleByName({ name: 'PARENT_DEFAULT_TEST' });
  expect(role.parentRole ?? null).toBeNull();
  expect(role.depth ?? 0).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/data-schemas && npx jest src/methods/role.methods.spec.ts -t "defaults a newly created role"`
Expected: FAIL — `role.parentRole` is `undefined` and the schema has no such path (Mongoose silently drops unknown fields, so the assertion on `depth` also reads `undefined`, which the `?? 0` masks — the meaningful failure is that this test currently can't distinguish "field exists and defaults to 0" from "field doesn't exist"; step 4 confirms the field is real by asserting the schema path directly).

- [ ] **Step 3: Add the fields**

In `packages/data-schemas/src/types/role.ts`, after `tenantId?: string;` inside `IRole`:

```ts
  /** Name of the parent role in the hierarchy tree. `null`/`undefined` = top-level branch. `ADMIN`/`USER` never set this. */
  parentRole?: string | null;
  /** Denormalized tree depth (0 for USER, ADMIN, and top-level branches). Display/pre-check only — never used for authorization. */
  depth?: number;
```

In `packages/data-schemas/src/schema/role.ts`, in the `roleSchema` definition after `tenantId`:

```ts
  parentRole: {
    type: String,
    default: null,
    index: true,
  },
  depth: {
    type: Number,
    default: 0,
  },
```

- [ ] **Step 4: Strengthen the test to check the schema path directly, then verify it passes**

Replace the Step 1 test with:

```ts
it('defaults a newly created role to a null parent and depth 0', async () => {
  const role = await createRoleByName({ name: 'PARENT_DEFAULT_TEST' });
  const stored = await Role.findOne({ name: 'PARENT_DEFAULT_TEST' }).lean();
  expect(stored?.parentRole ?? null).toBeNull();
  expect(stored?.depth).toBe(0);
});
```

Run: `cd packages/data-schemas && npx jest src/methods/role.methods.spec.ts -t "defaults a newly created role"`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd packages/data-schemas && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/data-schemas/src/types/role.ts packages/data-schemas/src/schema/role.ts packages/data-schemas/src/methods/role.methods.spec.ts
git commit -m "feat(role): add parentRole and depth fields to the role schema"
```

---

## Task 2: Hierarchy resolver — read-only graph functions

**Files:**
- Modify: `packages/data-schemas/src/methods/role.ts`
- Create: `packages/data-schemas/src/methods/role.hierarchy.spec.ts`

**Interfaces:**
- Consumes: Task 1's `IRole.parentRole`; `SystemRoles` from `librechat-data-provider` (already imported in `role.ts`).
- Produces (added to the object `createRoleMethods` returns, and to its return-type interface):
  - `getAncestorRoleNames(roleName: string): Promise<string[]>`
  - `getDescendantRoleNames(roleName: string): Promise<string[]>`
  - `isDescendantOf(childRole: string, ancestorRole: string): Promise<boolean>`
  - `canViewRole(actorRole: string, targetRole: string): Promise<boolean>`
  - `wouldCreateCycle(roleName: string, newParentName: string | null): Promise<boolean>`
  - These do a fresh `Role.find({}, 'name parentRole').lean()` per call rather than reading through `CacheKeys.ROLES` (which caches individual role docs, not a list) — this keeps every authorization decision correct immediately after a tree write, with no cache-invalidation dependency to get wrong. The table is ~10 rows; this is not a hot path.

- [ ] **Step 1: Write the failing tests**

Create `packages/data-schemas/src/methods/role.hierarchy.spec.ts`. Follow `role.methods.spec.ts` for the `mongodb-memory-server` + `createModels` setup (same imports, same `beforeAll`/`afterAll`).

```ts
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { SystemRoles } from 'librechat-data-provider';
import type { IRole } from '..';
import { createRoleMethods } from './role';
import { createModels } from '../models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let Role: mongoose.Model<IRole>;
let mongoServer: MongoMemoryServer;
let methods: ReturnType<typeof createRoleMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  Role = mongoose.models.Role;
  methods = createRoleMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Role.deleteMany({});
});

/** Seeds a tree:
 *  SUPERVISOR
 *    └── SALES_MANAGER
 *          └── SALES_EMPLOYEE
 *  SUPPORT_MANAGER (top-level, separate branch)
 *    └── SUPPORT_EMPLOYEE
 */
async function seedTree() {
  await Role.create([
    { name: 'SUPERVISOR', parentRole: null, depth: 0 },
    { name: 'SALES_MANAGER', parentRole: 'SUPERVISOR', depth: 1 },
    { name: 'SALES_EMPLOYEE', parentRole: 'SALES_MANAGER', depth: 2 },
    { name: 'SUPPORT_MANAGER', parentRole: null, depth: 0 },
    { name: 'SUPPORT_EMPLOYEE', parentRole: 'SUPPORT_MANAGER', depth: 1 },
  ]);
}

describe('hierarchy resolver', () => {
  describe('getAncestorRoleNames', () => {
    it('walks up to the root', async () => {
      await seedTree();
      await expect(methods.getAncestorRoleNames('SALES_EMPLOYEE')).resolves.toEqual([
        'SALES_MANAGER',
        'SUPERVISOR',
      ]);
    });

    it('returns an empty array for a top-level role', async () => {
      await seedTree();
      await expect(methods.getAncestorRoleNames('SUPERVISOR')).resolves.toEqual([]);
    });
  });

  describe('getDescendantRoleNames', () => {
    it('collects the whole subtree', async () => {
      await seedTree();
      const names = await methods.getDescendantRoleNames('SUPERVISOR');
      expect(new Set(names)).toEqual(new Set(['SALES_MANAGER', 'SALES_EMPLOYEE']));
    });

    it('returns an empty array for a leaf role', async () => {
      await seedTree();
      await expect(methods.getDescendantRoleNames('SALES_EMPLOYEE')).resolves.toEqual([]);
    });
  });

  describe('isDescendantOf / canViewRole', () => {
    it('confirms a deep descendant', async () => {
      await seedTree();
      await expect(methods.isDescendantOf('SALES_EMPLOYEE', 'SUPERVISOR')).resolves.toBe(true);
    });

    it('denies a sibling', async () => {
      await seedTree();
      await expect(methods.canViewRole('SALES_MANAGER', 'SUPPORT_EMPLOYEE')).resolves.toBe(false);
    });

    it('denies cross-branch access even at the same depth', async () => {
      await seedTree();
      await expect(methods.canViewRole('SUPPORT_MANAGER', 'SALES_EMPLOYEE')).resolves.toBe(false);
    });

    it('ADMIN can view any role, including USER', async () => {
      await seedTree();
      await expect(methods.canViewRole(SystemRoles.ADMIN, 'SALES_EMPLOYEE')).resolves.toBe(true);
      await expect(methods.canViewRole(SystemRoles.ADMIN, SystemRoles.USER)).resolves.toBe(true);
    });

    it('a hierarchy role can never view USER', async () => {
      await seedTree();
      await expect(methods.canViewRole('SUPERVISOR', SystemRoles.USER)).resolves.toBe(false);
    });
  });

  describe('wouldCreateCycle', () => {
    it('rejects a role as its own parent', async () => {
      await seedTree();
      await expect(methods.wouldCreateCycle('SUPERVISOR', 'SUPERVISOR')).resolves.toBe(true);
    });

    it('rejects moving a role under its own descendant', async () => {
      await seedTree();
      await expect(methods.wouldCreateCycle('SUPERVISOR', 'SALES_EMPLOYEE')).resolves.toBe(true);
    });

    it('allows moving a role to null (top-level)', async () => {
      await seedTree();
      await expect(methods.wouldCreateCycle('SALES_MANAGER', null)).resolves.toBe(false);
    });

    it('allows an unrelated move', async () => {
      await seedTree();
      await expect(methods.wouldCreateCycle('SALES_EMPLOYEE', 'SUPPORT_MANAGER')).resolves.toBe(
        false,
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/data-schemas && npx jest src/methods/role.hierarchy.spec.ts`
Expected: FAIL — `methods.getAncestorRoleNames is not a function` (and similarly for the other four).

- [ ] **Step 3: Implement the resolver functions**

In `packages/data-schemas/src/methods/role.ts`, add near the top of the function body (after `isAuthUserDocCacheEnabled`, before `createRoleMethods`'s inner functions, or as private helpers inside `createRoleMethods` — place them as private helpers inside `createRoleMethods` so they close over `mongoose` like every other method here):

```ts
interface RoleGraphNode {
  name: string;
  parentRole: string | null;
}

async function fetchRoleGraph(): Promise<RoleGraphNode[]> {
  const Role = mongoose.models.Role;
  return await Role.find({}, 'name parentRole').lean<RoleGraphNode[]>();
}

function buildChildrenMap(graph: RoleGraphNode[]): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const { name, parentRole } of graph) {
    if (!parentRole) continue;
    const siblings = children.get(parentRole) ?? [];
    siblings.push(name);
    children.set(parentRole, siblings);
  }
  return children;
}

async function getAncestorRoleNames(roleName: string): Promise<string[]> {
  const graph = await fetchRoleGraph();
  const parentByName = new Map(graph.map((r) => [r.name, r.parentRole]));
  const ancestors: string[] = [];
  const seen = new Set<string>([roleName]);
  let current = parentByName.get(roleName) ?? null;
  while (current && !seen.has(current)) {
    ancestors.push(current);
    seen.add(current);
    current = parentByName.get(current) ?? null;
  }
  return ancestors;
}

async function getDescendantRoleNames(roleName: string): Promise<string[]> {
  const graph = await fetchRoleGraph();
  const children = buildChildrenMap(graph);
  const descendants: string[] = [];
  const seen = new Set<string>();
  const queue = [...(children.get(roleName) ?? [])];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    descendants.push(next);
    queue.push(...(children.get(next) ?? []));
  }
  return descendants;
}

async function isDescendantOf(childRole: string, ancestorRole: string): Promise<boolean> {
  const ancestors = await getAncestorRoleNames(childRole);
  return ancestors.includes(ancestorRole);
}

async function canViewRole(actorRole: string, targetRole: string): Promise<boolean> {
  if (actorRole === SystemRoles.ADMIN) {
    return true;
  }
  return isDescendantOf(targetRole, actorRole);
}

async function wouldCreateCycle(
  roleName: string,
  newParentName: string | null,
): Promise<boolean> {
  if (!newParentName) {
    return false;
  }
  if (newParentName === roleName) {
    return true;
  }
  const descendants = await getDescendantRoleNames(roleName);
  return descendants.includes(newParentName);
}
```

Add the five functions to the object returned by `createRoleMethods` (the `return { ... }` at the bottom):

```ts
  return {
    listRoles,
    countRoles,
    initializeRoles,
    getRoleByName,
    findRolesByNames,
    updateRoleByName,
    updateAccessPermissions,
    migrateRoleSchema,
    createRoleByName,
    deleteRoleByName,
    updateUsersByRole,
    findUserIdsByRole,
    updateUsersRoleByIds,
    listUsersByRole,
    countUsersByRole,
    getAncestorRoleNames,
    getDescendantRoleNames,
    isDescendantOf,
    canViewRole,
    wouldCreateCycle,
  };
```

And add matching entries to the `createRoleMethods` return-type annotation at the top of the function signature (the big `): { ... }` block), in the same order:

```ts
  getAncestorRoleNames: (roleName: string) => Promise<string[]>;
  getDescendantRoleNames: (roleName: string) => Promise<string[]>;
  isDescendantOf: (childRole: string, ancestorRole: string) => Promise<boolean>;
  canViewRole: (actorRole: string, targetRole: string) => Promise<boolean>;
  wouldCreateCycle: (roleName: string, newParentName: string | null) => Promise<boolean>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/data-schemas && npx jest src/methods/role.hierarchy.spec.ts`
Expected: PASS (13 cases). If `mongodb-memory-server` fails to start on this machine (a known local issue — see project memory), note the failure reason and proceed; this test suite is written for CI/environments where it works.

- [ ] **Step 5: Typecheck**

Run: `cd packages/data-schemas && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/data-schemas/src/methods/role.ts packages/data-schemas/src/methods/role.hierarchy.spec.ts
git commit -m "feat(role): add hierarchy resolver (ancestors, descendants, canViewRole, cycle check)"
```

---

## Task 3: Hierarchy resolver — `setRoleParent` and `countChildRoles`

**Files:**
- Modify: `packages/data-schemas/src/methods/role.ts`
- Modify: `packages/data-schemas/src/methods/role.hierarchy.spec.ts`

**Interfaces:**
- Consumes: Task 2's `wouldCreateCycle`, `getDescendantRoleNames`; this file's existing `invalidateAuthUserDocCache`, `scopedCacheKey`, `CacheKeys.ROLES`.
- Produces:
  - `setRoleParent(roleName: string, newParentName: string | null): Promise<IRole>` — throws a plain `Error` for a missing/system-role parent, `RoleConflictError` for a cycle.
  - `countChildRoles(roleName: string): Promise<number>` — direct children only (sufficient for the delete-guard in Task 4; a role with any children blocks deletion regardless of subtree depth).

- [ ] **Step 1: Write the failing tests**

Append to `packages/data-schemas/src/methods/role.hierarchy.spec.ts`:

```ts
import { RoleConflictError } from './role';

describe('setRoleParent', () => {
  it('moves a role to a new parent and recomputes depth for its subtree', async () => {
    await seedTree();
    const updated = await methods.setRoleParent('SALES_MANAGER', 'SUPPORT_MANAGER');
    expect(updated.parentRole).toBe('SUPPORT_MANAGER');
    expect(updated.depth).toBe(1);

    const child = await Role.findOne({ name: 'SALES_EMPLOYEE' }).lean();
    expect(child?.depth).toBe(2);
  });

  it('moves a role to top-level (null parent)', async () => {
    await seedTree();
    const updated = await methods.setRoleParent('SALES_MANAGER', null);
    expect(updated.parentRole ?? null).toBeNull();
    expect(updated.depth).toBe(0);

    const child = await Role.findOne({ name: 'SALES_EMPLOYEE' }).lean();
    expect(child?.depth).toBe(1);
  });

  it('rejects a cycle', async () => {
    await seedTree();
    await expect(methods.setRoleParent('SUPERVISOR', 'SALES_EMPLOYEE')).rejects.toThrow(
      RoleConflictError,
    );
  });

  it('rejects a nonexistent parent', async () => {
    await seedTree();
    await expect(methods.setRoleParent('SALES_MANAGER', 'GHOST_ROLE')).rejects.toThrow();
  });

  it('rejects re-parenting a system role', async () => {
    await seedTree();
    await expect(methods.setRoleParent(SystemRoles.USER, 'SUPERVISOR')).rejects.toThrow();
  });

  it('rejects setting a system role as the parent', async () => {
    await seedTree();
    await expect(methods.setRoleParent('SALES_MANAGER', SystemRoles.ADMIN)).rejects.toThrow();
  });
});

describe('countChildRoles', () => {
  it('counts direct children only', async () => {
    await seedTree();
    await expect(methods.countChildRoles('SUPERVISOR')).resolves.toBe(1);
    await expect(methods.countChildRoles('SALES_EMPLOYEE')).resolves.toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/data-schemas && npx jest src/methods/role.hierarchy.spec.ts -t "setRoleParent|countChildRoles"`
Expected: FAIL — `methods.setRoleParent is not a function`.

- [ ] **Step 3: Implement `setRoleParent` and `countChildRoles`**

Add to `packages/data-schemas/src/methods/role.ts`, alongside the Task 2 helpers:

```ts
async function countChildRoles(roleName: string): Promise<number> {
  const Role = mongoose.models.Role;
  return await Role.countDocuments({ parentRole: roleName });
}

async function setRoleParent(roleName: string, newParentName: string | null): Promise<IRole> {
  if (isSystemRoleName(roleName)) {
    throw new Error(`Cannot re-parent system role: ${roleName}`);
  }
  if (newParentName != null && isSystemRoleName(newParentName)) {
    throw new Error(`Cannot set parent to system role: ${newParentName}`);
  }

  const Role = mongoose.models.Role as Model<IRole>;
  const User = mongoose.models.User as Model<IUser>;

  const parentDoc =
    newParentName != null
      ? ((await Role.findOne({ name: newParentName }, 'depth').lean()) as {
          depth?: number;
        } | null)
      : null;
  if (newParentName != null && !parentDoc) {
    throw new Error(`Parent role "${newParentName}" does not exist`);
  }
  if (await wouldCreateCycle(roleName, newParentName)) {
    throw new RoleConflictError(`Setting parent to "${newParentName}" would create a cycle`);
  }

  const graph = await fetchRoleGraph();
  const children = buildChildrenMap(graph);
  const newRootDepth = (parentDoc?.depth ?? -1) + 1;

  const depthByName = new Map<string, number>([[roleName, newRootDepth]]);
  const queue = [roleName];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const currentDepth = depthByName.get(current) as number;
    for (const child of children.get(current) ?? []) {
      depthByName.set(child, currentDepth + 1);
      queue.push(child);
    }
  }

  const affectedNames = [...depthByName.keys()];
  await Promise.all(
    affectedNames.map((name) =>
      Role.updateOne(
        { name },
        name === roleName
          ? { $set: { parentRole: newParentName, depth: newRootDepth } }
          : { $set: { depth: depthByName.get(name) } },
      ),
    ),
  );

  const [updatedRole, affectedUsers] = await Promise.all([
    Role.findOne({ name: roleName }).select('-__v').lean(),
    User.find({ role: { $in: affectedNames } }).select('_id').lean(),
  ]);

  const cache = deps.getCache?.(CacheKeys.ROLES);
  if (cache) {
    await Promise.all(affectedNames.map((name) => cache.set(scopedCacheKey(name), null)));
  }
  await invalidateAuthUserDocCache(affectedUsers.map((u) => u._id.toString()));

  if (!updatedRole) {
    throw new Error(`Role "${roleName}" not found after re-parenting`);
  }
  return updatedRole as unknown as IRole;
}
```

Add `countChildRoles` and `setRoleParent` to both the return-type interface and the `return { ... }` object, next to the Task 2 additions.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/data-schemas && npx jest src/methods/role.hierarchy.spec.ts`
Expected: PASS (all 19 cases across Tasks 2–3).

- [ ] **Step 5: Typecheck**

Run: `cd packages/data-schemas && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/data-schemas/src/methods/role.ts packages/data-schemas/src/methods/role.hierarchy.spec.ts
git commit -m "feat(role): add setRoleParent and countChildRoles"
```

---

## Task 4: Tree-aware role CRUD — create/delete/rename

**Files:**
- Modify: `packages/data-schemas/src/methods/role.ts`
- Modify: `packages/data-schemas/src/methods/role.methods.spec.ts`

**Interfaces:**
- Consumes: Task 3's `countChildRoles`.
- Produces:
  - `createRoleByName` now accepts `parentRole` on its `Partial<IRole>` input, validates it, and computes `depth`.
  - `deleteRoleByName` now throws `RoleConflictError` when the role has children.
  - `updateRoleByName` now repoints children when the update renames the role — internal to `role.ts`, so the API-layer rename path (`renameRole` → `updateRoleByName`, Task 9) needs no new wiring. Implemented via a private `repointChildRoles(oldParentName, newParentName)` helper (spec §6.2's `Role.updateMany({ parentRole: oldName }, { parentRole: newName })`), which also nulls the `CacheKeys.ROLES` entry for each repointed child.

- [ ] **Step 1: Write the failing tests**

Add to `packages/data-schemas/src/methods/role.methods.spec.ts`:

```ts
describe('createRoleByName with parentRole', () => {
  it('computes depth from the parent', async () => {
    await createRoleByName({ name: 'TREE_PARENT' });
    const child = await createRoleByName({ name: 'TREE_CHILD', parentRole: 'TREE_PARENT' });
    expect(child.parentRole).toBe('TREE_PARENT');
    expect(child.depth).toBe(1);
  });

  it('rejects a nonexistent parent', async () => {
    await expect(
      createRoleByName({ name: 'ORPHAN', parentRole: 'DOES_NOT_EXIST' }),
    ).rejects.toThrow();
  });

  it('rejects USER as a parent', async () => {
    await expect(
      createRoleByName({ name: 'BAD_CHILD', parentRole: SystemRoles.USER }),
    ).rejects.toThrow();
  });
});

describe('deleteRoleByName with children', () => {
  it('refuses to delete a role that has children', async () => {
    await createRoleByName({ name: 'DELETE_PARENT' });
    await createRoleByName({ name: 'DELETE_CHILD', parentRole: 'DELETE_PARENT' });
    await expect(deleteRoleByName('DELETE_PARENT')).rejects.toThrow(RoleConflictError);
  });

  it('deletes a childless role as before', async () => {
    await createRoleByName({ name: 'DELETE_LEAF' });
    await expect(deleteRoleByName('DELETE_LEAF')).resolves.not.toBeNull();
  });
});

describe('updateRoleByName repoints children on rename', () => {
  it('moves every child reference to the new name', async () => {
    await createRoleByName({ name: 'RENAME_OLD' });
    await createRoleByName({ name: 'RENAME_CHILD_A', parentRole: 'RENAME_OLD' });
    await createRoleByName({ name: 'RENAME_CHILD_B', parentRole: 'RENAME_OLD' });

    await methods.updateRoleByName('RENAME_OLD', { name: 'RENAME_NEW' });

    const a = await Role.findOne({ name: 'RENAME_CHILD_A' }).lean();
    const b = await Role.findOne({ name: 'RENAME_CHILD_B' }).lean();
    expect(a?.parentRole).toBe('RENAME_NEW');
    expect(b?.parentRole).toBe('RENAME_NEW');
  });

  it('leaves children untouched on a description-only update', async () => {
    await createRoleByName({ name: 'DESC_ONLY' });
    await createRoleByName({ name: 'DESC_ONLY_CHILD', parentRole: 'DESC_ONLY' });

    await methods.updateRoleByName('DESC_ONLY', { description: 'changed' });

    const child = await Role.findOne({ name: 'DESC_ONLY_CHILD' }).lean();
    expect(child?.parentRole).toBe('DESC_ONLY');
  });
});
```

(`RoleConflictError` and `SystemRoles` are already imported at the top of this spec file; add `let methods: ReturnType<typeof createRoleMethods>;` alongside the other `let` declarations if the file doesn't already keep the full `methods` object, assigning it in `beforeAll` next to the individual destructured bindings.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/data-schemas && npx jest src/methods/role.methods.spec.ts -t "parentRole|children|repoints children"`
Expected: FAIL — `createRoleByName` ignores `parentRole` (child ends up with `depth: 0`, `parentRole: null`), `deleteRoleByName` deletes the parent anyway, and `updateRoleByName` renames the role without repointing its children (`RENAME_CHILD_A.parentRole` stays `'RENAME_OLD'`).

- [ ] **Step 3: Implement the changes**

In `packages/data-schemas/src/methods/role.ts`, extend `createRoleByName` — after the existing duplicate-name check and before `let role;`:

```ts
    const { parentRole } = roleData;
    let depth = 0;
    if (parentRole != null) {
      if (isSystemRoleName(parentRole)) {
        throw new Error(`Cannot set parent to system role: ${parentRole}`);
      }
      const parent = await Role.findOne({ name: parentRole }, 'depth').lean();
      if (!parent) {
        throw new Error(`Parent role "${parentRole}" does not exist`);
      }
      depth = ((parent as { depth?: number }).depth ?? 0) + 1;
    }
```

Change the `new Role({ ...roleData, name: trimmed }).save()` call to:

```ts
      role = await new Role({
        ...roleData,
        name: trimmed,
        parentRole: parentRole ?? null,
        depth,
      }).save();
```

Extend `deleteRoleByName` — immediately after the `isSystemRoleName` guard at the top:

```ts
  async function deleteRoleByName(roleName: string): Promise<IRole | null> {
    if (isSystemRoleName(roleName)) {
      throw new Error(`Cannot delete system role: ${roleName}`);
    }
    const childCount = await countChildRoles(roleName);
    if (childCount > 0) {
      throw new RoleConflictError(
        `Cannot delete role "${roleName}": it has ${childCount} child role(s). Re-parent or delete them first.`,
      );
    }
    const Role = mongoose.models.Role;
    // ...unchanged body below...
```

Add a private `repointChildRoles` helper near `setRoleParent` (not exported on the return object — it is internal to `role.ts`):

```ts
async function repointChildRoles(oldParentName: string, newParentName: string): Promise<void> {
  const Role = mongoose.models.Role;
  const children = await Role.find({ parentRole: oldParentName }, 'name').lean();
  if (children.length === 0) {
    return;
  }
  await Role.updateMany({ parentRole: oldParentName }, { $set: { parentRole: newParentName } });
  const cache = deps.getCache?.(CacheKeys.ROLES);
  if (cache) {
    await Promise.all(
      children.map((c) => cache.set(scopedCacheKey((c as { name: string }).name), null)),
    );
  }
}
```

Call it from `updateRoleByName` on a rename — after the `findOneAndUpdate` succeeds and before the cache block, when `updates.name && updates.name !== roleName`:

```ts
      if (updates.name && updates.name !== roleName) {
        await repointChildRoles(roleName, updates.name);
      }
```

This keeps rename fan-out in one place: `renameRole` in `packages/api/src/admin/roles.ts` already routes every rename through `updateRoleByName`, so Task 9 needs no change for this.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/data-schemas && npx jest src/methods/role.methods.spec.ts`
Expected: PASS (full file, including the new cases).

- [ ] **Step 5: Typecheck**

Run: `cd packages/data-schemas && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/data-schemas/src/methods/role.ts packages/data-schemas/src/methods/role.methods.spec.ts
git commit -m "feat(role): make createRoleByName/deleteRoleByName tree-aware; add repointChildRoles"
```

---

## Task 5: New capability — `read:subordinates`

**Files:**
- Modify: `packages/data-schemas/src/admin/capabilities.ts`
- Modify: `packages/data-schemas/src/admin/capabilities.spec.ts`

**Interfaces:**
- Produces: `SystemCapabilities.VIEW_SUBORDINATES = 'read:subordinates'`, included in `CAPABILITY_CATEGORIES` under the `roles` category. Not added to `CapabilityImplications` in either direction.

- [ ] **Step 1: Write the failing test**

Append to `packages/data-schemas/src/admin/capabilities.spec.ts`:

```ts
it('recognizes read:subordinates as a valid base capability', () => {
  expect(SystemCapabilities.VIEW_SUBORDINATES).toBe('read:subordinates');
  expect(isValidCapability(SystemCapabilities.VIEW_SUBORDINATES)).toBe(true);
});

it('does not imply, or get implied by, access:admin or read:users', () => {
  expect(expandImplications([SystemCapabilities.VIEW_SUBORDINATES])).toEqual([
    SystemCapabilities.VIEW_SUBORDINATES,
  ]);
  expect(
    hasImpliedCapability([SystemCapabilities.ACCESS_ADMIN], SystemCapabilities.VIEW_SUBORDINATES),
  ).toBe(false);
});

it('lists read:subordinates under the roles category', () => {
  const rolesCategory = CAPABILITY_CATEGORIES.find((c) => c.key === 'roles');
  expect(rolesCategory?.capabilities).toContain(SystemCapabilities.VIEW_SUBORDINATES);
});
```

(Add `expandImplications`, `hasImpliedCapability`, `CAPABILITY_CATEGORIES`, `isValidCapability` to the file's existing import line from `./capabilities` if not already imported.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/data-schemas && npx jest src/admin/capabilities.spec.ts -t "read:subordinates"`
Expected: FAIL — `SystemCapabilities.VIEW_SUBORDINATES` is `undefined`.

- [ ] **Step 3: Add the capability**

In `packages/data-schemas/src/admin/capabilities.ts`, in the `SystemCapabilities` object, after `READ_ROLES`/`MANAGE_ROLES`:

```ts
  /** Lets a non-ADMIN role view/manage users and conversations whose role is a strict descendant of its own in the role hierarchy tree. Independent of ACCESS_ADMIN and READ_USERS — never implies, or is implied by, either. */
  VIEW_SUBORDINATES: 'read:subordinates',
```

In the `roles` entry of `CAPABILITY_CATEGORIES`:

```ts
  {
    key: 'roles',
    labelKey: 'com_cap_cat_roles',
    capabilities: [
      SystemCapabilities.MANAGE_ROLES,
      SystemCapabilities.READ_ROLES,
      SystemCapabilities.VIEW_SUBORDINATES,
    ],
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/data-schemas && npx jest src/admin/capabilities.spec.ts`
Expected: PASS (full file).

- [ ] **Step 5: Typecheck**

Run: `cd packages/data-schemas && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/data-schemas/src/admin/capabilities.ts packages/data-schemas/src/admin/capabilities.spec.ts
git commit -m "feat(capabilities): add read:subordinates capability"
```

---

## Task 6: `requireAnyCapability` middleware helper

**Files:**
- Modify: `packages/api/src/middleware/capabilities.ts`
- Modify: `packages/api/src/middleware/capabilities.spec.ts`
- Modify: `api/server/middleware/roles/capabilities.js`

**Interfaces:**
- Consumes: `hasCapability` (already produced by `generateCapabilityCheck`).
- Produces: `requireAnyCapability(capabilities: SystemCapability[]): (req, res, next) => Promise<void>` — passes if the caller holds any one of the listed capabilities, `403` otherwise. Added to `generateCapabilityCheck`'s return object and type.

- [ ] **Step 1: Write the failing test**

Append to `packages/api/src/middleware/capabilities.spec.ts` (reuse this file's existing `mockGetUserPrincipals`/`mockHasCapabilityForPrincipals` and the `generateCapabilityCheck` instance already constructed at the top of the `describe` block — destructure `requireAnyCapability` from it alongside the others):

```ts
describe('requireAnyCapability', () => {
  it('passes when the user holds the second-listed capability', async () => {
    mockGetUserPrincipals.mockResolvedValue(userPrincipals);
    mockHasCapabilityForPrincipals.mockImplementation(({ capability }) =>
      Promise.resolve(capability === SystemCapabilities.VIEW_SUBORDINATES),
    );
    const middleware = requireAnyCapability([
      SystemCapabilities.ACCESS_ADMIN,
      SystemCapabilities.VIEW_SUBORDINATES,
    ]);
    const req = { user: { id: 'user-456', role: 'USER' } } as unknown as ServerRequest;
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const res = { status, json } as unknown as Response;
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('returns 403 when the user holds none of the listed capabilities', async () => {
    mockGetUserPrincipals.mockResolvedValue(userPrincipals);
    mockHasCapabilityForPrincipals.mockResolvedValue(false);
    const middleware = requireAnyCapability([
      SystemCapabilities.ACCESS_ADMIN,
      SystemCapabilities.VIEW_SUBORDINATES,
    ]);
    const req = { user: { id: 'user-456', role: 'USER' } } as unknown as ServerRequest;
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const res = { status, json } as unknown as Response;
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });
});
```

Update the `const { hasCapability, requireCapability, ... }` destructuring at the top of the `describe('generateCapabilityCheck', ...)` block to include `requireAnyCapability`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/api && npx jest src/middleware/capabilities.spec.ts -t "requireAnyCapability"`
Expected: FAIL — `requireAnyCapability is not a function`.

- [ ] **Step 3: Implement `requireAnyCapability`**

In `packages/api/src/middleware/capabilities.ts`, add the type alongside `RequireCapabilityFn`:

```ts
export type RequireAnyCapabilityFn = (
  capabilities: SystemCapability[],
) => (req: ServerRequest, res: Response, next: NextFunction) => Promise<void>;
```

Add `requireAnyCapability` to the `generateCapabilityCheck` return-type object (next to `requireCapability`), then implement it inside the function body, right after `requireCapability`'s definition:

```ts
  function requireAnyCapability(capabilities: SystemCapability[]) {
    return async (req: ServerRequest, res: Response, next: NextFunction) => {
      try {
        if (!req.user) {
          res.status(401).json({ message: 'Authentication required' });
          return;
        }
        const id = req.user.id ?? req.user._id?.toString();
        if (!id) {
          res.status(401).json({ message: 'Authentication required' });
          return;
        }
        const user: CapabilityUser = {
          id,
          role: req.user.role ?? '',
          tenantId: (req.user as CapabilityUser).tenantId,
          idOnTheSource: req.user.idOnTheSource ?? null,
        };

        for (const capability of capabilities) {
          if (await hasCapability(user, capability)) {
            next();
            return;
          }
        }

        warnDeniedCapabilityOnce(
          `missing-any-capability:${id}:${capabilities.join(',')}`,
          `[requireAnyCapability] Forbidden: user ${id} missing all of [${capabilities.join(', ')}]`,
        );
        res.status(403).json({ message: 'Forbidden' });
      } catch (err) {
        logger.error(
          `[requireAnyCapability] Error checking capabilities: ${capabilities.join(', ')}`,
          err,
        );
        res.status(500).json({ message: 'Internal Server Error' });
      }
    };
  }
```

Add `requireAnyCapability` to the final `return { hasCapability, requireCapability, ... }` object.

In `api/server/middleware/roles/capabilities.js`, add `requireAnyCapability` to both the destructuring from `generateCapabilityCheck({...})` and the `module.exports`:

```js
const {
  hasCapability,
  requireCapability,
  requireAnyCapability,
  hasConfigCapability,
  getHeldCapabilities,
  hasAnyConfigReadAccess: checkAnyConfigReadAccess,
  getReadableConfigSections,
} = generateCapabilityCheck({ ... });

module.exports = {
  hasCapability,
  requireCapability,
  requireAnyCapability,
  hasConfigCapability,
  getHeldCapabilities,
  capabilityContextMiddleware,
  hasAnyConfigReadAccess: checkAnyConfigReadAccess,
  getReadableConfigSections,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/api && npx jest src/middleware/capabilities.spec.ts`
Expected: PASS (full file).

- [ ] **Step 5: Typecheck**

Run: `cd packages/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/middleware/capabilities.ts packages/api/src/middleware/capabilities.spec.ts api/server/middleware/roles/capabilities.js
git commit -m "feat(capabilities): add requireAnyCapability middleware"
```

---

## Task 7: Hierarchy middleware — `requireSubordinateAccess`, `attachHierarchyScope`

**Files:**
- Create: `packages/api/src/middleware/hierarchy.ts`
- Create: `packages/api/src/middleware/hierarchy.spec.ts`
- Modify: `packages/api/src/types/http.ts`

**Interfaces:**
- Consumes: `HasCapabilityFn`, `CapabilityUser` (from `./capabilities`); `SystemCapabilities` (`@librechat/data-schemas`).
- Produces:
  - `ServerRequest.hierarchyScope?: { viewableRoleNames: string[] } | null`
  - `createHierarchyMiddleware(deps: HierarchyDeps): { requireSubordinateAccess, attachHierarchyScope }`
  - `interface HierarchyDeps { hasCapability: HasCapabilityFn; findUsers: (...) => Promise<IUser[]>; canViewRole: (actorRole: string, targetRole: string) => Promise<boolean>; getDescendantRoleNames: (roleName: string) => Promise<string[]> }`

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/middleware/hierarchy.spec.ts`:

```ts
import { SystemCapabilities } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { createHierarchyMiddleware } from './hierarchy';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn() },
}));

function makeReqRes(user?: { id: string; role: string }, params: Record<string, string> = {}) {
  const req = { user, params } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  const next = jest.fn();
  return { req, res, status, json, next };
}

describe('requireSubordinateAccess', () => {
  it('allows an ADMIN unconditionally', async () => {
    const hasCapability = jest.fn().mockResolvedValue(true);
    const findUsers = jest.fn();
    const canViewRole = jest.fn();
    const getDescendantRoleNames = jest.fn();
    const { requireSubordinateAccess } = createHierarchyMiddleware({
      hasCapability,
      findUsers,
      canViewRole,
      getDescendantRoleNames,
    });
    const { req, res, next } = makeReqRes({ id: 'admin-1', role: 'ADMIN' }, { userId: 'u1' });

    await requireSubordinateAccess(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(findUsers).not.toHaveBeenCalled();
  });

  it('allows a VIEW_SUBORDINATES holder targeting a descendant', async () => {
    const hasCapability = jest.fn(
      (_u: unknown, cap: string) =>
        Promise.resolve(cap === SystemCapabilities.VIEW_SUBORDINATES) as Promise<boolean>,
    );
    const findUsers = jest.fn().mockResolvedValue([{ role: 'SALES_EMPLOYEE' }]);
    const canViewRole = jest.fn().mockResolvedValue(true);
    const getDescendantRoleNames = jest.fn();
    const { requireSubordinateAccess } = createHierarchyMiddleware({
      hasCapability,
      findUsers,
      canViewRole,
      getDescendantRoleNames,
    });
    const { req, res, next } = makeReqRes(
      { id: 'mgr-1', role: 'SALES_MANAGER' },
      { userId: 'u1' },
    );

    await requireSubordinateAccess(req, res, next);

    expect(canViewRole).toHaveBeenCalledWith('SALES_MANAGER', 'SALES_EMPLOYEE');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('denies a VIEW_SUBORDINATES holder targeting a non-descendant', async () => {
    const hasCapability = jest.fn(
      (_u: unknown, cap: string) =>
        Promise.resolve(cap === SystemCapabilities.VIEW_SUBORDINATES) as Promise<boolean>,
    );
    const findUsers = jest.fn().mockResolvedValue([{ role: 'SUPPORT_EMPLOYEE' }]);
    const canViewRole = jest.fn().mockResolvedValue(false);
    const getDescendantRoleNames = jest.fn();
    const { requireSubordinateAccess } = createHierarchyMiddleware({
      hasCapability,
      findUsers,
      canViewRole,
      getDescendantRoleNames,
    });
    const { req, res, next, status } = makeReqRes(
      { id: 'mgr-1', role: 'SALES_MANAGER' },
      { userId: 'u1' },
    );

    await requireSubordinateAccess(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it('denies a caller with none of the qualifying capabilities', async () => {
    const hasCapability = jest.fn().mockResolvedValue(false);
    const findUsers = jest.fn();
    const canViewRole = jest.fn();
    const getDescendantRoleNames = jest.fn();
    const { requireSubordinateAccess } = createHierarchyMiddleware({
      hasCapability,
      findUsers,
      canViewRole,
      getDescendantRoleNames,
    });
    const { req, res, next, status } = makeReqRes({ id: 'u-1', role: 'USER' }, { userId: 'u2' });

    await requireSubordinateAccess(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });
});

describe('attachHierarchyScope', () => {
  it('sets a null scope for ADMIN', async () => {
    const hasCapability = jest.fn(
      (_u: unknown, cap: string) =>
        Promise.resolve(cap === SystemCapabilities.ACCESS_ADMIN) as Promise<boolean>,
    );
    const getDescendantRoleNames = jest.fn();
    const { attachHierarchyScope } = createHierarchyMiddleware({
      hasCapability,
      findUsers: jest.fn(),
      canViewRole: jest.fn(),
      getDescendantRoleNames,
    });
    const { req, res, next } = makeReqRes({ id: 'admin-1', role: 'ADMIN' });

    await attachHierarchyScope(req, res, next);

    expect(req.hierarchyScope).toBeNull();
    expect(getDescendantRoleNames).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sets viewableRoleNames for a VIEW_SUBORDINATES holder', async () => {
    const hasCapability = jest.fn(
      (_u: unknown, cap: string) =>
        Promise.resolve(cap === SystemCapabilities.VIEW_SUBORDINATES) as Promise<boolean>,
    );
    const getDescendantRoleNames = jest.fn().mockResolvedValue(['SALES_EMPLOYEE']);
    const { attachHierarchyScope } = createHierarchyMiddleware({
      hasCapability,
      findUsers: jest.fn(),
      canViewRole: jest.fn(),
      getDescendantRoleNames,
    });
    const { req, res, next } = makeReqRes({ id: 'mgr-1', role: 'SALES_MANAGER' });

    await attachHierarchyScope(req, res, next);

    expect(req.hierarchyScope).toEqual({ viewableRoleNames: ['SALES_EMPLOYEE'] });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && npx jest src/middleware/hierarchy.spec.ts`
Expected: FAIL — `Cannot find module './hierarchy'`.

- [ ] **Step 3: Write the middleware**

Create `packages/api/src/middleware/hierarchy.ts`:

```ts
import { logger, SystemCapabilities } from '@librechat/data-schemas';
import type { IUser } from '@librechat/data-schemas';
import type { NextFunction, Response } from 'express';
import type { FilterQuery } from 'mongoose';
import type { ServerRequest } from '~/types/http';
import type { HasCapabilityFn, CapabilityUser } from './capabilities';

export interface HierarchyDeps {
  hasCapability: HasCapabilityFn;
  findUsers: (
    filter: FilterQuery<IUser>,
    fields?: string | string[] | null,
    options?: { limit?: number },
  ) => Promise<IUser[]>;
  canViewRole: (actorRole: string, targetRole: string) => Promise<boolean>;
  getDescendantRoleNames: (roleName: string) => Promise<string[]>;
}

type HierarchyMiddleware = (
  req: ServerRequest,
  res: Response,
  next: NextFunction,
) => Promise<void>;

function toCapabilityUser(req: ServerRequest): CapabilityUser | null {
  if (!req.user) {
    return null;
  }
  const id = req.user.id ?? req.user._id?.toString();
  if (!id) {
    return null;
  }
  return {
    id,
    role: req.user.role ?? '',
    tenantId: (req.user as CapabilityUser).tenantId,
    idOnTheSource: req.user.idOnTheSource ?? null,
  };
}

export function createHierarchyMiddleware(deps: HierarchyDeps): {
  requireSubordinateAccess: HierarchyMiddleware;
  attachHierarchyScope: HierarchyMiddleware;
} {
  const { hasCapability, findUsers, canViewRole, getDescendantRoleNames } = deps;

  const requireSubordinateAccess: HierarchyMiddleware = async (req, res, next) => {
    try {
      const user = toCapabilityUser(req);
      if (!user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }
      if (await hasCapability(user, SystemCapabilities.ACCESS_ADMIN)) {
        next();
        return;
      }
      if (await hasCapability(user, SystemCapabilities.READ_USERS)) {
        next();
        return;
      }
      if (await hasCapability(user, SystemCapabilities.VIEW_SUBORDINATES)) {
        const { userId } = req.params as { userId?: string };
        if (!userId) {
          res.status(400).json({ error: 'userId is required' });
          return;
        }
        const [target] = await findUsers({ _id: userId }, 'role', { limit: 1 });
        if (!target) {
          res.status(404).json({ error: 'User not found' });
          return;
        }
        if (await canViewRole(user.role, target.role ?? '')) {
          next();
          return;
        }
      }
      res.status(403).json({ message: 'Forbidden' });
    } catch (err) {
      logger.error('[requireSubordinateAccess] error:', err);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  };

  const attachHierarchyScope: HierarchyMiddleware = async (req, res, next) => {
    try {
      const user = toCapabilityUser(req);
      if (!user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }
      const unscoped =
        (await hasCapability(user, SystemCapabilities.ACCESS_ADMIN)) ||
        (await hasCapability(user, SystemCapabilities.READ_USERS));
      if (unscoped) {
        req.hierarchyScope = null;
        next();
        return;
      }
      if (await hasCapability(user, SystemCapabilities.VIEW_SUBORDINATES)) {
        req.hierarchyScope = { viewableRoleNames: await getDescendantRoleNames(user.role) };
        next();
        return;
      }
      res.status(403).json({ message: 'Forbidden' });
    } catch (err) {
      logger.error('[attachHierarchyScope] error:', err);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  };

  return { requireSubordinateAccess, attachHierarchyScope };
}
```

In `packages/api/src/types/http.ts`, add to the `ServerRequest` type intersection (after `authStrategy?: string;`):

```ts
  /** Set by `attachHierarchyScope` for a non-ADMIN, non-READ_USERS caller: the role names
   *  they may see. `null` means unscoped (ADMIN or a generic READ_USERS grant). */
  hierarchyScope?: { viewableRoleNames: string[] } | null;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && npx jest src/middleware/hierarchy.spec.ts`
Expected: PASS (6 cases).

- [ ] **Step 5: Typecheck**

Run: `cd packages/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/middleware/hierarchy.ts packages/api/src/middleware/hierarchy.spec.ts packages/api/src/types/http.ts
git commit -m "feat(hierarchy): add requireSubordinateAccess and attachHierarchyScope middleware"
```

---

## Task 8: `GET /api/admin/hierarchy/me`

**Files:**
- Create: `packages/api/src/admin/hierarchy.ts`
- Create: `packages/api/src/admin/hierarchy.spec.ts`
- Modify: `packages/api/src/admin/index.ts`

**Interfaces:**
- Consumes: `HasCapabilityFn`; `getDescendantRoleNames` (Task 2).
- Produces: `createAdminHierarchyHandlers(deps: AdminHierarchyDeps): { getMyHierarchy: (req, res) => Promise<Response> }`, response shape `{ isAdmin: boolean; canViewSubordinates: boolean; viewableRoleNames: string[]; manageableRoleNames: string[] }` (matching `TMyHierarchy`, added in Task 12).

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/admin/hierarchy.spec.ts`. Follow `packages/api/src/admin/users.spec.ts` for the `createReqRes` helper shape.

```ts
import { SystemRoles, SystemCapabilities } from 'librechat-data-provider';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { createAdminHierarchyHandlers } from './hierarchy';

function createReqRes(user?: { id?: string; role?: string }) {
  const req = { user } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { req, res, status, json };
}

describe('createAdminHierarchyHandlers', () => {
  it('returns full access for ADMIN without calling getDescendantRoleNames', async () => {
    const getDescendantRoleNames = jest.fn();
    const handlers = createAdminHierarchyHandlers({
      hasCapability: jest.fn().mockResolvedValue(true),
      getDescendantRoleNames,
    });
    const { req, res, json } = createReqRes({ id: 'admin-1', role: SystemRoles.ADMIN });

    await handlers.getMyHierarchy(req, res);

    expect(json).toHaveBeenCalledWith({
      isAdmin: true,
      canViewSubordinates: true,
      viewableRoleNames: [],
      manageableRoleNames: [],
    });
    expect(getDescendantRoleNames).not.toHaveBeenCalled();
  });

  it('returns the descendant role names for a VIEW_SUBORDINATES holder', async () => {
    const hasCapability = jest
      .fn()
      .mockImplementation((_u, cap) =>
        Promise.resolve(cap === SystemCapabilities.VIEW_SUBORDINATES),
      );
    const getDescendantRoleNames = jest.fn().mockResolvedValue(['SALES_EMPLOYEE']);
    const handlers = createAdminHierarchyHandlers({ hasCapability, getDescendantRoleNames });
    const { req, res, json } = createReqRes({ id: 'mgr-1', role: 'SALES_MANAGER' });

    await handlers.getMyHierarchy(req, res);

    expect(json).toHaveBeenCalledWith({
      isAdmin: false,
      canViewSubordinates: true,
      viewableRoleNames: ['SALES_EMPLOYEE'],
      manageableRoleNames: ['SALES_EMPLOYEE'],
    });
  });

  it('returns empty access for a plain USER', async () => {
    const getDescendantRoleNames = jest.fn();
    const handlers = createAdminHierarchyHandlers({
      hasCapability: jest.fn().mockResolvedValue(false),
      getDescendantRoleNames,
    });
    const { req, res, json } = createReqRes({ id: 'u-1', role: SystemRoles.USER });

    await handlers.getMyHierarchy(req, res);

    expect(json).toHaveBeenCalledWith({
      isAdmin: false,
      canViewSubordinates: false,
      viewableRoleNames: [],
      manageableRoleNames: [],
    });
    expect(getDescendantRoleNames).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    const handlers = createAdminHierarchyHandlers({
      hasCapability: jest.fn(),
      getDescendantRoleNames: jest.fn(),
    });
    const { req, res, status } = createReqRes(undefined);

    await handlers.getMyHierarchy(req, res);

    expect(status).toHaveBeenCalledWith(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && npx jest src/admin/hierarchy.spec.ts`
Expected: FAIL — `Cannot find module './hierarchy'`.

- [ ] **Step 3: Write the handler**

Create `packages/api/src/admin/hierarchy.ts`:

```ts
import { logger } from '@librechat/data-schemas';
import { SystemRoles, SystemCapabilities } from 'librechat-data-provider';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { HasCapabilityFn } from '~/middleware/capabilities';

export interface AdminHierarchyDeps {
  hasCapability: HasCapabilityFn;
  getDescendantRoleNames: (roleName: string) => Promise<string[]>;
}

export function createAdminHierarchyHandlers(deps: AdminHierarchyDeps): {
  getMyHierarchy: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const { hasCapability, getDescendantRoleNames } = deps;

  async function getMyHierarchyHandler(req: ServerRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Authentication required' });
      }
      const id = req.user.id ?? req.user._id?.toString() ?? '';
      const role = req.user.role ?? '';
      const capabilityUser = { id, role, tenantId: (req.user as { tenantId?: string }).tenantId };

      const isAdmin =
        role === SystemRoles.ADMIN ||
        (await hasCapability(capabilityUser, SystemCapabilities.ACCESS_ADMIN));
      if (isAdmin) {
        return res.status(200).json({
          isAdmin: true,
          canViewSubordinates: true,
          viewableRoleNames: [],
          manageableRoleNames: [],
        });
      }

      const canViewSubordinates = await hasCapability(
        capabilityUser,
        SystemCapabilities.VIEW_SUBORDINATES,
      );
      const roleNames = canViewSubordinates ? await getDescendantRoleNames(role) : [];

      return res.status(200).json({
        isAdmin: false,
        canViewSubordinates,
        viewableRoleNames: roleNames,
        manageableRoleNames: roleNames,
      });
    } catch (error) {
      logger.error('[adminHierarchy] getMyHierarchy error:', error);
      return res.status(500).json({ error: 'Failed to resolve hierarchy access' });
    }
  }

  return { getMyHierarchy: getMyHierarchyHandler };
}
```

In `packages/api/src/admin/index.ts`, add:

```ts
export { createAdminHierarchyHandlers } from './hierarchy';
export type { AdminHierarchyDeps } from './hierarchy';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && npx jest src/admin/hierarchy.spec.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: Typecheck**

Run: `cd packages/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/admin/hierarchy.ts packages/api/src/admin/hierarchy.spec.ts packages/api/src/admin/index.ts
git commit -m "feat(admin): add GET /api/admin/hierarchy/me handler"
```

---

## Task 9: `admin/roles.ts` — tree-aware create/update, child-count delete guard

**Files:**
- Modify: `packages/api/src/admin/roles.ts`
- Modify: `packages/api/src/admin/roles.spec.ts`

**Interfaces:**
- Consumes: Tasks 3–4's `setRoleParent`, `countChildRoles` (child-repointing on rename is handled inside `updateRoleByName` per Task 4 — no dep needed here); `grantCapability` (existing `packages/data-schemas` systemGrant method, already used by `api/server/routes/admin/grants.js` as `db.grantCapability`).
- Produces: `AdminRolesDeps` gains `setRoleParent`, `countChildRoles`, `grantCapability`; `createRoleHandler` accepts `parentRole` in the body and grants `VIEW_SUBORDINATES` on success; `updateRoleHandler` accepts `parentRole` and re-parents via `setRoleParent`; `deleteRoleHandler` returns `409` with the child count instead of deleting.

- [ ] **Step 1: Write the failing tests**

Follow `packages/api/src/admin/roles.spec.ts`'s existing `createDeps`/`createReqRes` helpers (same shape as `users.spec.ts`, seen in Task 8's reference). Add `setRoleParent: jest.fn()`, `countChildRoles: jest.fn().mockResolvedValue(0)`, `grantCapability: jest.fn().mockResolvedValue({ grant: null, created: true })` to the deps factory's defaults, then append:

```ts
describe('createRole with parentRole', () => {
  it('grants VIEW_SUBORDINATES to the new role', async () => {
    const grantCapability = jest.fn().mockResolvedValue({ grant: null, created: true });
    const deps = createDeps({
      grantCapability,
      createRoleByName: jest.fn().mockResolvedValue({ name: 'SALES_MANAGER', parentRole: null, depth: 0 }),
    });
    const handlers = createAdminRolesHandlers(deps);
    const { req, res, status } = createReqRes({ body: { name: 'SALES_MANAGER' } });

    await handlers.createRole(req, res);

    expect(status).toHaveBeenCalledWith(201);
    expect(grantCapability).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: 'SALES_MANAGER', capability: 'read:subordinates' }),
    );
  });
});

describe('updateRole re-parenting', () => {
  it('calls setRoleParent when parentRole is in the body', async () => {
    const setRoleParent = jest.fn().mockResolvedValue({ name: 'SALES_MANAGER', parentRole: 'SUPERVISOR', depth: 1 });
    const deps = createDeps({
      setRoleParent,
      getRoleByName: jest.fn().mockResolvedValue({ name: 'SALES_MANAGER' }),
    });
    const handlers = createAdminRolesHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { name: 'SALES_MANAGER' },
      body: { parentRole: 'SUPERVISOR' },
    });

    await handlers.updateRole(req, res);

    expect(setRoleParent).toHaveBeenCalledWith('SALES_MANAGER', 'SUPERVISOR');
    expect(status).toHaveBeenCalledWith(200);
  });

  it('returns 400 when setRoleParent rejects a cycle', async () => {
    const { RoleConflictError } = jest.requireActual('@librechat/data-schemas');
    const setRoleParent = jest.fn().mockRejectedValue(new RoleConflictError('cycle'));
    const deps = createDeps({
      setRoleParent,
      getRoleByName: jest.fn().mockResolvedValue({ name: 'SALES_MANAGER' }),
    });
    const handlers = createAdminRolesHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { name: 'SALES_MANAGER' },
      body: { parentRole: 'SALES_EMPLOYEE' },
    });

    await handlers.updateRole(req, res);

    expect(status).toHaveBeenCalledWith(400);
  });
});

describe('deleteRole with children', () => {
  it('returns 409 with the child count instead of deleting', async () => {
    const countChildRoles = jest.fn().mockResolvedValue(2);
    const deleteRoleByName = jest.fn();
    const deps = createDeps({ countChildRoles, deleteRoleByName });
    const handlers = createAdminRolesHandlers(deps);
    const { req, res, status, json } = createReqRes({ params: { name: 'SUPERVISOR' } });

    await handlers.deleteRole(req, res);

    expect(deleteRoleByName).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('2') }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/api && npx jest src/admin/roles.spec.ts -t "parentRole|re-parenting|children"`
Expected: FAIL — `createDeps` doesn't accept `setRoleParent`/`countChildRoles`/`grantCapability` (TS error) and the handlers ignore `parentRole` entirely.

- [ ] **Step 3: Implement the changes**

In `packages/api/src/admin/roles.ts`, extend `AdminRolesDeps`:

```ts
  /** Sets/changes a role's position in the hierarchy tree; throws RoleConflictError on a cycle. */
  setRoleParent: (roleName: string, newParentName: string | null) => Promise<IRole>;
  /** Direct-children count — a nonzero count blocks deletion. */
  countChildRoles: (roleName: string) => Promise<number>;
  /** Grants a system capability to a principal (role/user/group); used to auto-grant VIEW_SUBORDINATES on custom-role creation. */
  grantCapability: (params: {
    principalType: PrincipalType;
    principalId: string;
    capability: string;
  }) => Promise<{ grant: unknown; created: boolean }>;
```

Destructure the three new deps in `createAdminRolesHandlers`.

In `createRoleHandler`, after the `permissions` object-shape check and before building `roleData`, read `parentRole` from the body and pass it through:

```ts
      const { name, description, permissions, parentRole } = req.body as {
        name?: string;
        description?: string;
        permissions?: IRole['permissions'];
        parentRole?: string | null;
      };
```

Add `parentRole` to `roleData` when present:

```ts
      const roleData: Partial<IRole> = {
        name: (name as string).trim(),
        permissions: permissions ?? {},
      };
      if (description !== undefined) {
        roleData.description = description;
      }
      if (parentRole !== undefined) {
        roleData.parentRole = parentRole;
      }
      const role = await createRoleByName(roleData);
      await grantCapability({
        principalType: PrincipalType.ROLE,
        principalId: role.name,
        capability: SystemCapabilities.VIEW_SUBORDINATES,
      });
      return res.status(201).json({ role });
```

(Import `SystemCapabilities` from `@librechat/data-schemas` at the top of the file, alongside the existing `logger`/`isValidObjectIdString`/`RoleConflictError` import.)

In `updateRoleHandler`, after the existing `description`/`name` validation and the `existing` lookup, branch on `parentRole` before the rename logic:

```ts
      const body = req.body as { name?: string; description?: string; parentRole?: string | null };
      // ...existing nameError/descError checks unchanged...

      if (body.parentRole !== undefined) {
        try {
          const role = await setRoleParent(name, body.parentRole);
          return res.status(200).json({ role });
        } catch (error) {
          if (error instanceof RoleConflictError) {
            return res.status(400).json({ error: error.message });
          }
          throw error;
        }
      }

      // ...existing rename/description-only logic unchanged below...
```

(A body carrying both `parentRole` and `name`/`description` in the same request is out of scope for v1 — the client never sends both at once (Task 15 keeps the "Reports to" picker and the rename/description fields as separate saves); this branch handles `parentRole` alone and returns before reaching the rename path.)

In `deleteRoleHandler`, right after the `isSystemRoleName` guard:

```ts
      const childCount = await countChildRoles(name);
      if (childCount > 0) {
        return res.status(409).json({
          error: `Cannot delete role "${name}": it has ${childCount} child role(s). Re-parent or delete them first.`,
        });
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/api && npx jest src/admin/roles.spec.ts`
Expected: PASS (full file).

- [ ] **Step 5: Typecheck**

Run: `cd packages/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/admin/roles.ts packages/api/src/admin/roles.spec.ts
git commit -m "feat(admin): tree-aware role create/update, child-count delete guard"
```

---

## Task 10: `admin/users.ts` — hierarchy-scoped list/search, role reassignment

**Files:**
- Modify: `packages/api/src/admin/users.ts`
- Modify: `packages/api/src/admin/users.spec.ts`

**Interfaces:**
- Consumes: `req.hierarchyScope` (Task 7); `canViewRole` (Task 2); existing `updateUsersRoleByIds` (`packages/data-schemas`, already spread onto `db`).
- Produces: `listUsersHandler`/`searchUsersHandler` apply `{ role: { $in: viewableRoleNames } }` when `req.hierarchyScope` is set; new `AdminUsersDeps.updateUsersRoleByIds` and `AdminUsersDeps.canViewRole`; new exported handler `reassignUserRole: (req, res) => Promise<Response>` on the object `createAdminUsersHandlers` returns.

- [ ] **Step 1: Write the failing tests**

Add to `packages/api/src/admin/users.spec.ts`'s `createDeps` defaults: `updateUsersRoleByIds: jest.fn().mockResolvedValue(undefined)`, `canViewRole: jest.fn().mockResolvedValue(true)`. Then append:

```ts
describe('listUsers with hierarchyScope', () => {
  it('filters by viewableRoleNames when hierarchyScope is set', async () => {
    const findUsers = jest.fn().mockResolvedValue([]);
    const deps = createDeps({ findUsers });
    const handlers = createAdminUsersHandlers(deps);
    const { req, res } = createReqRes({ query: {} });
    (req as unknown as { hierarchyScope: unknown }).hierarchyScope = {
      viewableRoleNames: ['SALES_EMPLOYEE'],
    };

    await handlers.listUsers(req, res);

    expect(findUsers).toHaveBeenCalledWith(
      { role: { $in: ['SALES_EMPLOYEE'] } },
      expect.any(String),
      expect.any(Object),
    );
  });

  it('applies no role filter when hierarchyScope is null', async () => {
    const findUsers = jest.fn().mockResolvedValue([]);
    const deps = createDeps({ findUsers });
    const handlers = createAdminUsersHandlers(deps);
    const { req, res } = createReqRes({ query: {} });
    (req as unknown as { hierarchyScope: unknown }).hierarchyScope = null;

    await handlers.listUsers(req, res);

    expect(findUsers).toHaveBeenCalledWith({}, expect.any(String), expect.any(Object));
  });
});

describe('searchUsers with hierarchyScope', () => {
  it('adds the role filter alongside the $or search clause', async () => {
    const findUsers = jest.fn().mockResolvedValue([]);
    const deps = createDeps({ findUsers });
    const handlers = createAdminUsersHandlers(deps);
    const { req, res } = createReqRes({ query: { q: 'ali' } });
    (req as unknown as { hierarchyScope: unknown }).hierarchyScope = {
      viewableRoleNames: ['SALES_EMPLOYEE'],
    };

    await handlers.searchUsers(req, res);

    const [filter] = findUsers.mock.calls[0] as [Record<string, unknown>];
    expect(filter.role).toEqual({ $in: ['SALES_EMPLOYEE'] });
    expect(filter.$or).toBeDefined();
  });
});

describe('reassignUserRole', () => {
  it('reassigns when the middleware already proved the current role is viewable, and the target role is also viewable', async () => {
    const findUsers = jest.fn().mockResolvedValue([{ role: 'SALES_EMPLOYEE' }]);
    const updateUsersRoleByIds = jest.fn().mockResolvedValue(undefined);
    const canViewRole = jest.fn().mockResolvedValue(true);
    const deps = createDeps({ findUsers, updateUsersRoleByIds, canViewRole });
    const handlers = createAdminUsersHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { userId: validUserId },
      body: { role: 'SALES_EMPLOYEE_TIER_2' },
      user: { id: 'mgr-1', role: 'SALES_MANAGER' },
    });

    await handlers.reassignUserRole(req, res);

    expect(canViewRole).toHaveBeenCalledWith('SALES_MANAGER', 'SALES_EMPLOYEE_TIER_2');
    expect(updateUsersRoleByIds).toHaveBeenCalledWith([validUserId], 'SALES_EMPLOYEE_TIER_2');
    expect(status).toHaveBeenCalledWith(200);
  });

  it('rejects reassigning to a role outside the actor’s subtree', async () => {
    const findUsers = jest.fn().mockResolvedValue([{ role: 'SALES_EMPLOYEE' }]);
    const updateUsersRoleByIds = jest.fn();
    const canViewRole = jest.fn().mockResolvedValue(false);
    const deps = createDeps({ findUsers, updateUsersRoleByIds, canViewRole });
    const handlers = createAdminUsersHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { userId: validUserId },
      body: { role: 'SUPPORT_MANAGER' },
      user: { id: 'mgr-1', role: 'SALES_MANAGER' },
    });

    await handlers.reassignUserRole(req, res);

    expect(updateUsersRoleByIds).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it('rejects an actor reassigning their own role (never a strict descendant of itself)', async () => {
    const findUsers = jest.fn().mockResolvedValue([{ role: 'SALES_MANAGER' }]);
    const updateUsersRoleByIds = jest.fn();
    const canViewRole = jest.fn().mockResolvedValue(false);
    const deps = createDeps({ findUsers, updateUsersRoleByIds, canViewRole });
    const handlers = createAdminUsersHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { userId: 'mgr-1' },
      body: { role: 'SALES_EMPLOYEE' },
      user: { id: 'mgr-1', role: 'SALES_MANAGER' },
    });

    await handlers.reassignUserRole(req, res);

    expect(status).toHaveBeenCalledWith(403);
  });

  it('returns 400 for a malformed userId', async () => {
    const deps = createDeps();
    const handlers = createAdminUsersHandlers(deps);
    const { req, res, status } = createReqRes({ params: { userId: 'not-an-id' }, body: { role: 'X' } });

    await handlers.reassignUserRole(req, res);

    expect(status).toHaveBeenCalledWith(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/api && npx jest src/admin/users.spec.ts -t "hierarchyScope|reassignUserRole"`
Expected: FAIL — `handlers.reassignUserRole is not a function`, and `listUsers`/`searchUsers` call `findUsers` without a role filter regardless of `hierarchyScope`.

- [ ] **Step 3: Implement the changes**

In `packages/api/src/admin/users.ts`, extend `AdminUsersDeps`:

```ts
  updateUsersRoleByIds: (userIds: string[], newRole: string) => Promise<void>;
  canViewRole: (actorRole: string, targetRole: string) => Promise<boolean>;
```

Destructure both in `createAdminUsersHandlers`.

Add a small helper near `USER_LIST_FIELDS`:

```ts
function withHierarchyScope(
  filter: FilterQuery<IUser>,
  scope: ServerRequest['hierarchyScope'],
): FilterQuery<IUser> {
  if (!scope) {
    return filter;
  }
  return { ...filter, role: { $in: scope.viewableRoleNames } };
}
```

In `listUsersHandler`, change the `findUsers({}, ...)` call to:

```ts
      const filter = withHierarchyScope({}, req.hierarchyScope);
      const [users, total] = await Promise.all([
        findUsers(filter, USER_LIST_FIELDS, { limit, offset, sort: { createdAt: -1 } }),
        countUsers(filter),
      ]);
```

In `searchUsersHandler`, change the `findUsers({ $or: [...] }, ...)` call to:

```ts
      const users = await findUsers(
        withHierarchyScope({ $or: [{ name: regex }, { email: regex }, { username: regex }] }, req.hierarchyScope),
        '_id name email username avatar',
        { limit: searchLimit, sort: { name: 1 } },
      );
```

Add the new handler, after `deleteUserHandler`:

```ts
  async function reassignUserRoleHandler(req: ServerRequest, res: Response) {
    try {
      const { userId } = req.params as { userId: string };
      if (!isValidObjectIdString(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }
      const { role: requestedRole } = req.body as { role?: string };
      if (!requestedRole || typeof requestedRole !== 'string') {
        return res.status(400).json({ error: 'role is required' });
      }

      const actorRole = req.user?.role ?? '';
      const [target] = await findUsers({ _id: userId }, 'role', { limit: 1 });
      if (!target) {
        return res.status(404).json({ error: 'User not found' });
      }

      /** `requireSubordinateAccess` already proved the actor may see `target.role`
       *  (ADMIN, a generic READ_USERS grant, or a hierarchy descendant check) before
       *  this handler runs. A VIEW_SUBORDINATES-only actor must additionally be
       *  allowed to see the *requested* role — the two-sided check the design calls
       *  for. ADMIN/READ_USERS callers skip straight through: canViewRole(ADMIN, x)
       *  is always true, and a generic READ_USERS grant is treated the same as
       *  ADMIN for this endpoint, matching the middleware's own precedence. */
      const canAssign = await canViewRole(actorRole, requestedRole);
      if (!canAssign) {
        return res.status(403).json({ error: 'Cannot assign a role outside your hierarchy' });
      }

      await updateUsersRoleByIds([userId], requestedRole);
      return res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[adminUsers] reassignUserRole error:', error);
      return res.status(500).json({ error: 'Failed to reassign role' });
    }
  }
```

Add `reassignUserRole: reassignUserRoleHandler` to the returned object and its type signature.

Note: for an ADMIN or generic-`READ_USERS` actor, `canViewRole(actorRole, requestedRole)` is only guaranteed `true` when `actorRole === SystemRoles.ADMIN` — a `READ_USERS`-holding non-ADMIN principal (a rare, manually-granted case per the spec) is not itself special-cased in `canViewRole`. Since this is an existing, pre-this-feature possibility and not part of the hierarchy tree, leave it as a known limitation: such a principal can view any user via `READ_USERS` but can only *reassign* within its own hierarchy visibility (typically none, since it isn't a tree node) — document this in a one-line code comment above `canAssign` rather than expanding scope to handle it, since no such grant exists in this codebase today outside ADMIN.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/api && npx jest src/admin/users.spec.ts`
Expected: PASS (full file).

- [ ] **Step 5: Typecheck**

Run: `cd packages/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/admin/users.ts packages/api/src/admin/users.spec.ts
git commit -m "feat(admin): hierarchy-scoped user list/search, add role reassignment endpoint"
```

---

## Task 11: Route wiring — widen the users-router gate, mount the hierarchy router, add the reassignment route

**Files:**
- Modify: `api/server/routes/admin/users.js`
- Modify: `api/server/routes/admin/roles.js`
- Create: `api/server/routes/admin/hierarchy.js`
- Modify: `api/server/routes/index.js`
- Modify: `api/server/index.js`
- Create: `api/server/routes/__tests__/admin.hierarchy.spec.js`

**Interfaces:**
- Consumes: `requireAnyCapability` (Task 6), `createHierarchyMiddleware` (Task 7), `createAdminHierarchyHandlers` (Task 8), `db.canViewRole`/`db.getDescendantRoleNames`/`db.setRoleParent`/`db.countChildRoles`/`db.grantCapability`/`db.updateUsersRoleByIds` (all already spread onto `~/models` via `createMethods` — no `api/models/index.js` change needed).
- Produces: `GET /api/admin/hierarchy/me` mounted; `admin/users.js` router gate widened to `requireAnyCapability([ACCESS_ADMIN, READ_USERS, VIEW_SUBORDINATES])`; the five existing/new `admin/users.js` routes that need scoping use the new hierarchy middleware instead of `requireReadUsers`; new `PATCH /api/admin/users/:userId/role` route.

- [ ] **Step 1: Write the failing integration test**

Create `api/server/routes/__tests__/admin.hierarchy.spec.js`. Follow `api/server/routes/__tests__/admin.users.conversations.spec.js` for the supertest + JWT-minting + seeded-user harness (same `connectTestDb`, same app assembly).

```js
const request = require('supertest');
const mongoose = require('mongoose');
// ...same app/db bootstrap as admin.users.conversations.spec.js...

describe('role hierarchy end-to-end', () => {
  let supervisorToken, salesManagerToken, supportManagerToken;
  let salesEmployeeId, supportEmployeeId;

  beforeAll(async () => {
    // Seed roles: SUPERVISOR (top-level) -> SALES_MANAGER -> SALES_EMPLOYEE
    //             SUPPORT_MANAGER (top-level) -> SUPPORT_EMPLOYEE
    // Seed one user per role and mint a JWT for SUPERVISOR, SALES_MANAGER, SUPPORT_MANAGER.
    // Grant VIEW_SUBORDINATES to SUPERVISOR, SALES_MANAGER, SUPPORT_MANAGER via db.grantCapability.
  });

  it('lets a SALES_MANAGER list only their descendant users', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${salesManagerToken}`);
    expect(res.status).toBe(200);
    const roles = res.body.users.map((u) => u.role);
    expect(roles).toContain('SALES_EMPLOYEE');
    expect(roles).not.toContain('SUPPORT_EMPLOYEE');
  });

  it('lets a SUPERVISOR view a SALES_EMPLOYEE’s conversations', async () => {
    const res = await request(app)
      .get(`/api/admin/users/${salesEmployeeId}/conversations`)
      .set('Authorization', `Bearer ${supervisorToken}`);
    expect(res.status).toBe(200);
  });

  it('denies a SALES_MANAGER viewing a SUPPORT_EMPLOYEE’s conversations', async () => {
    const res = await request(app)
      .get(`/api/admin/users/${supportEmployeeId}/conversations`)
      .set('Authorization', `Bearer ${salesManagerToken}`);
    expect(res.status).toBe(403);
  });

  it('lets a SALES_MANAGER reassign a SALES_EMPLOYEE to another role in their subtree', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${salesEmployeeId}/role`)
      .set('Authorization', `Bearer ${salesManagerToken}`)
      .send({ role: 'SALES_MANAGER' });
    // SALES_MANAGER is an ancestor of the actor's own role, not a descendant — denied.
    expect(res.status).toBe(403);
  });

  it('denies a SALES_MANAGER reassigning a SUPPORT_EMPLOYEE', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${supportEmployeeId}/role`)
      .set('Authorization', `Bearer ${salesManagerToken}`)
      .send({ role: 'SALES_EMPLOYEE' });
    expect(res.status).toBe(403);
  });

  it('denies a plain USER any access to /api/admin/users', async () => {
    // mint a USER token, assert 403 on GET /api/admin/users
  });

  it('GET /api/admin/hierarchy/me reflects each principal correctly', async () => {
    const supervisorRes = await request(app)
      .get('/api/admin/hierarchy/me')
      .set('Authorization', `Bearer ${supervisorToken}`);
    expect(supervisorRes.body.viewableRoleNames.sort()).toEqual(
      ['SALES_MANAGER', 'SALES_EMPLOYEE'].sort(),
    );
  });
});
```

(This is deliberately written against the real route stack per the project's "real logic over mocks" testing philosophy — fill in the seeding/JWT-minting bodies by copying the exact pattern `admin.users.conversations.spec.js` already uses for seeding users and minting tokens, extended to seed roles via `db.createRoleByName`/`db.setRoleParent` and grants via `db.grantCapability`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest server/routes/__tests__/admin.hierarchy.spec.js`
Expected: FAIL — `/api/admin/hierarchy/me` 404s (not mounted), and `/api/admin/users` 403s for `salesManagerToken` (the router gate hasn't been widened yet).

- [ ] **Step 3: Widen the `admin/users.js` router gate and swap in hierarchy middleware**

In `api/server/routes/admin/users.js`:

```js
const {
  createAdminUsersHandlers,
  createAdminUserConversationsHandlers,
  revokeUserCodeEnvironmentWorkers,
} = require('@librechat/api');
const { createHierarchyMiddleware } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability, requireAnyCapability, hasCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
// ...existing requires...

const requireAdminOrHierarchyAccess = requireAnyCapability([
  SystemCapabilities.ACCESS_ADMIN,
  SystemCapabilities.READ_USERS,
  SystemCapabilities.VIEW_SUBORDINATES,
]);

const { requireSubordinateAccess, attachHierarchyScope } = createHierarchyMiddleware({
  hasCapability,
  findUsers: db.findUsers,
  canViewRole: db.canViewRole,
  getDescendantRoleNames: db.getDescendantRoleNames,
});

const handlers = createAdminUsersHandlers({
  // ...existing deps...
  updateUsersRoleByIds: db.updateUsersRoleByIds,
  canViewRole: db.canViewRole,
});

const conversationHandlers = createAdminUserConversationsHandlers({ /* unchanged */ });

router.use(requireJwtAuth, requireAdminOrHierarchyAccess);

router.get('/', attachHierarchyScope, handlers.listUsers);
router.get('/search', attachHierarchyScope, handlers.searchUsers);
// router.delete('/:id', requireManageUsers, handlers.deleteUser);

router.get('/:userId/conversations', requireSubordinateAccess, conversationHandlers.listUserConversations);
router.get(
  '/:userId/conversations/:conversationId',
  requireSubordinateAccess,
  conversationHandlers.getUserConversation,
);
router.get(
  '/:userId/conversations/:conversationId/messages',
  requireSubordinateAccess,
  conversationHandlers.getUserConversationMessages,
);
router.patch('/:userId/role', requireSubordinateAccess, handlers.reassignUserRole);

module.exports = router;
```

(`requireReadUsers` is no longer used by any route in this file — remove its `const` declaration along with the now-unused `requireAdminAccess` if nothing else in the file references them; keep `requireCapability` imported only if another commented-out route still references it, otherwise drop it from the destructure too.)

- [ ] **Step 4: Wire the roles route's new deps**

In `api/server/routes/admin/roles.js`, add to the `createAdminRolesHandlers({...})` call:

```js
  setRoleParent: db.setRoleParent,
  countChildRoles: db.countChildRoles,
  grantCapability: db.grantCapability,
```

- [ ] **Step 5: Create and mount the hierarchy route**

Create `api/server/routes/admin/hierarchy.js`:

```js
const express = require('express');
const { createAdminHierarchyHandlers } = require('@librechat/api');
const { hasCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const handlers = createAdminHierarchyHandlers({
  hasCapability,
  getDescendantRoleNames: db.getDescendantRoleNames,
});

router.use(requireJwtAuth);
router.get('/me', handlers.getMyHierarchy);

module.exports = router;
```

In `api/server/routes/index.js`, add `const adminHierarchy = require('./admin/hierarchy');` next to the other `admin*` requires, and add `adminHierarchy` to `module.exports`.

In `api/server/index.js`, add after the `adminRoles` mount line:

```js
  app.use('/api/admin/hierarchy', routes.adminHierarchy);
```

- [ ] **Step 6: Rebuild `@librechat/api` and run the test**

Run: `npm run build:api`
Run: `cd api && npx jest server/routes/__tests__/admin.hierarchy.spec.js`
Expected: PASS.

- [ ] **Step 7: Re-run the existing conversation-viewer route test to confirm no regression**

Run: `cd api && npx jest server/routes/__tests__/admin.users.conversations.spec.js`
Expected: PASS — an ADMIN caller still reaches every route unchanged (the widened gate is additive: ADMIN still passes `requireAnyCapability`, and `requireSubordinateAccess`'s first branch is still the `ACCESS_ADMIN` check).

- [ ] **Step 8: Commit**

```bash
git add api/server/routes/admin/users.js api/server/routes/admin/roles.js api/server/routes/admin/hierarchy.js api/server/routes/index.js api/server/index.js api/server/routes/__tests__/admin.hierarchy.spec.js
git commit -m "feat(admin): mount hierarchy routes, widen users-router gate for subordinate access"
```

---

## Task 12: Data-provider — types, endpoints, service, keys

**Files:**
- Modify: `packages/data-provider/src/types/admin.ts`
- Modify: `packages/data-provider/src/api-endpoints.ts`
- Modify: `packages/data-provider/src/data-service.ts`
- Modify: `packages/data-provider/src/keys.ts`
- Modify: `packages/data-provider/src/api-endpoints.admin.spec.ts` (create if it doesn't already exist under this name — check first; the in-app-admin-area plan created it)

**Interfaces:**
- Produces:
  - `TAdminRole.parentRole: string | null`, `TAdminRole.depth: number`
  - `TMyHierarchy { isAdmin: boolean; canViewSubordinates: boolean; viewableRoleNames: string[]; manageableRoleNames: string[] }`
  - `endpoints.adminHierarchyMe(): string`, `endpoints.adminUserRole(userId: string): string`
  - `dataService.createAdminRole(body: { name: string; description?: string; parentRole?: string | null }): Promise<{ role: TAdminRole }>`
  - `dataService.setAdminRoleParent(name: string, parentRole: string | null): Promise<{ role: TAdminRole }>`
  - `dataService.getMyHierarchy(): Promise<TMyHierarchy>`
  - `dataService.setAdminUserRole(userId: string, role: string): Promise<{ success: true }>`
  - `QueryKeys.myHierarchy`

- [ ] **Step 1: Write the failing test**

Add to `packages/data-provider/src/api-endpoints.admin.spec.ts` (or create it following the pattern from the in-app-admin-area plan's Task 3, Step 1, if this file doesn't exist yet):

```ts
it('builds the hierarchy-me and user-role paths', () => {
  expect(endpoints.adminHierarchyMe()).toBe('/api/admin/hierarchy/me');
  expect(endpoints.adminUserRole('u1')).toBe('/api/admin/users/u1/role');
  expect(endpoints.adminUserRole('a/b')).toBe('/api/admin/users/a%2Fb/role');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/data-provider && npx jest src/api-endpoints.admin.spec.ts -t "hierarchy-me"`
Expected: FAIL — `endpoints.adminHierarchyMe is not a function`.

- [ ] **Step 3: Add the endpoint builders**

In `packages/data-provider/src/api-endpoints.ts`, in the `/* Admin — users + read-only conversation viewer */` block:

```ts
export const adminHierarchyMe = () => `${BASE_URL}/api/admin/hierarchy/me`;
export const adminUserRole = (userId: string) =>
  `${BASE_URL}/api/admin/users/${encodeURIComponent(userId)}/role`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/data-provider && npx jest src/api-endpoints.admin.spec.ts`
Expected: PASS (full file).

- [ ] **Step 5: Add the types**

In `packages/data-provider/src/types/admin.ts`, extend `TAdminRole`:

```ts
export interface TAdminRole {
  name: string;
  description?: string;
  permissions?: Record<string, Record<string, boolean>>;
  parentRole?: string | null;
  depth?: number;
}
```

Add:

```ts
export interface TMyHierarchy {
  isAdmin: boolean;
  canViewSubordinates: boolean;
  viewableRoleNames: string[];
  manageableRoleNames: string[];
}
```

- [ ] **Step 6: Add the QueryKey**

In `packages/data-provider/src/keys.ts`, add `myHierarchy = 'myHierarchy',` alongside the other `admin*` keys (matching the file's existing enum/const-object style).

- [ ] **Step 7: Add the service functions**

In `packages/data-provider/src/data-service.ts`, in the `/* Roles */` region, restore (it was removed in `f77d069f3`):

```ts
export function createAdminRole(body: {
  name: string;
  description?: string;
  parentRole?: string | null;
}): Promise<{ role: adm.TAdminRole }> {
  return request.post(endpoints.adminRoles(), body);
}

export function setAdminRoleParent(
  name: string,
  parentRole: string | null,
): Promise<{ role: adm.TAdminRole }> {
  return request.patch(endpoints.adminRole(name), { parentRole });
}
```

In the `/* Admin users */` region, add:

```ts
export function getMyHierarchy(): Promise<adm.TMyHierarchy> {
  return request.get(endpoints.adminHierarchyMe());
}

export function setAdminUserRole(userId: string, role: string): Promise<{ success: true }> {
  return request.patch(endpoints.adminUserRole(userId), { role });
}
```

(If `data-service.ts` aggregates every export into a `dataService` object at the bottom, add these four function names there too, matching the file's existing style.)

- [ ] **Step 8: Build and typecheck**

Run: `npm run build:data-provider`
Run: `cd packages/data-provider && npx tsc --noEmit && npx jest src/api-endpoints.admin.spec.ts`
Expected: build OK, no type errors, test PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/data-provider/src/types/admin.ts packages/data-provider/src/api-endpoints.ts packages/data-provider/src/data-service.ts packages/data-provider/src/keys.ts packages/data-provider/src/api-endpoints.admin.spec.ts
git commit -m "feat(data-provider): hierarchy endpoints, restore createAdminRole"
```

---

## Task 13: Client hooks — `useMyHierarchy`, restored `useCreateRole`, `useSetRoleParent`, `useSetUserRole`

**Files:**
- Modify: `client/src/data-provider/Admin/queries.ts`
- Modify: `client/src/data-provider/Admin/mutations.ts`
- Test: `client/src/data-provider/Admin/__tests__/hierarchy.test.ts` (create)

**Interfaces:**
- Consumes: Task 12's `dataService.getMyHierarchy`/`createAdminRole`/`setAdminRoleParent`/`setAdminUserRole`, `QueryKeys.myHierarchy`.
- Produces:
  - `useMyHierarchy(config?): QueryObserverResult<TMyHierarchy>`
  - `useCreateRole(): UseMutationResult<{ role: TAdminRole }, Error, { name: string; description?: string; parentRole?: string | null }>`
  - `useSetRoleParent(): UseMutationResult<{ role: TAdminRole }, Error, { name: string; parentRole: string | null }>`
  - `useSetUserRole(): UseMutationResult<{ success: true }, Error, { userId: string; role: string }>`

- [ ] **Step 1: Write the failing test**

Create `client/src/data-provider/Admin/__tests__/hierarchy.test.ts`. Follow the mocking pattern from the in-app-admin-area plan's Task 4 (`jest.mock('librechat-data-provider', ...)`, a `QueryClientProvider` wrapper).

```ts
import { renderHook, waitFor } from '@testing-library/react';
import { dataService } from 'librechat-data-provider';
import { useMyHierarchy } from '../queries';
// import the same `wrapper` helper the existing Admin queries tests use

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  dataService: { getMyHierarchy: jest.fn() },
}));

it('useMyHierarchy fetches the caller’s hierarchy access', async () => {
  (dataService.getMyHierarchy as jest.Mock).mockResolvedValue({
    isAdmin: false,
    canViewSubordinates: true,
    viewableRoleNames: ['SALES_EMPLOYEE'],
    manageableRoleNames: ['SALES_EMPLOYEE'],
  });
  const { result } = renderHook(() => useMyHierarchy(), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.canViewSubordinates).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest src/data-provider/Admin/__tests__/hierarchy.test.ts`
Expected: FAIL — `useMyHierarchy` is not exported from `../queries`.

- [ ] **Step 3: Write the hooks**

In `client/src/data-provider/Admin/queries.ts`, add the import `TMyHierarchy` to the existing `import type { ... } from 'librechat-data-provider'` block, and add:

```ts
export const useMyHierarchy = (
  config?: UseQueryOptions<TMyHierarchy>,
): QueryObserverResult<TMyHierarchy> =>
  useQuery<TMyHierarchy>([QueryKeys.myHierarchy], () => dataService.getMyHierarchy(), {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    ...config,
  });
```

In `client/src/data-provider/Admin/mutations.ts`, add the import `TAdminRole` is already there; add:

```ts
export const useCreateRole = (): UseMutationResult<
  { role: TAdminRole },
  Error,
  { name: string; description?: string; parentRole?: string | null }
> => {
  const queryClient = useQueryClient();
  return useMutation((body) => dataService.createAdminRole(body), {
    onSuccess: () => queryClient.invalidateQueries([QueryKeys.adminRoles]),
  });
};

export const useSetRoleParent = (): UseMutationResult<
  { role: TAdminRole },
  Error,
  { name: string; parentRole: string | null }
> => {
  const queryClient = useQueryClient();
  return useMutation(({ name, parentRole }) => dataService.setAdminRoleParent(name, parentRole), {
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.adminRoles]);
      queryClient.invalidateQueries([QueryKeys.myHierarchy]);
    },
  });
};

export const useSetUserRole = (): UseMutationResult<
  { success: true },
  Error,
  { userId: string; role: string }
> => {
  const queryClient = useQueryClient();
  return useMutation(({ userId, role }) => dataService.setAdminUserRole(userId, role), {
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.adminUsers]);
      queryClient.invalidateQueries([QueryKeys.adminUserSearch]);
      queryClient.invalidateQueries([QueryKeys.user]);
    },
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx jest src/data-provider/Admin/__tests__/hierarchy.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/data-provider/Admin/queries.ts client/src/data-provider/Admin/mutations.ts client/src/data-provider/Admin/__tests__/hierarchy.test.ts
git commit -m "feat(client): add hierarchy and tree-editing data hooks"
```

---

## Task 14: Guard, sidebar, and `AdminLayout` — capability-aware

**Files:**
- Modify: `client/src/components/Admin/guard.tsx`
- Modify: `client/src/hooks/Nav/useUnifiedSidebarLinks.ts`
- Modify: `client/src/components/Admin/AdminLayout.tsx`
- Test: `client/src/components/Admin/__tests__/guard.test.tsx` (create if it doesn't already exist)

**Interfaces:**
- Consumes: `useMyHierarchy` (Task 13).
- Produces: `useAdminGuard()` now returns `null` while loading or when `isAdmin || canViewSubordinates`; `AdminLayout` renders the Access tab only when `isAdmin`; the sidebar link condition widens to `isAdmin || canViewSubordinates`.

- [ ] **Step 1: Write the failing tests**

Create/extend `client/src/components/Admin/__tests__/guard.test.tsx`:

```tsx
import { renderHook } from '@testing-library/react';
import { useAdminGuard } from '../guard';

jest.mock('~/data-provider', () => ({ useMyHierarchy: jest.fn() }));
import { useMyHierarchy } from '~/data-provider';

it('renders nothing while the hierarchy query is loading', () => {
  (useMyHierarchy as jest.Mock).mockReturnValue({ data: undefined, isLoading: true });
  const { result } = renderHook(() => useAdminGuard());
  expect(result.current).toBeNull();
});

it('passes an ADMIN through', () => {
  (useMyHierarchy as jest.Mock).mockReturnValue({
    data: { isAdmin: true, canViewSubordinates: true, viewableRoleNames: [], manageableRoleNames: [] },
    isLoading: false,
  });
  const { result } = renderHook(() => useAdminGuard());
  expect(result.current).toBeNull();
});

it('passes a hierarchy role through', () => {
  (useMyHierarchy as jest.Mock).mockReturnValue({
    data: {
      isAdmin: false,
      canViewSubordinates: true,
      viewableRoleNames: ['SALES_EMPLOYEE'],
      manageableRoleNames: ['SALES_EMPLOYEE'],
    },
    isLoading: false,
  });
  const { result } = renderHook(() => useAdminGuard());
  expect(result.current).toBeNull();
});

it('redirects a plain user once loading finishes', () => {
  (useMyHierarchy as jest.Mock).mockReturnValue({
    data: { isAdmin: false, canViewSubordinates: false, viewableRoleNames: [], manageableRoleNames: [] },
    isLoading: false,
  });
  const { result } = renderHook(() => useAdminGuard());
  expect(result.current).not.toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx jest src/components/Admin/__tests__/guard.test.tsx`
Expected: FAIL — the current guard reads `useAuthContext().user.role` directly, so a mocked `useMyHierarchy` has no effect and the loading/ADMIN/hierarchy-role cases behave like today's role-only check (the loading case in particular has no "return null while loading" branch at all today).

- [ ] **Step 3: Rewrite the guard**

Replace `client/src/components/Admin/guard.tsx`:

```tsx
import { Navigate } from 'react-router-dom';
import type { ReactElement } from 'react';
import { useMyHierarchy } from '~/data-provider';
// import order: package value imports, then `import type`, then local — per CLAUDE.md

/**
 * Client-side gate for the admin area. Returns a redirect element once the
 * hierarchy query resolves and the caller is neither ADMIN nor a hierarchy
 * role with visible descendants, or `null` while loading or when admitted.
 * This is defense in depth only — the real enforcement is
 * `requireAnyCapability`/`requireSubordinateAccess` on `/api/admin/*`.
 */
export function useAdminGuard(): ReactElement | null {
  const { data, isLoading } = useMyHierarchy();
  if (isLoading) {
    return null;
  }
  if (!data?.isAdmin && !data?.canViewSubordinates) {
    return <Navigate to="/c/new" replace />;
  }
  return null;
}
```

- [ ] **Step 4: Run guard tests to verify they pass**

Run: `cd client && npx jest src/components/Admin/__tests__/guard.test.tsx`
Expected: PASS (4 cases).

- [ ] **Step 5: Widen the sidebar link and gate the Access tab**

In `client/src/hooks/Nav/useUnifiedSidebarLinks.ts`, add the hook and widen the condition:

```ts
import { useMyHierarchy } from '~/data-provider';
// ...
const { data: hierarchy } = useMyHierarchy();
// ...
const isAdmin = (hierarchy?.isAdmin || hierarchy?.canViewSubordinates) ?? false;
```

(Replace the existing `const isAdmin = user?.role === SystemRoles.ADMIN;` line with the above; add `hierarchy?.isAdmin` / `hierarchy?.canViewSubordinates` to the `useMemo`'s dependency array in place of `user?.role`, since the link now depends on the query result, not the raw role.)

In `client/src/components/Admin/AdminLayout.tsx`, gate the Access tab:

```tsx
import { useMyHierarchy } from '~/data-provider';
// ...
export default function AdminLayout() {
  const localize = useLocalize();
  const redirect = useAdminGuard();
  const { data: hierarchy } = useMyHierarchy();
  if (redirect) {
    return redirect;
  }
  // ...
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-surface-primary">
      <header className="flex flex-col gap-3 border-b border-border-light px-6 pt-5">
        <h1 className="text-lg font-semibold text-text-primary">
          {localize('com_admin_nav_title')}
        </h1>
        <nav className="flex gap-1">
          {hierarchy?.isAdmin ? tab('/admin/access', localize('com_admin_access_title')) : null}
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

- [ ] **Step 6: Run every touched client test suite**

Run: `cd client && npx jest src/components/Admin src/hooks/Nav`
Expected: PASS. If `useUnifiedSidebarLinks` has no existing admin-link test, add one following the in-app-admin-area plan's Task 5 Step 1 pattern, asserting the link is present when `useMyHierarchy` returns `canViewSubordinates: true` and absent when both flags are `false`.

- [ ] **Step 7: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add client/src/components/Admin/guard.tsx client/src/components/Admin/AdminLayout.tsx client/src/hooks/Nav/useUnifiedSidebarLinks.ts client/src/components/Admin/__tests__/guard.test.tsx
git commit -m "feat(client): capability-aware admin guard, sidebar link, and Access-tab gating"
```

---

## Task 15: Access tab — restore Create Role with a parent picker, re-parenting in Edit, delete-blocked message

**Files:**
- Create: `client/src/components/Admin/Access/CreateRoleDialog.tsx`
- Create: `client/src/components/Admin/Access/__tests__/CreateRoleDialog.test.tsx`
- Modify: `client/src/components/Admin/Access/AccessView.tsx`
- Modify: `client/src/components/Admin/Access/EditRoleDialog.tsx`
- Modify: `client/src/locales/en/translation.json`

**Interfaces:**
- Consumes: `useCreateRole`, `useSetRoleParent` (Task 13); `useAdminRoles` (existing, now returns `parentRole`/`depth` per Task 12's `TAdminRole`).
- Produces: a restored "Create role" button + dialog with a parent `<select>`; a "Reports to" field in `EditRoleDialog`; role rows indented by `depth`; the `409` child-count message surfaced on a blocked delete.

- [ ] **Step 1: Write the failing test**

Create `client/src/components/Admin/Access/__tests__/CreateRoleDialog.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CreateRoleDialog from '../CreateRoleDialog';

jest.mock('~/data-provider', () => ({
  useCreateRole: jest.fn(),
  useAdminRoles: jest.fn(),
}));
import { useCreateRole, useAdminRoles } from '~/data-provider';

function renderDialog() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <CreateRoleDialog open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

it('offers a top-level option plus every existing non-USER role as a parent', () => {
  (useAdminRoles as jest.Mock).mockReturnValue({
    data: { roles: [{ name: 'ADMIN' }, { name: 'USER' }, { name: 'SUPERVISOR', depth: 0 }] },
  });
  (useCreateRole as jest.Mock).mockReturnValue({ mutate: jest.fn(), isLoading: false, error: null, reset: jest.fn() });
  renderDialog();
  const options = screen.getAllByRole('option').map((o) => o.textContent);
  expect(options).toEqual(
    expect.arrayContaining([expect.stringContaining('Top-level'), 'SUPERVISOR']),
  );
  expect(options.join(' ')).not.toContain('USER');
});

it('submits with the selected parentRole', async () => {
  (useAdminRoles as jest.Mock).mockReturnValue({ data: { roles: [{ name: 'SUPERVISOR', depth: 0 }] } });
  const mutate = jest.fn();
  (useCreateRole as jest.Mock).mockReturnValue({ mutate, isLoading: false, error: null, reset: jest.fn() });
  renderDialog();

  fireEvent.change(screen.getByLabelText(/role name/i), { target: { value: 'SALES_MANAGER' } });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'SUPERVISOR' } });
  fireEvent.click(screen.getByRole('button', { name: /create/i }));

  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'SALES_MANAGER', parentRole: 'SUPERVISOR' }),
      expect.any(Object),
    ),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest src/components/Admin/Access/__tests__/CreateRoleDialog.test.tsx`
Expected: FAIL — `Cannot find module '../CreateRoleDialog'`.

- [ ] **Step 3: Restore and extend `CreateRoleDialog`**

Create `client/src/components/Admin/Access/CreateRoleDialog.tsx`, starting from the pre-`f77d069f3` version (`git show f77d069f3^:client/src/components/Admin/Access/CreateRoleDialog.tsx`) and adding the parent picker:

```tsx
import { useState } from 'react';
import { OGDialog, OGDialogTemplate, Button, Input, Spinner } from '@librechat/client';
import { getResponseErrorMessage } from '~/utils';
import { useCreateRole, useAdminRoles } from '~/data-provider';
import { SYSTEM_ROLES } from './constants';
import { useLocalize } from '~/hooks';

const TOP_LEVEL_VALUE = '';

export default function CreateRoleDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const localize = useLocalize();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentRole, setParentRole] = useState(TOP_LEVEL_VALUE);
  const mutation = useCreateRole();
  const { data } = useAdminRoles();

  const parentOptions = (data?.roles ?? []).filter((r) => !SYSTEM_ROLES.has(r.name));

  const reset = () => {
    setName('');
    setDescription('');
    setParentRole(TOP_LEVEL_VALUE);
    mutation.reset();
  };

  const submit = () => {
    if (!name.trim()) {
      return;
    }
    mutation.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        parentRole: parentRole || null,
      },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <OGDialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          reset();
        }
        onOpenChange(value);
      }}
    >
      <OGDialogTemplate
        title={localize('com_admin_access_create_title')}
        showCloseButton={false}
        className="w-11/12 md:max-w-md"
        main={
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm text-text-secondary">
              {localize('com_admin_access_role_name')}
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-text-secondary">
              {localize('com_admin_access_role_description')}
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-text-secondary">
              {localize('com_admin_role_parent_label')}
              <select
                className="rounded-lg border border-border-light bg-surface-primary px-2 py-1.5 text-sm text-text-primary"
                value={parentRole}
                onChange={(e) => setParentRole(e.target.value)}
              >
                <option value={TOP_LEVEL_VALUE}>{localize('com_admin_role_top_level')}</option>
                {parentOptions.map((role) => (
                  <option key={role.name} value={role.name}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
            {mutation.error ? (
              <p className="text-sm text-text-secondary">
                {getResponseErrorMessage(mutation.error)}
              </p>
            ) : null}
          </div>
        }
        buttons={
          <Button
            variant="submit"
            type="button"
            disabled={mutation.isLoading || !name.trim()}
            onClick={submit}
          >
            {mutation.isLoading ? <Spinner /> : localize('com_ui_create')}
          </Button>
        }
      />
    </OGDialog>
  );
}
```

In `client/src/components/Admin/Access/AccessView.tsx`, add the "Create role" button and dialog, and indent rows by `depth`:

```tsx
import { useMemo, useState } from 'react';
import { Input, Spinner, Button } from '@librechat/client';
import type { TAdminRole } from 'librechat-data-provider';
import { useAdminRoles } from '~/data-provider';
import CreateRoleDialog from './CreateRoleDialog';
import EditRoleDialog from './EditRoleDialog';
import { SYSTEM_ROLES } from './constants';
import { useLocalize } from '~/hooks';
import RoleRow from './RoleRow';

export default function AccessView() {
  const localize = useLocalize();
  const { data, isLoading, isError } = useAdminRoles();
  const [search, setSearch] = useState('');
  const [editTarget, setEditTarget] = useState<TAdminRole | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

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
        <Button variant="submit" type="button" onClick={() => setCreateOpen(true)}>
          {localize('com_admin_access_create_title')}
        </Button>
      </div>

      {roles.length === 0 ? (
        <p className="text-sm text-text-secondary">{localize('com_admin_access_empty')}</p>
      ) : (
        roles.map((role) => (
          <div key={role.name} style={{ marginLeft: `${(role.depth ?? 0) * 1.25}rem` }}>
            <RoleRow role={role} isSystem={SYSTEM_ROLES.has(role.name)} onEdit={() => setEditTarget(role)} />
          </div>
        ))
      )}

      <CreateRoleDialog open={createOpen} onOpenChange={setCreateOpen} />
      <EditRoleDialog role={editTarget} onClose={() => setEditTarget(null)} />
    </div>
  );
}
```

In `client/src/components/Admin/Access/EditRoleDialog.tsx`, add a "Reports to" field to the Details tab and surface the `409` message. Add `useSetRoleParent` alongside the existing mutations:

```tsx
import { useSetRoleParent, useUpdateRole, useDeleteRole } from '~/data-provider';
// ...
const parentMutation = useSetRoleParent();
// ...
const [parentRole, setParentRoleValue] = useState<string>('');
useEffect(() => {
  setParentRoleValue(role?.parentRole ?? '');
  // ...existing resets...
}, [role?.name]);
// ...
const saveParent = () => {
  parentMutation.mutate(
    { name: role.name, parentRole: parentRole || null },
    { onSuccess: () => onClose() },
  );
};
```

Add the picker in the Details tab, below the description field (excluding the role itself and `SYSTEM_ROLES` — the server's `wouldCreateCycle`/`isSystemRoleName` checks remain the authoritative gate; this is only a UX nicety):

```tsx
<label className="flex flex-col gap-1 text-sm text-text-secondary">
  {localize('com_admin_role_parent_label')}
  <select
    className="rounded-lg border border-border-light bg-surface-primary px-2 py-1.5 text-sm text-text-primary"
    value={parentRole}
    disabled={isSystem}
    onChange={(e) => setParentRoleValue(e.target.value)}
  >
    <option value="">{localize('com_admin_role_top_level')}</option>
    {(rolesData?.roles ?? [])
      .filter((r) => r.name !== role.name && !SYSTEM_ROLES.has(r.name))
      .map((r) => (
        <option key={r.name} value={r.name}>
          {r.name}
        </option>
      ))}
  </select>
</label>
{parentMutation.error ? (
  <p className="text-sm text-text-secondary">{getResponseErrorMessage(parentMutation.error)}</p>
) : null}
<Button
  variant="outline"
  type="button"
  disabled={parentMutation.isLoading || parentRole === (role.parentRole ?? '')}
  onClick={saveParent}
>
  {parentMutation.isLoading ? <Spinner /> : localize('com_admin_role_save_parent')}
</Button>
```

(`rolesData` comes from adding `const { data: rolesData } = useAdminRoles();` near the top of the component.) For the delete-blocked message, the existing `deleteMutation.error` path through `getResponseErrorMessage` already surfaces whatever string the `409` handler returns (Task 9's `"...it has N child role(s)..."`) — no additional code is needed beyond what's already there; the mutation error display block already covers it.

Add to `client/src/locales/en/translation.json`:

```json
"com_admin_role_parent_label": "Reports to",
"com_admin_role_top_level": "Top-level branch",
"com_admin_role_save_parent": "Save hierarchy position"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx jest src/components/Admin/Access`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Admin/Access client/src/locales/en/translation.json
git commit -m "feat(client): restore Create Role with a parent picker; re-parenting in Edit Role"
```

---

## Task 16: Users tab — role-change control for hierarchy viewers

**Files:**
- Modify: `client/src/components/Admin/Users/UserRow.tsx`
- Modify: `client/src/components/Admin/Users/UsersView.tsx`
- Modify: `client/src/locales/en/translation.json`

**Interfaces:**
- Consumes: `useSetUserRole` (Task 13), `useMyHierarchy` (Task 13).
- Produces: `UserRow` renders a "Change role" `<select>` (populated from `manageableRoleNames`) instead of the plain role badge when `canManageRole` is true.

- [ ] **Step 1: Write the failing test**

Create `client/src/components/Admin/Users/__tests__/UserRow.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import UserRow from '../UserRow';

jest.mock('~/data-provider', () => ({ useSetUserRole: jest.fn() }));
import { useSetUserRole } from '~/data-provider';

const user = { id: 'u1', name: 'Alice', email: 'a@example.com', role: 'SALES_EMPLOYEE' };

it('renders a plain role badge when manageableRoleNames is not provided', () => {
  render(
    <table>
      <tbody>
        <UserRow user={user} locale="en" onOpen={() => {}} />
      </tbody>
    </table>,
  );
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.getByText('SALES_EMPLOYEE')).toBeInTheDocument();
});

it('renders a change-role select when manageableRoleNames is provided and calls the mutation on change', () => {
  const mutate = jest.fn();
  (useSetUserRole as jest.Mock).mockReturnValue({ mutate, isLoading: false });
  render(
    <table>
      <tbody>
        <UserRow
          user={user}
          locale="en"
          onOpen={() => {}}
          manageableRoleNames={['SALES_EMPLOYEE', 'SALES_EMPLOYEE_TIER_2']}
        />
      </tbody>
    </table>,
  );
  fireEvent.click(screen.getByRole('combobox'), { stopPropagation: true });
  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: 'SALES_EMPLOYEE_TIER_2' },
  });
  expect(mutate).toHaveBeenCalledWith({ userId: 'u1', role: 'SALES_EMPLOYEE_TIER_2' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest src/components/Admin/Users/__tests__/UserRow.test.tsx`
Expected: FAIL — `UserRow` has no `manageableRoleNames` prop and never renders a `combobox`.

- [ ] **Step 3: Add the control**

In `client/src/components/Admin/Users/UserRow.tsx`:

```tsx
import { useSetUserRole } from '~/data-provider';
import { useLocalize } from '~/hooks';

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role?: string;
  provider?: string;
  createdAt?: string;
}

export default function UserRow({
  user,
  locale,
  onOpen,
  manageableRoleNames,
}: {
  user: AdminUserRow;
  locale: string;
  onOpen: () => void;
  /** Present only for a non-ADMIN viewer with subordinate-management access; renders a
   *  "Change role" select instead of the plain role badge. */
  manageableRoleNames?: string[];
}) {
  const localize = useLocalize();
  const setUserRole = useSetUserRole();
  const created = user.createdAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(user.createdAt))
    : '—';

  const canManageRole = manageableRoleNames != null && manageableRoleNames.length > 0;

  return (
    <tr
      className="cursor-pointer border-b border-border-light hover:bg-surface-hover"
      onClick={onOpen}
    >
      <td className="px-3 py-2 text-sm text-text-primary">{user.name || user.email}</td>
      <td className="px-3 py-2 text-sm text-text-secondary">{user.email}</td>
      <td className="px-3 py-2">
        {canManageRole ? (
          <select
            aria-label={localize('com_admin_users_change_role')}
            className="rounded-lg border border-border-light bg-surface-primary px-2 py-1 text-xs text-text-primary"
            value={user.role}
            disabled={setUserRole.isLoading}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setUserRole.mutate({ userId: user.id, role: e.target.value })}
          >
            {user.role && !manageableRoleNames?.includes(user.role) ? (
              <option value={user.role}>{user.role}</option>
            ) : null}
            {manageableRoleNames?.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : user.role ? (
          <span className="rounded-full bg-surface-tertiary px-2 py-0.5 text-[10px] font-medium text-text-secondary">
            {user.role}
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2 text-sm text-text-secondary">{user.provider ?? '—'}</td>
      <td className="px-3 py-2 text-sm text-text-secondary">
        <span className="sr-only">{localize('com_admin_users_col_created')}: </span>
        {created}
      </td>
    </tr>
  );
}
```

In `client/src/components/Admin/Users/UsersView.tsx`, thread `manageableRoleNames` through from `useMyHierarchy`, only for a non-ADMIN viewer:

```tsx
import { useAdminUsers, useAdminUserSearch, useMyHierarchy } from '~/data-provider';
// ...
const { data: hierarchy } = useMyHierarchy();
const manageableRoleNames = hierarchy?.isAdmin ? undefined : hierarchy?.manageableRoleNames;
// ...
{rows.map((user) => (
  <UserRow
    key={user.id}
    user={user}
    locale={locale}
    onOpen={() => open(user)}
    manageableRoleNames={manageableRoleNames}
  />
))}
```

Add to `client/src/locales/en/translation.json`:

```json
"com_admin_users_change_role": "Change role"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx jest src/components/Admin/Users`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Admin/Users client/src/locales/en/translation.json
git commit -m "feat(client): add a role-change control for hierarchy-scoped user viewers"
```

---

## Task 17: Final cross-workspace verification

**Files:** none new — this task only runs checks across everything touched by Tasks 1–16.

- [ ] **Step 1: Typecheck every touched workspace**

Run in sequence:

```bash
cd packages/data-schemas && npx tsc --noEmit
cd packages/api && npx tsc --noEmit
cd packages/data-provider && npx tsc --noEmit
cd client && npx tsc --noEmit
```

Expected: no errors in any workspace. Fix any cross-workspace type drift (e.g. a stale build of `packages/data-provider` or `packages/api` that another workspace imports) by re-running `npm run build:data-provider` / `npm run build:api` before re-checking.

- [ ] **Step 2: Run every backend and frontend test file touched by this plan**

```bash
cd packages/data-schemas && npx jest src/methods/role.hierarchy.spec.ts src/methods/role.methods.spec.ts src/admin/capabilities.spec.ts
cd packages/api && npx jest src/middleware/capabilities.spec.ts src/middleware/hierarchy.spec.ts src/admin/hierarchy.spec.ts src/admin/roles.spec.ts src/admin/users.spec.ts
cd api && npx jest server/routes/__tests__/admin.hierarchy.spec.js server/routes/__tests__/admin.users.conversations.spec.js
cd packages/data-provider && npx jest src/api-endpoints.admin.spec.ts
cd client && npx jest src/components/Admin src/data-provider/Admin src/hooks/Nav
```

Expected: PASS across the board. If any `mongodb-memory-server`-backed suite fails to boot locally (the known machine-specific issue from project memory), record which suites were skipped for that reason and confirm the rest pass — do not weaken or delete the affected tests to work around it.

- [ ] **Step 3: Lint and import order**

```bash
npm run lint
npm run sort-imports -- \
  packages/data-schemas/src/methods/role.ts \
  packages/data-schemas/src/methods/role.hierarchy.spec.ts \
  packages/data-schemas/src/methods/role.methods.spec.ts \
  packages/data-schemas/src/schema/role.ts \
  packages/data-schemas/src/types/role.ts \
  packages/data-schemas/src/admin/capabilities.ts \
  packages/data-schemas/src/admin/capabilities.spec.ts \
  packages/api/src/middleware/capabilities.ts \
  packages/api/src/middleware/capabilities.spec.ts \
  packages/api/src/middleware/hierarchy.ts \
  packages/api/src/middleware/hierarchy.spec.ts \
  packages/api/src/types/http.ts \
  packages/api/src/admin/hierarchy.ts \
  packages/api/src/admin/hierarchy.spec.ts \
  packages/api/src/admin/index.ts \
  packages/api/src/admin/roles.ts \
  packages/api/src/admin/roles.spec.ts \
  packages/api/src/admin/users.ts \
  packages/api/src/admin/users.spec.ts \
  packages/data-provider/src/types/admin.ts \
  packages/data-provider/src/api-endpoints.ts \
  packages/data-provider/src/data-service.ts \
  packages/data-provider/src/keys.ts \
  client/src/data-provider/Admin/queries.ts \
  client/src/data-provider/Admin/mutations.ts \
  client/src/components/Admin/guard.tsx \
  client/src/components/Admin/AdminLayout.tsx \
  client/src/hooks/Nav/useUnifiedSidebarLinks.ts \
  client/src/components/Admin/Access/AccessView.tsx \
  client/src/components/Admin/Access/EditRoleDialog.tsx \
  client/src/components/Admin/Access/CreateRoleDialog.tsx \
  client/src/components/Admin/Users/UserRow.tsx \
  client/src/components/Admin/Users/UsersView.tsx
```

Expected: no diagnostics, or auto-fixed cleanly. Re-run `npx tsc --noEmit` in any workspace `sort-imports` touched.

- [ ] **Step 4: `npm run static-checks -- --against origin/dev`**

Run from the repo root. Expected: the Static Checks CI job passes against this branch's diff (ESLint, Prettier, import sorting, config migration tests, unused i18n keys, unused npm packages).

- [ ] **Step 5: Manual smoke test (redeploy loop, per project memory)**

`npm run build:client` (and `npm run build:api` since `packages/api` changed) → kill the PID on `:3080` → `npm run backend` (background) → poll `/api/config` until 200 → clear the PWA service worker and hard-refresh. Then, as ADMIN: create a role `SUPERVISOR`, create `SALES_MANAGER` reporting to it, create `SALES_EMPLOYEE` reporting to `SALES_MANAGER`; assign a test user to `SALES_EMPLOYEE`. Log in as that user's manager (assign a second test user to `SALES_MANAGER` first) and confirm: the Admin sidebar entry appears, only the Users tab is visible, the user list shows only the `SALES_EMPLOYEE`, its conversations open read-only, and the role-change control only offers roles within the subtree.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: final typecheck/lint pass for role hierarchy feature" --allow-empty
```

(Use `--allow-empty` only if Steps 1–5 required no further code changes; otherwise this commit carries whatever fixes those steps produced.)
