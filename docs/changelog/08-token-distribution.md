# feat(admin): hierarchical token distribution

## What changed

- `packages/api/src/admin/tokenDistribution.ts` + `api/server/routes/admin/tokenDistribution.js`:
  a root user previews/confirms an even-split grant of tokens across themself and their current
  descendants in the role hierarchy, backed by the same transaction/staleness machinery
  (`commitGrantTransaction`, `grantMath.ts`) introduced for Department Balance.
  `packages/data-schemas/src/methods/role.ts` gains `listUsersByRoles`, the multi-role lookup this
  flow needs to resolve every descendant's user record in one query.
- New `balance.self_grant` audit action.
- `client/src/components/Admin/TokenDistribution/GrantDialog.tsx` and `split.ts`: the Super Admin
  UI for this flow. **Not currently wired to a route** — `TokenDistributionView` (added in the
  previous commit) only renders `DepartmentGrantView`/`DepartmentHeadBalanceView`; this
  root-to-descendant flow was superseded by the department-grant model before `GrantDialog` was
  connected to anything. It's included here because it's the frontend counterpart to this
  commit's backend, not because it's reachable yet.

## Why

This hierarchical grant predates the Department model and is kept for completeness and potential
reuse, but the department-scoped grant/disburse/transfer flow (previous commit) is the
UI users actually reach today.

## Ops notes

None.
