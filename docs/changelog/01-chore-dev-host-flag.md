# chore: expose the Vite dev server on the LAN

## What changed

- `package.json`'s `frontend:dev` script now runs `npm run dev -- --host`, so the Vite dev server
  binds to all network interfaces instead of just `localhost`.

## Why

Convenience for testing the client from another device on the same network (e.g. a phone or a
second machine) during local development.

## Ops notes

None — this only affects local `npm run frontend:dev` usage, not any deployed environment.
