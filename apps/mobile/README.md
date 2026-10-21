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
| `src/app/_layout.tsx` | Root stack, navigation theme, font loading (splash held until ready). |
| `src/app/(tabs)/` | Bottom tabs: Home, Search, Bookings, Inbox, Account. |
| `src/app/(auth)/` | Sign-in (Email \| Phone code tabs) and sign-up, presented as one modal over the tabs. |
| `src/screens/` | Route-independent screens that take props (e.g. `AccountScreen` receives the session). |
| `src/components/` | Shared UI: `Text`, `Button`, `Card`, `Badge`, `Chip`, `Screen`, `EmptyState`, `ListRow`, `SearchField`, `TabBar`, seasonal hero. |
| `src/lib/` | App helpers (category icons, season/greeting), plus the API layer below. |
| `src/lib/auth.ts` | Better Auth client (`authClient`, `useSession`), API base URL, auth error copy. |
| `src/lib/trpc-client.ts` / `trpc.tsx` | tRPC client with the session cookie; `ApiProvider` (TanStack Query) and `useTRPC`. |
| `src/lib/auth-ui.tsx` | Form pieces used by the auth and account screens (`TextField`, `FormAlert`, tabs). |
| `src/theme/` | Seasons palette and type scale built on `@nevile/tokens`; `fonts.ts` lists the bundled font files. |

## API and sign-in

The app talks to the web app's `/api/auth/*` (Better Auth) and `/api/trpc/*` (the shared
API). Set its origin in `EXPO_PUBLIC_API_URL`; the default is `http://localhost:3000`.

```bash
# apps/mobile/.env.local (git-ignored). Expo inlines EXPO_PUBLIC_* at bundle time,
# so restart `expo start` after changing it.
EXPO_PUBLIC_API_URL=http://localhost:3000      # iOS simulator
# EXPO_PUBLIC_API_URL=http://10.0.2.2:3000     # Android emulator
# EXPO_PUBLIC_API_URL=http://192.168.1.20:3000 # phone on the same Wi-Fi (your computer's IP)
```

Release builds must set it to the production `https://` origin; a missing value logs an
error and falls back to localhost.

- Sessions are cookie-based, as on the web. The `@better-auth/expo` plugin keeps the
  `nevile.*` cookies in the keychain/keystore (`expo-secure-store`) and restores the session
  on launch; the tRPC client sends the same cookie (`authClient.getCookie()`) with
  `credentials: "omit"` so the platform cookie jar never adds its own.
- Auth requests carry an `expo-origin` header that the server checks against its trusted
  origins. Development and release builds send `nevile://` (always trusted). Expo Go sends
  `exp://…`, which the server trusts only when it runs with `NODE_ENV=development`
  (`next dev`).
- Sign-up emails link to the website's `/verify-email` page; after confirming, people sign
  in in the app with their email and password. Phone codes create the account on first
  use.

Auth constants (cookie prefix, OTP length, name limit) and the client factory come from
`@nevile/auth/client`, the server-free entry point of the auth package, so the app and the
server cannot drift apart.

Workspace packages (`@nevile/core`, `@nevile/tokens`, `@nevile/auth/client`) are imported as TypeScript source;
Expo's Metro config resolves them in the monorepo without a custom `metro.config.js`.

## Design notes

- Light-only for now (`userInterfaceStyle: "light"`); the Seasons palette has no dark variant yet.
- Fonts: Bricolage Grotesque (display, 700) and Figtree (body, 400/500/600) from
  `@expo-google-fonts/*`. Only those faces are bundled (`src/theme/fonts.ts`), and the root
  layout keeps the splash screen up until they are registered. Each weight is its own
  family name (`fontFamily.displayBold`, `fontFamily.bodySemiBold`, …): pick the family
  instead of setting `fontWeight`, which Android ignores or fakes for custom fonts.
- Icons use `expo-symbols`: SF Symbols on iOS, Material Symbols on Android/web.
- Touch targets are at least 44pt; interactive elements carry accessibility roles and labels.
