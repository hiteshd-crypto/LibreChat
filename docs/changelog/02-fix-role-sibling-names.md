# fix(role): allow duplicate sibling role names across departments

## What changed

- Dropped the `{ parentRole, name, tenantId }` unique index on the `Role` collection.
- Removed the sibling-name-clash checks (and the resulting `RoleConflictError`) from
  `createRoleByName`, `updateRoleByName`, and `setRoleParent` in
  `packages/data-schemas/src/methods/role.ts`.
- Removed the matching `name-clash` branch from the frontend's `reparentBlock` helper
  (`client/src/components/Admin/Access/reparent.ts`) and its tests.
- Removed the now-unused `com_admin_role_move_name_clash` translation key.

## Why

Only `roleKey` identifies a role; the name is just a display label. With Department
Management landing next, departments will routinely wrap top-level roles that share
names with roles in other branches (e.g. every department having its own "Manager"
role), so the sibling-uniqueness constraint has to go before that feature can land.

## Ops notes

None — this removes a constraint, it doesn't require a data migration.
