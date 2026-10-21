# Nevile mobile

Expo (SDK 58) iOS and Android app for Nevile, using Expo Router and the "A · Seasons"
design (SPEC.md §13). Read `AGENTS.md` before touching Expo APIs — they change every SDK.

## Run

```bash
pnpm --filter @nevile/mobile start      # dev server (press i / a for a simulator)
pnpm --filter @nevile/mobile typecheck
npx expo export --platform ios          # bundle smoke test (run inside apps/mobile)
```

## Layout

| Path | Purpose |
|---|---|
| `src/app/_layout.tsx` | Root stack + navigation theme. |
| `src/app/(tabs)/` | Bottom tabs: Home, Search, Bookings, Inbox, Account. |
| `src/app/(auth)/` | Reserved for the sign-in flow. |
| `src/screens/` | Route-independent screens that take props (e.g. `AccountScreen` receives the session). |
| `src/components/` | Shared UI: `Text`, `Button`, `Card`, `Badge`, `Chip`, `Screen`, `EmptyState`, `ListRow`, `SearchField`, `TabBar`, seasonal hero. |
| `src/lib/` | App helpers (category icons, season/greeting). `src/lib/auth*` is reserved for auth. |
| `src/theme/` | Seasons palette and type scale built on `@nevile/tokens`. |

Workspace packages (`@nevile/core`, `@nevile/tokens`) are imported as TypeScript source;
Expo's Metro config resolves them in the monorepo without a custom `metro.config.js`.

## Design notes

- Light-only for now (`userInterfaceStyle: "light"`); the Seasons palette has no dark variant yet.
- Fonts fall back to the system font. Bricolage Grotesque (display) and Figtree (body) need
  `@expo-google-fonts/bricolage-grotesque` and `@expo-google-fonts/figtree`; once added, set
  them in `src/theme/index.ts` (`fontFamily`).
- Icons use `expo-symbols`: SF Symbols on iOS, Material Symbols on Android/web.
- Touch targets are at least 44pt; interactive elements carry accessibility roles and labels.
