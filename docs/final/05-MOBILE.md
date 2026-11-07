# 05 — Mobile & Multi-Platform Delivery

> **Audience: engineering.** How Poker Club OS ships as a **website and native iOS/Android apps
> from one codebase**, what the real native work items are, and the app-store gate. Depends on
> the auth (Phase 4) and server-side push (Phase 5) from `08-ROADMAP.md`.

---

## 1. The approach — one bundle, two targets (Capacitor, not a rewrite)

The product ships **two ways from a single React bundle**: a **website** (S3/CloudFront SPA)
and **native apps** in the App Store and Play Store. The native apps are a **Capacitor** shell
wrapping the *same* static assets — **not** a React Native rewrite (which would re-code all
~55 screens). The engine, service layer, and permission checks are byte-for-byte identical
across targets.

- The reworked `build.mjs` (required anyway by `06-AWS-ARCHITECTURE.md` / Phase 6) emits static
  JS/CSS instead of one inlined HTML.
- The **website** serves those assets from CloudFront/S3.
- The **native apps** wrap the same assets in a Capacitor WebView shell (`@capacitor/ios`,
  `@capacitor/android`), producing a signed `.ipa` and `.aab`.

## 2. Why this is cheap here (grounded in the current code)

- **Self-contained bundle** — no bundler framework or asset pipeline to untangle
  (`mvp/scripts/build.mjs`).
- **In-memory routing with no URL/history coupling** (`mvp/src/app/session.ts`, `go()` in
  `hooks.ts`) — nothing to reconcile with native navigation.
- **Mobile ergonomics already done** — `viewport-fit=cover`, `color-scheme`, safe-area insets,
  and 44px touch targets from the v3 redesign; responsive QC already covers 360/390px widths.
- **The seams exist** — a `push` channel and the `registerAdapter` seam already exist
  (`mvp/src/platform/channels.ts`); mobile auth is already planned as refresh tokens (`03` §5).

## 3. The real native work items

### 3.1 PWA baseline (also upgrades the website)

Web manifest, icon set, service worker, offline app-shell, and **self-host the Google Fonts**
that are loaded from the CDN at runtime today (`build.mjs`). This makes the **website** an
installable PWA too — a shared benefit, not just mobile.

### 3.2 Capacitor projects

Add iOS + Android platforms; app icons/splash; status-bar + safe-area config (CSS insets
already present); `@capacitor/app` pause/resume to flush state (mirrors the existing `pagehide`
flush in `context.ts`).

### 3.3 Native bridge shims behind existing seams

Replace WebView-hostile paths — each maps to one existing seam:

| Today | Problem in native WebView | Native shim |
|---|---|---|
| Anchor-`download` exports: ICS (`Calendar.tsx`), CSV (`crm/Migration.tsx`), QR (`shared/qr.tsx`) | **Break in iOS WKWebView** | `@capacitor/filesystem` + share sheet |
| `localStorage` persistence (`store.ts`) | **Evictable** in WKWebView — users silently lose state | `@capacitor/preferences` / SQLite |
| Camera/QR scan (placeholder today, `Clubs.tsx`) | No camera access | A scanner plugin |
| Android hardware back | Not wired | `session.back()` |
| OS deep links + push-tap | Not wired | route via `go(name, params)` (`hooks.ts`) |
| `navigator.clipboard` | Unreliable in WebView | A clipboard plugin |

### 3.4 On-device push

`@capacitor/push-notifications` to obtain APNs/FCM device tokens and register them with the
API; wire the real push adapter (`channels.registerAdapter`). The **server** half is already
Phase 5 — this is only the incremental client side.

### 3.5 Mobile CI + store submission

Fastlane / Codemagic (or EAS) to build + sign; Apple Developer + Google Play accounts; privacy
"nutrition labels" / Data Safety forms; screenshots/metadata; TestFlight / internal-testing
tracks; review cycles. See `07-CICD-PIPELINE.md` §mobile.

## 4. Auth (ties to `03` §5)

Already specified: web = HttpOnly session cookies, **mobile = refresh tokens**. The mobile auth
path is accounted for in Phase 4; mobile delivery just consumes it.

## 5. The store-policy gate (important)

A poker app — **even virtual-chips-only** — is treated as a **"social casino" / gambling-category**
app by both stores. Expect:

- **Age-gating** (17+ / 18+),
- possible **regional availability restrictions**,
- extra review scrutiny (Apple Guideline 5.3, Google gambling policy).

This is a real submission gate that **overlaps the legal gate** (`00-INDEX.md`). It is **not**
RNG certification (still out of scope) — and the UI must continue to never claim certification.
**Open this gate early**, in parallel with engineering.

## 6. Effort

≈ **+6–10 weeks of engineering** on top of the web build:

| Work item | Rough effort |
|---|---|
| PWA baseline | ~1–1.5 wk |
| Capacitor projects | ~1–2 wk |
| Native bridge shims | ~2–3 wk |
| On-device push | ~1–2 wk |
| Mobile CI + store submission | ~2–3 wk |

Plus external store-review calendar time (not engineering).

## 7. Deferred (reachable from the same bundle)

Desktop shells (Tauri / Electron) are deferred but reachable from the same bundle. Multi-region
and any real-money mobile flows are out of scope.
