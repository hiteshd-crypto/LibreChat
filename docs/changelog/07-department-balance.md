# feat(admin): department balance pool, grant, disburse & transfer

## What changed

- **`DepartmentBalance` model** (`packages/data-schemas/src/schema/departmentBalance.ts`): a pool
  balance per department, separate from any individual member's personal `tokenCredits`.
- **Backend** (`packages/api/src/admin/departmentBalance.ts`): Super Admin grants a lump sum into
  a department's pool; a Department Head previews/confirms an even-split disbursement from the
  pool to chosen members, or a member-to-member transfer — both backed by a real MongoDB
  transaction with staleness detection (`commitGrantTransaction`/`commitDisbursementTransaction` in
  `packages/data-schemas/src/methods/balance.ts` and `departmentBalance.ts`). Shared allocation
  math lives in `packages/api/src/admin/grantMath.ts`.
- **Migration**: `config/migrate-department-balances.js`
  (`npm run migrate:department-balances[:dry-run]`) moves any pre-existing per-head personal
  balances into the new pool model.
- **Frontend**: `/admin/balance` now dispatches to `SuperAdminBalanceView` (unchanged, editable)
  or `DepartmentBalanceView` (read-only, scoped to the caller's own department — this is where
  the department-scoping backend from the previous commit becomes reachable). A new
  `/admin/token-distribution` route hosts `DepartmentGrantView` (Super Admin: grant into a
  department's pool) and `DepartmentHeadBalanceView` (Disburse/Transfer tabs for a Department
  Head).
- New `balance.departmental_distribution`/`balance.internal_distribution` audit actions.

## Why

Completes the Department Head's money-management picture: they can now see their department's
balances (building on the previous commit's read-scoping) and move money within their own
department — without ever touching another department's data or getting `ACCESS_ADMIN`.

## Ops notes

Run `npm run migrate:department-balances` after deploying (or let it run automatically at boot)
to move any existing per-head personal balances into the pool model.
