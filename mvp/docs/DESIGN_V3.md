# Poker Club OS — v0.3 design system ("Modern Poker Arena")

This document explains the v0.3 visual redesign: what changed, how it is built so it can be
switched off, and the rules the screens follow. The original v0.2 look is preserved on the
`backup/v0.2-original-design` branch and can also be built from this branch with `--design=v2`.

## 1. One switch, two looks

| Piece | v2 (original) | v3 (redesign) |
| --- | --- | --- |
| Stylesheet | `src/styles/app.css` | `src/styles/app-v3.css` |
| App shells (nav) | `src/app/shells.tsx` | `src/app/shells.v3.tsx` |
| Player home | `src/player/Home.tsx` | `src/player/Home.v3.tsx` |
| Lobby title block | `src/player/lobby-hero.tsx` | `src/player/lobby-hero.v3.tsx` |
| Poker table stage | `src/table/TableStage.tsx` | `src/table/TableStage.v3.tsx` |
| Tournament presentation | `src/shared/tournament.tsx` | `src/shared/tournament.v3.tsx` (featured marquee, schedule rows, table cameo) |

- `scripts/build.mjs --design=v2|v3` (or `PCOS_DESIGN=v2`) picks the stylesheet, the font links and
  defines `__DESIGN__`. The default is v3.
- `src/app/design.ts` exports `DESIGN` and `V3`. `src/app/variants.ts` is the only place that chooses
  between a v2 and a v3 component; `App.tsx`, `TableScreen.tsx`, `Lobby.tsx`, `Welcome.tsx` and
  `Hands.tsx` import from it.
- A handful of v2 files carry small `V3 ? … : …` class switches where a full variant file would have
  duplicated hundreds of lines for a few classes: `ClubPage.tsx` (hero), `Dashboard.tsx` (KPI strip),
  `Lobby.tsx` (compact start panel), `TableScreen.tsx` (floor).
- New functionality (rankings page, table branding, analytics deep links, CRM secondary navigation,
  account menu) lives in design-independent modules and is available in both builds.

## 2. Tokens

Defined in `@theme` of `app-v3.css`; the v2 stylesheet defines the same token *names* with its own
values, so components written against tokens render correctly in both.

| Token | v3 value | Use |
| --- | --- | --- |
| `--color-bg` | `#0c0f13` | Page background (graphite) |
| `--color-bg-2` | `#0e1217` | Deeper areas (hero gradients) |
| `--color-surface` | `#13181e` | Panels, bars |
| `--color-raised` / `--color-raised-2` | `#1b2229` / `#242d36` | Hover, inputs, menus |
| `--color-line` / `--color-line-strong` | `#2a333c` / `#3b4752` | Hairlines, borders |
| `--color-ink` / `-2` / `-3` | `#f3f5f7` / `#9ea9b3` / `#6f7a85` | Text hierarchy |
| `--color-brand` (accent default) | `#ff8a3d` | Ember: the product's own interaction colour (nav, primary buttons, active marks) |
| `--color-gold` | `#e3c27a` | Prestige only: first place, winner glow, top-3 rank tiles |
| `--color-success` / `warning` / `danger` / `info` | `#2cb67d` / `#e9a23b` / `#e85d68` / `#5b9cf0` | Status |
| `--radius-chip/badge/control/inner/panel/hero` | 4 / 5 / 6 / 8 / 10 / 14 px | One radius scale; `rounded-chip` … `rounded-hero` utilities |
| `--shadow-pop`, `--shadow-plate` | | Menus/dialogs; table name plates |

Direction "graphite & ember" (chosen over "velvet & brass" and "midnight & champagne" after a
side-by-side render). The brief's teal was replaced by ember because teal was indistinguishable from
the demo clubs' own accents.

The club accent is still a live variable (`--accent`, set by `accentStyle()`), so each club re-skins
its own content: hero, cards, table, club page. The product's chrome — top bar, phone tab bar,
console sidebar, drawer, context trail and CRM tab strip — carries the `product-scope` utility,
which pins `--accent` back to ember, so the product keeps one identity across every club and the
club's colour is seen in its content, not in the menus. The three demo clubs use distinct accents
(Midnight: champagne gold `#E2B35A`, River Kings: emerald `#2FB37F`, The Final Table: crimson
`#E0485A`).

## 3. Typography

- **Inter** for UI text (also the Hebrew fallback chain includes **Heebo**).
- **Archivo** (variable width) as the display face: `display` utility = wide cut, 700, tight tracking,
  tabular numerals — headlines, tournament names, stat values. `clock-digits` = condensed cut for
  countdowns and big figures.
- In Hebrew (`[dir=rtl] .display`) the display voice falls back to **Heebo 800**, so RTL headlines keep
  weight and rhythm without a Latin-only face.
- **Fraunces** remains available only for clubs whose branding chooses a serif title.
- Labels are sentence case; no tracked-out all-caps eyebrows; only the felt watermark keeps small caps.

Fonts load from Google Fonts in `index.html`; without network access the stack falls back to the
local "Inter Display"/Inter and Heebo, which is what the sandbox screenshots show.

## 4. Surfaces and utilities

- `panel` — a panel with a one-pixel top highlight; `well` — an inset area inside a panel;
  `stage` — the hero surface with a soft spotlight in the club accent; `rows` — hairline-divided lists.
- Table: `pc3-floor` (the room), `pc3-rail` (padded leather with stitching), `pc3-felt` (cloth grain
  + spotlight), `pc3-felt-line`, `pc3-plate` / `pc3-plate-hero` (name plates), `anim-turn` (breathing
  glow on the seat to act), `turn-ring` (timer ring around the avatar). Felt themes `felt-midnight`,
  `felt-emerald`, `felt-royal`, `felt-burgundy`, `felt-graphite` set `--felt-*` and `--rail-*`.
- Cards (`pc-card`, `pc-card-back`) and chips (`pc-chip`) are drawn with CSS only — no bitmaps.

## 5. Navigation

Player app (top bar on desktop, five-tab bar on phones): Home · Tournaments · My clubs · Rankings ·
Messages · Profile. Notifications and Settings are icons in the bar; an account menu (`nav-more`)
holds Profile, Hand history, Settings and the console link for staff.

Club console (grouped sidebar, drawer on phones), with a context trail above every page
(club › group › page) and a club switcher at the top:

- Overview — Dashboard
- Poker operations — Tournaments, Live tournament control (points at the running tournament, dimmed
  when nothing runs), Leagues (**planned**, not a link)
- Community — Members, CRM, Inbox, Announcements; every CRM page also shows a secondary tab strip
  (CRM overview, Players, Membership requests, Tags and segments, Inbox, Announcements,
  Notifications, Automation, CRM settings)
- Analytics — Club analytics, Player retention, Conversion funnel (deep links into the analytics tabs)
- Settings — Branding, Roles & permissions, Club settings, Activity log, Subscription, Support

Entries are filtered by the signed-in role's permissions, as before. Nothing links to a screen that
does not exist.

## 6. Motion

Only state changes move: cards deal and flip, chips fly to the pot, the seat to act breathes, menus
and sheets pop in. Page content does not fade in. `.reduce-motion` (user setting) and
`prefers-reduced-motion` disable all of it.

## 7. Table branding (new feature)

`TableBranding` on a tournament (`source: club | custom | hidden`, `logoDataUrl`, `opacity`, `scale`,
`theme`, `colors`). `theme` is one of the five built-in felts, `club` (the club default),
`preset:<id>` (a scheme the club saved) or `custom` with free `colors: { felt, rail }`.
`platform/color.ts` derives every shade the cloth needs (`--felt-a/b/c`, `--rail-a/b/c`) from those
two colours, so a scheme is two values and the lighting, grain and stitching come from the CSS.
`platform/table-branding.ts` resolves a tournament against the club (fallback to the club logo and
club felt; a removed scheme falls back to the club default; older tournaments have no setting and
behave as `club`). The same resolver feeds the wizard preview, the home cameo and the live table,
and clamps opacity to 4–35 % and size to 50–140 % so the mark never competes with cards and chips.
Club schemes (`ClubBranding.tablePresets`, up to 8) are saved from the wizard by staff with the
branding permission; everyone with tournament rights can pick one. A player's own felt preference in
Settings still overrides the tournament's scheme on their screen. The watermark sits below the
board, under every gameplay element.

## 8. Rollback

- Whole look: `git checkout backup/v0.2-original-design` (v0.2 exactly as shipped), or on this
  branch `node scripts/build.mjs --design=v2` (v0.2 look with the v0.3 features).
- One screen: point the export in `src/app/variants.ts` back at the v2 component.
- One primitive: revert the file under `src/ui/`; both stylesheets define every token it needs.
