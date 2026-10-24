# Native foundation (dev client, EAS Update, Sentry)

Added on branch `native-foundation` (Floodlight Phase B). One new native build carries every module
the redesign needs, so later screen work ships as JS-only EAS Updates.

## Native modules in this build

expo-dev-client, expo-updates, expo-blur, expo-haptics, expo-image, expo-linear-gradient,
expo-clipboard, expo-camera (owner check-in scan), react-native-gesture-handler, @gorhom/bottom-sheet
(on react-native-reanimated, already installed), @shopify/flash-list, lucide-react-native (on
react-native-svg), @sentry/react-native, plus the Bricolage Grotesque and Plus Jakarta Sans fonts.
Adding any other native module later means a new build (an update cannot add native code).

The root layout (`app/_layout.tsx`) wraps the app in `GestureHandlerRootView` + `BottomSheetModalProvider`
and loads the Floodlight fonts next to the old ones (the splash stays up until all fonts are loaded).

Workspace note: `npx expo-doctor` reports duplicate react / gesture-handler / reanimated / worklets (the
workspace root has other copies, pulled in as peers of hoisted packages). Expo's autolinking resolver
(on by default in a workspace) pins all of them to `apps/mobile/node_modules`, which `expo export
--platform android` with source maps confirmed: one copy of each in the bundle.

## Which API a build talks to

`lib/config.ts` -> `lib/api-base-url.ts`: `EXPO_PUBLIC_API_BASE_URL` > `app.json` `extra.apiBaseUrl`
(PRODUCTION) > `http://localhost:8000`. A dev bundle (`__DEV__`: Metro, dev client) never falls through to
the production URL; without the env var it uses localhost.

| Profile | channel | API |
|---|---|---|
| development | `development` | `EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8000` (Android emulator -> your PC). The dev client loads JS from your Metro, so what counts is the env var in the shell that runs `npx expo start --dev-client` (set it to your PC's LAN IP for a real phone). |
| preview | `preview` | unchanged: app.json `extra.apiBaseUrl` (production API) |
| production | `production` | unchanged: app.json `extra.apiBaseUrl` (production API) |

`eas update` bundles with YOUR shell's env, not eas.json's. Before publishing a preview/production
update, make sure `EXPO_PUBLIC_API_BASE_URL` is NOT set in that shell (or the update would point the
app at localhost). `Remove-Item Env:EXPO_PUBLIC_API_BASE_URL -ErrorAction SilentlyContinue`.

## Sentry

`lib/sentry.ts` initialises only when `EXPO_PUBLIC_SENTRY_DSN` is set (`lib/sentry-rules.ts`, tested in
`lib/native-foundation.test.ts`); web (`lib/sentry.web.ts`) is always a no-op, and without a DSN the root
is not even wrapped. The DSN is never logged. To turn it on, add `EXPO_PUBLIC_SENTRY_DSN` as an EAS
environment variable (or in the profile's `env`) and rebuild / republish.

The `@sentry/react-native/expo` config plugin is in app.json without org/project, and every eas.json
profile sets `SENTRY_DISABLE_AUTO_UPLOAD=true`, so builds never need `SENTRY_AUTH_TOKEN` (no source-map
upload). To get readable stack traces later: add org/project to the plugin, set `SENTRY_AUTH_TOKEN` as an
EAS secret, and remove `SENTRY_DISABLE_AUTO_UPLOAD`.

## Commands (PowerShell, from `court-booking-frontend\apps\mobile`)

Not run by the agent: each of these talks to Expo's servers and needs your login. eas-cli is not
installed globally on this machine, so the commands use `npx eas-cli@latest`; after
`npm install -g eas-cli` you can type `eas ...` instead (e.g. `eas whoami`).

```powershell
cd "C:\Users\Noman Traders\Desktop\Court Booking App\court-booking-frontend\apps\mobile"

# 1. Who am I logged in as? (expect abdulrafay879, owner of the EAS project @abdulrafay879/khelo)
npx eas-cli@latest whoami
# if not logged in:
npx eas-cli@latest login

# 2. EAS Update setup. app.json already has runtimeVersion (appVersion policy) and
#    updates.url (https://u.expo.dev/<projectId>), and eas.json has the channels, so this
#    should report nothing to change. Run it once anyway to confirm.
npx eas-cli@latest update:configure

# 3. Dev-client build (Android APK, installs next to any other build)
npx eas-cli@latest build --profile development --platform android

# 4. Run the dev client against your local backend
#    Emulator: 10.0.2.2 is your PC. Real phone on the same Wi-Fi: use your PC's LAN IP
#    (ipconfig -> IPv4), and the backend must listen on 0.0.0.0.
$env:EXPO_PUBLIC_API_BASE_URL = "http://10.0.2.2:8000"
npx expo start --dev-client --clear

# 5. Preview build (internal APK, production API, channel "preview")
npx eas-cli@latest build --profile preview --platform android

# 6. Later: ship JS-only changes to preview builds (no new APK)
Remove-Item Env:EXPO_PUBLIC_API_BASE_URL -ErrorAction SilentlyContinue
npx eas-cli@latest update --channel preview --message "Floodlight: <what changed>"
```

An update only reaches builds with the same runtime version (= app `version`, now `1.0.0`). Bump
`version` in app.json whenever native code changes, then build again.

## Needs a real device

The dev-client build itself, gesture/bottom-sheet feel, haptics, blur, expo-image caching, Sentry events
(with a DSN), and receiving an EAS Update. Expo web only proves the JS boots (it does: login renders,
no gesture/bottom-sheet/sentry errors).

Identity (decided 2026-10-25, see docs/rename-khelo.md): name `Khelo`, slug `khelo`, package / bundle id
`com.aftrsolutions.khelo`, schemes `khelo://` (main) and `maidan://` (old links keep working), EAS project
`@abdulrafay879/khelo` (projectId `e166063a-198d-4bf8-9e12-299a98cd8b18`). The old `maidan-app` project is not used.
`google-services.json` must contain an Android client for `com.aftrsolutions.khelo` (Firebase console), or the
Android build fails.
