# feat(admin): department-scoped balance read access

## What changed

- `packages/api/src/admin/balance.ts`: `GET /api/admin/balance/:userId` now accepts a
  `DEPARTMENT_HEAD` caller, not just `ACCESS_ADMIN` — but only to view their own balance or a
  current member of their own branch (self-or-descendant in the role tree, via `isDescendantOf`).
  `PATCH` (editing) stays `ACCESS_ADMIN`-only, enforced at the route level.
- Every successful balance edit now records a `balance.edited` audit entry (actor, target,
  previous/new `tokenCredits`, and whether it went through the plain-overwrite or
  optimistic-concurrency path).
- New `balance` audit category and `balance.edited` audit action
  (`packages/data-schemas/src/types/admin.ts`).

## Why

This is the backend half of giving a Department Head visibility into their own department's
balances. It's intentionally backend-only and currently dormant — no frontend route reaches it
yet, since the Balance page's Department Head view and its member-listing dependency land
together in the next commit (department balance pool, grant, disburse & transfer). Landing the
scoping and audit logic first keeps that commit's diff focused on the pool/money-movement logic.

## Ops notes

None — purely additive capability check; existing Super Admin behavior is unchanged.
