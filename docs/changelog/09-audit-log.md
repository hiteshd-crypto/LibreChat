# feat(admin): audit log action taxonomy, CSV export & admin UI

## What changed

- Completed the `AUDIT_ACTIONS`/`AUDIT_CATEGORIES` taxonomy: `balance.token_grant` (legacy —
  nothing currently emits it, kept only so `auditDisplay.ts` can remap historical rows to their
  specific successor action) and the new `auth.login`/`auth.logout` actions with an `auth`
  category.
- `packages/api/src/admin/auditLog.ts`: CSV export now resolves display-friendly action/metadata
  text via the new `packages/data-provider/src/auditDisplay.ts`, drops raw actor/target IDs and
  the integrity seq/hash columns, strips the `::ffff:` IPv6 prefix from actor IPs, and formats
  numbers with the `en-IN` locale.
- Auth events are now audited: `LoginController`, `LogoutController`, `TwoFactorAuthController`,
  and `oauth.js` each call `recordAdminLoginAudit`/`recordAdminLogoutAudit` (fail-open, logs admin
  actors only).
- `GET /api/admin/hierarchy/me` now also returns `canReadAuditLog`, independent of `isAdmin`.
- New `/admin/audit-log` page (`AuditLogView`, `AuditLogRow`, `displayAction.ts`): a filterable,
  paginated table with CSV export and on-demand hash-chain integrity verification
  (`useVerifyAdminAuditLog`). Gated in the nav by `canReadAuditLog`, not `isAdmin`.
- `LocalizedDateRangePicker.tsx`: dark-mode fix for the native date inputs used by this page's
  date-range filter. `client/vite.config.ts` forwards `X-Forwarded-*` headers in the dev proxy so
  local dev can exercise actor-IP capture.

## Why

Gives a dedicated, non-admin `READ_AUDIT_LOG` capability holder (e.g. a compliance/security role)
visibility into every audited action across the Admin Panel — department, balance, grant, and now
auth events — without granting `ACCESS_ADMIN`.

## Ops notes

None — additive. Historical audit rows written before this change (if any exist) display via the
legacy `balance.token_grant` remap in `auditDisplay.ts`.
