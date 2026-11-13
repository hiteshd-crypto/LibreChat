# feat: notifications & spend alerts

## What changed

- **`Notification` model** (`packages/data-schemas/src/schema/notification.ts`): generic,
  user-scoped notifications with a type/severity/title/message and a `read` flag.
- **`spendAlert.ts`**: after a real chat spend, checks whether the spending user just crossed
  their own 80% or 100% "received" threshold (`totalReceived` vs current `tokenCredits`, added in
  the Department Balance commit) and creates a notification if so — tracked via
  `lastAlertLevel` so the same crossing never re-fires.
- **Wiring**: `packages/data-schemas/src/methods/transaction.ts` fires a non-blocking `onSpend`
  hook after every real spend (never a refill/credit); `methods/index.ts` late-binds the
  spend-alert checker into it. `api/server/middleware/abortMiddleware.js` and the three agent
  controllers (`client.js`, `openai.js`, `responses.js`) also call the checker directly on their
  own spend-recording paths, and push an `ON_SPEND_THRESHOLD` SSE event over the active stream so
  the client refetches instantly instead of waiting for its next poll.
- **API**: `packages/api/src/notifications.ts` + `api/server/routes/notifications.js` — list,
  unread-count, and mark-read endpoints.
- **Frontend**: `NotificationBell`/`NotificationList` in the sidebar (polls unread count as a
  fallback for anyone without an open stream) and a global `SpendAlertModal` mounted in `Root.tsx`.
- Nav/Settings balance displays (`AccountSettings`, `AutoRefillSettings`, `TokenCreditsItem`) now
  show INR via the `creditsToInr`/`formatInr` helpers introduced earlier in this series, instead
  of a raw credit count.

## Why

Closes the loop on the Department Balance work: a user (not just a Department Head) now finds out
when their own balance is running low, in near-real-time if they're actively chatting.

## Ops notes

None — purely additive; existing balances are unaffected (`totalReceived`/`lastAlertLevel` default
to 0 and start accumulating from this point forward).
