# Poker Club OS v0.3 — redesign delivery report

Branch `feature/v0.3-redesign`, built on top of `v0.2.0` (commit `28b0a80`, preserved unchanged on
`backup/v0.2-original-design`). Commit identifiers are listed at the end of this document.

## 0. Revision 2 (after review)

- **Colour direction changed to "graphite & ember"** (option B of three rendered side by side):
  surfaces `#0c0f13`–`#242d36`, product accent ember `#ff8a3d`, gold `#e3c27a`. The product chrome
  (bars, sidebar, drawer, trail, tab strip) now keeps the product accent via the `product-scope`
  utility; club colours live only in club content. Demo club accents made distinct (gold, emerald,
  crimson) so the difference is visible in the demo.
- **Per-tournament table customisation extended:** besides the five built-in felts, the wizard's
  Table step offers free felt + rail colours (colour pickers, shades derived automatically) and
  club schemes: staff with the branding permission save a colour pair under a name, it appears in
  the theme list for every future tournament, and can be edited as a copy or removed. API:
  `saveTablePreset` / `deleteTablePreset`; model: `TableBranding.theme: … | 'custom' | preset:<id>`,
  `TableBranding.colors`, `ClubBranding.tablePresets`. Both table stages accept `themeVars`.
- **Multi-platform note:** the product is one responsive web app; it packages for iOS/Android
  (Capacitor) and desktop (Tauri/Electron) and installs as a PWA. Safe-area insets and 44 px touch
  targets are already respected in the phone layouts; no separate design per platform is planned.
- Tests: 153 unit tests (7 for table branding), browser journeys re-run on the final build (see §7).

## 1. What was delivered

**Priority 1 — design system, navigation, player dashboard (done)**

- A second stylesheet (`src/styles/app-v3.css`) with the brief's palette, a radius scale, panel /
  well / stage surfaces, and a three-voice type system: Inter for UI, Archivo (wide) for headlines
  and (condensed) for clocks, Heebo for Hebrew headlines. The v2 stylesheet gained the same token
  names so every primitive renders in both looks.
- Primitives restyled through tokens only (`src/ui/core.tsx`, `forms.tsx`, `overlay.tsx`,
  `charts.tsx`); 38 screen files had hard-coded radii replaced by the token utilities. Radius values
  are identical to v0.2 under the v2 stylesheet.
- New player shell: top bar (Home · Tournaments · My clubs · Rankings · Messages · Profile) with an
  account menu, notifications and settings icons, a five-tab bar on phones.
- New console shell: grouped sidebar (Overview / Poker operations / Community / Analytics /
  Settings), club switcher, context trail, live-tournament entry, "Leagues" marked *Planned* and not a
  link, a secondary tab strip on every CRM page, drawer on phones. Platform admin shell grouped the
  same way.
- New player home: one featured event (seat held → running → next start → sit & go) as a marquee
  with a table cameo (rail, felt, seat ring showing the field, the clock on the cloth), compact
  schedule rows, and a "Your week" panel with club rank, played, wins, final tables.
- New **Rankings** page (route `rankings`): standings per club with season filter, your place, top-3
  in gold. Built on the existing `clubRanking` selector and the club-page results visibility rule.

**Priority 2 — table, lobby, club profile, table branding (done)**

- `TableStage.v3`: same geometry and logic as v2; new padded rail with stitching, felt grain under a
  spotlight, dark-glass name plates with the stack in the display face, a timer ring around the
  avatar of the seat to act plus a breathing glow, refined action pills, dealer button, pot plate,
  open-seat markers; seats are not dimmed while no hand is in progress. Felt themes brightened.
- Lobby: new hero (club mark, display title, structure line, access badges, table cameo with the
  countdown / level / result); the start panel becomes compact so the clock is not shown twice.
- Club profile: taller cover fading into the surface, larger logo, display title.
- **Table branding** (new feature, both looks): a "Table" step in the tournament wizard with
  logo source (club default / this tournament only / none), image upload keeping transparency
  (PNG/WebP/SVG ≤ 512 KB; other formats are scaled to PNG), felt theme (club default or one of
  five), opacity (4–35 %) and size (50–140 %) sliders, and a live preview rendered by the same table
  component and the same resolver as the real table. Stored as `tableBranding` on the tournament;
  tournaments created before v0.3 have no setting and show the club logo on the club felt. The
  watermark sits below the board under every gameplay element.

**Priority 3 — console, CRM, forms (done where it mattered)**

- Console dashboard: a single "Today at a glance" strip (members, active 30 d, running, scheduled,
  pending requests, unread messages), each figure opening its page, instead of four metric cards.
- Analytics deep links: the sidebar opens Club analytics / Player retention / Conversion funnel
  directly on the right tab (`tab` route parameter).
- Dialogs, menus, toasts, inputs and tabs restyled through the primitives; CRM tables unchanged in
  structure (already dense) but inherit the new panel, badge and control styling.
- Responsive fixes found by the sweep: tournament cards no longer overflow at 360 px, stat tiles
  wrap their demo tag.

## 2. Changed files

New files

```
src/app/design.ts                 the DESIGN / V3 switch (from the build's __DESIGN__ define)
src/app/variants.ts               picks v2 or v3 components; the only place that does
src/app/shells.v3.tsx             v3 player / console / platform shells, groups, subnav, club switcher
src/styles/app-v3.css             v3 tokens, type voices, surfaces, table cloth, animations
src/player/Home.v3.tsx            v3 player home
src/player/Rankings.tsx           rankings page (new feature)
src/player/lobby-hero.tsx         v2 lobby title block, extracted unchanged
src/player/lobby-hero.v3.tsx      v3 lobby hero
src/shared/tournament.v3.tsx      FeaturedTournament, TournamentRow, TournamentList, TableCameo
src/table/TableStage.v3.tsx       v3 table stage
src/console/TableBrandingStep.tsx wizard "Table" step with live preview (new feature)
src/platform/table-branding.ts    resolve / normalise / validate table branding (new feature)
src/i18n/en.v3.ts, he.v3.ts       messages added in v0.3 (EN + HE)
tests/table-branding.test.ts      5 tests for the branding rules and draft validation
types/design.d.ts                 declaration of __DESIGN__
docs/DESIGN_V3.md                 design system
docs/screenshots/v0.3/            before / after screenshots
```

Modified files (functional)

```
scripts/build.mjs                 --design=v2|v3, per-design stylesheet and font links
src/app/App.tsx                   imports shells/Home from variants; rankings route
src/app/session.ts                routes 'rankings', 'console.leagues'
src/console/ConsoleRouter.tsx     analytics tab parameter; planned page for leagues
src/console/Wizard.tsx            Table step, review block, problem mapping
src/console/crm/Analytics.tsx     initialTab prop
src/console/Dashboard.tsx         KPI strip under v3 (v2 branch unchanged)
src/platform/types.ts             TableBranding, TABLE_LOGO_LIMITS, DEFAULT_TABLE_BRANDING
src/platform/api.ts               draft field, validation ('bad_table_logo'), storage, draftOf
src/table/TableScreen.tsx         stage from variants; table branding; v3 floor class
src/player/Lobby.tsx              hero extracted; compact start panel under v3
src/player/ClubPage.tsx           v3 hero classes
src/player/Welcome.tsx, Hands.tsx stage from variants
src/shared/tournament.tsx         CardAction exported; card rows wrap on narrow screens
src/ui/image.ts                   readImagePreservingAlpha
src/ui/charts.tsx                 KpiStrip; StatTile header wraps
src/i18n/en.ts, he.ts             include the v3 dictionaries
scripts/e2e.mjs                   nav helper knows the account menu and CRM subnav; wizard table step
README.md, docs/ARCHITECTURE.md, package.json (0.3.0)
```

Modified files (styling only, tokenised radii / primitive classes): `src/styles/app.css` (tokens and
fallbacks added, look unchanged), `src/app/shells.tsx`, `src/ui/core.tsx`, `forms.tsx`,
`overlay.tsx`, and 30 screen files under `src/console`, `src/player`, `src/platform-admin`,
`src/table`, `src/shared` (see `git diff --stat v0.2.0`).

## 3. Design system

See `docs/DESIGN_V3.md` for tokens, typography, surfaces, navigation rules, motion and rollback.
In short: one dark palette (`#0b1015` → `#19232d`), teal `#18a999` for interaction, gold `#d1ae68`
only for prestige (first place, winner glow, top-3), a single radius scale (4–14 px), Inter + Archivo
+ Heebo, decoration limited to the table cloth and one accent seam on hero surfaces.

## 4. Navigation improvements

- Player: six destinations, always visible; hand history, settings and the console link in the
  account menu; the active item is underlined (desktop) or highlighted (phone tab bar).
- Console: five groups with headings; a context trail (club › group › page) on every page; a club
  switcher for staff of several clubs with a link to the club's public page and the player app;
  "Live tournament control" points at the running tournament and is dimmed with a hint otherwise;
  "Leagues" is shown as *Planned* and is not navigable; CRM pages share a secondary tab strip so
  every CRM screen (segments, automation, notifications, CRM settings, analytics) keeps a direct way
  in; analytics entries open the right tab.
- Nothing links to a screen that does not exist; a direct address to `console.leagues` renders a
  planned page.

## 5. Table redesign summary

Same seat layout, bet spots, chip flights, showdown highlighting and dealing animations as v0.2
(the v2 file is untouched and still used by the v2 build). What changed: the room (`pc3-floor`),
a padded leather rail with a stitched seam, felt with cloth grain and a spotlight, a betting line,
dark-glass name plates with a one-pixel highlight, the stack set in the display face, a timer ring
around the avatar of the seat to act plus a breathing accent glow, refined action pills, an ivory
dealer button, a glass pot plate with condensed digits, quiet open-seat markers, and the tournament
logo drawn below the board under all gameplay elements, at the opacity and size configured per
tournament. The phone layout keeps the v0.2 portrait geometry; nothing is hidden on small screens.

## 6. Mobile and RTL validation

Screens checked at 1440, 1280, 768, 390 and 360 px in English and Hebrew (21 screens × 5 widths ×
2 languages = 210 loads) with `scratch/qc.mjs`: no horizontal overflow, no raw message keys, no
page errors, no error boundaries. Four overflows found at 360/390 px (tournament cards, platform
stat tiles) were fixed and re-checked. The live table was checked at 1280 and 390 px. Hebrew uses the
Heebo display voice; headlines, trails, tab strips, the table cameo and the KPI strip mirror
correctly. Screenshots: `docs/screenshots/v0.3/`.

## 7. Test results (executed on the final build)

- `npx tsc --noEmit`: clean.
- `node --import tsx --test tests/*.test.ts`: **153 / 153** (146 from v0.2 + 7 table-branding).
- Translation check (`scripts/i18n-check.mjs`): every key present in EN and HE.
- Browser journeys (`scripts/e2e.mjs`, headless Chromium, v3 build): **137 / 137** —
  A new player 15, B club owner 19 (incl. 2 new checks for the table step), C platform admin 14,
  D CRM demonstration 54, E access control 23, S Hebrew/phone/persistence 12.
- v2 build (`--design=v2`): compiles; home, console, wizard table step and live table rendered
  without errors and with the v0.2 appearance (screenshot `docs/screenshots/v0.3/before/*` are from
  this build or the v0.2 tour).

## 8. Git

- `backup/v0.2-original-design` → `28b0a80` (tag `v0.2.0`), untouched.
- `main` → `28b0a80`, untouched.
- `feature/v0.3-redesign` → `b340d8e` (tag `v0.3.0`): `236c314` "v0.3 redesign: Modern Poker Arena",
  `3220a72` docs, `b340d8e` revision 2 (palette B, chrome scope, table colour schemes).

## 9. Rollback

1. Reject the whole redesign, keep nothing: `git checkout backup/v0.2-original-design` and build.
2. Reject the look, keep the new features (rankings, table branding, analytics deep links, CRM
   subnav, account menu): on `feature/v0.3-redesign` run `node scripts/build.mjs --design=v2`.
   The v2 shells, home, lobby hero and table stage are selected and `app.css` is used.
3. Reject one screen: edit `src/app/variants.ts` and point that export at the v2 component.
4. Reject one primitive's styling: `git checkout v0.2.0 -- src/ui/<file>`; both stylesheets define
   the tokens it needs.
5. Merge when approved: `git checkout main && git merge feature/v0.3-redesign`.

## 10. Known limitations

- Archivo and Fraunces are not installed in the build sandbox, so the screenshots here show the
  Inter Display / Inter fallback for headlines; in a browser with network access Google Fonts load
  and the display voice is Archivo. Heebo is also loaded from Google Fonts for Hebrew.
- Leagues is a planned area (sidebar entry marked *Planned*, planned page at its address); nothing
  behind it.
- The v0.2 tournament card is still used on the Tournaments and Club pages (restyled through
  tokens); only the home page uses the new schedule rows.
- Light mode is not implemented; tokens are defined in one place so a light set can be added.
- Table logo images are stored as data URLs in the demo state (browser storage), like club logos;
  production would upload them to object storage.
- Some v0.2 wording quirks were left as they were (for example "Tomorrow · tomorrow" on the
  dashboard's upcoming list).

## 11. Implemented vs planned

| Item | Status |
| --- | --- |
| Design tokens, type system, primitives | Implemented |
| Player navigation + mobile tab bar | Implemented |
| Console grouped navigation, trail, club switcher, subnav | Implemented |
| Player dashboard (featured event, schedule rows, your week) | Implemented |
| Rankings page | Implemented (new) |
| Poker table visual upgrade | Implemented |
| Tournament lobby hero + tabs | Implemented (existing tabs: Players, Blind structure, Rules; Standings/Tables while running) |
| Club profile | Implemented |
| Table logo configuration + preview + fallback | Implemented (new) |
| Console dashboard KPI strip | Implemented |
| CRM visual improvement | Implemented through primitives; structure unchanged |
| Forms, dialogs, tables consistency | Implemented through primitives |
| Analytics deep links | Implemented |
| Leagues | Planned (marked) |
| Light mode | Not started (tokens ready) |
