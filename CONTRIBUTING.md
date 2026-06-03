# Contributing to G-Taxi

## Quick Start

```bash
npm install --legacy-peer-deps
```

## Before Pushing

Run all quality gates:

```bash
npm run lint        # ESLint
npm run typecheck   # TypeScript compilation (all apps)
npm test            # Jest + Vitest tests
```

The CI pipeline runs these three steps sequentially. All must pass.

## Project Structure

```
apps/
  rider/      # Rider mobile app (Expo/React Native)
  driver/     # Driver mobile app (Expo/React Native)
  admin/      # Admin dashboard (Vite/React)
  merchant/   # Merchant app (Vite/React)
packages/
  core/       # Shared types, API client, error handling
  shared/     # Shared React components and hooks
supabase/
  functions/  # Edge functions (Deno/TypeScript)
  migrations/ # Database migrations
```

## Code Style

- TypeScript strict mode enabled across all apps
- ESLint + Prettier for consistent formatting
- Run `npm run format` to auto-fix formatting

## Testing

| App | Framework | Run |
|---|---|---|
| rider | Jest (React Native Testing Library) | `npm --workspace apps/rider test` |
| driver | Jest (React Native Testing Library) | `npm --workspace apps/driver test` |
| admin | Vitest | `npm --workspace apps/admin test` |
| merchant | Vitest | `npm --workspace apps/merchant test` |

Always add or update tests when changing functionality.

## Environment

- Supabase project: `ffbbuafgeypvkpcuvdnv.supabase.co`
- Client-side `.env` files use the anon key only (`EXPO_PUBLIC_SUPABASE_ANON_KEY`)
- Service role key is NEVER placed in client bundles
- Edge function secrets must be configured in the Supabase dashboard

## Git Workflow

- Commit messages follow conventional format
- Keep commits focused on single logical changes
- Verify with `npm run verify:all` before pushing
