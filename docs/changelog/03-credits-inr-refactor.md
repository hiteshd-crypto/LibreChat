# feat: move currency math to data-provider, switch balance display to INR

## What changed

- Moved credit/currency conversion (`creditsToInr`, `inrToCredits`, `formatInr`) from
  `client/src/components/Admin/Balance/credits.ts` into `packages/data-provider/src/credits.ts`,
  so both the admin UI and future consumers (Department Balance, Token Distribution, Nav balance
  displays) share one implementation.
- `client/src/utils/credits.ts` is now a thin re-export of the data-provider helpers.
- Deleted the old USD-only `credits.ts`/`credits.test.ts` under `Admin/Balance`.
- `BalanceEditor.tsx` now displays and edits balances in INR instead of USD.

## Why

Multiple upcoming Admin Panel features (department pool balances, token grants, disbursement,
transfers) need the same currency conversion, and the business has standardized the admin-facing
display on INR. Centralizing the conversion in `data-provider` avoids duplicating it per feature.

## Ops notes

Display-only change — no stored values change meaning or format; `tokenCredits` is still the
underlying unit everywhere.
