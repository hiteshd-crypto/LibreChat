# feat(admin): department management & hierarchy scoping

## What changed

- **Department model**: a `Department` is a thin label over one top-level custom-role branch
  (`packages/data-schemas/src/schema/department.ts`, `methods/department.ts`). It can exist empty
  (no role yet) or wrap an existing/new top-level role as its `rootRoleKey`.
- **CRUD + linking API**: `packages/api/src/admin/departments.ts` and
  `api/server/routes/admin/departments.js` — list/create/rename/delete a department, set its head
  by wrapping an existing top-level role, and a new `departmentId` option on role creation that
  claims an empty department atomically (rolled back on a lost race).
- **`DEPARTMENT_HEAD` capability** (`packages/data-schemas/src/admin/capabilities.ts`): auto-granted
  to a department's branch-root role. Unlocks a department-scoped view of Hierarchy Management only
  — not Pricing, the User Balance editor, or any other department's data.
- **Scoping middleware** (`packages/api/src/middleware/hierarchy.ts`): `attachDepartmentScope`
  confines a Department Head's role list/detail views to their own branch; `requireDepartmentRoleAccess`
  confines their role mutations the same way. ADMIN-equivalent capabilities stay unscoped.
- **Migration**: `config/migrate-departments.js` (`npm run migrate:departments[:dry-run]`) wraps
  every existing top-level role into its own Department at boot, idempotently.
- **Frontend**: `Admin/Access` now dispatches to `DepartmentTreeView` (Department Head) or
  `DepartmentListView` (Super Admin), with create/rename/delete/set-head dialogs. Role creation,
  editing, and the role-row "Add members" quick action pick up the department-linking path.

## Why

The Admin Panel's Hierarchy Management was flat and admin-only. Department Management introduces
a scoped, delegated admin tier — a Department Head manages their own branch (roles, and in later
commits, balance) without needing full `ACCESS_ADMIN`.

## Ops notes

Run `npm run migrate:departments` after deploying this commit (or let it run automatically at
boot via `seedDatabase`) so every pre-existing top-level role branch gets wrapped as a Department.
`npm run migrate:departments:dry-run` previews the change without writing.
