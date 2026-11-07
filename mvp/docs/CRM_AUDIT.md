# Audit of the existing application

Carried out before any CRM work, against the build delivered earlier
(`poker-club-os-source.zip`, version 0.1.0). File and line references are to
that baseline. Verdicts: **PASS**, **PARTIAL**, **FAIL**, **UNVERIFIED**.

One fact frames everything below. The application has no server. What the
brief calls "the backend" is a service layer (`src/platform/api.ts`) that runs
in the same browser tab as the interface. Its checks are real code and are
unit-tested, and they are the code that would run on a server, but in this
prototype a determined user can bypass them from the browser's developer
tools. Every "PASS" below means "enforced by the service layer", not "enforced
across a network".

## Mandatory questions

| # | Question | Verdict | Evidence |
|---|---|---|---|
| 1 | Can players join private tournaments without authorization? | **PARTIAL** | Registering is protected: `registerForTournament` rejects anyone without an active membership (`api.ts:644-645`) and honours per-tournament approval (`api.ts:656-657`). But *watching* is not: `Runtime.attach` (`runtime.ts:507-513`) seats an observer at any table without checking who is asking, and the interface check (`Lobby.tsx:114`, `canObserve`) is the only guard. The lobby of a members-only tournament also renders for non-members (`Lobby.tsx:30-33` checks only that the tournament exists), and the club page lists members-only tournaments to non-members (`ClubPage.tsx:33`). There is no invitation-only mode and no access code. |
| 2 | Are membership permissions checked by the backend? | **PASS** (service layer) | Every write calls `requirePermission` or `requirePlatform` first, for example `approveMember` (`api.ts:263`), `suspendMember` (`api.ts:286`), `setMemberRole` (`api.ts:308-311`). Permissions come only from an active membership in the same club (`permissions.ts:85-90`). Covered by `tests/platform.test.ts` ("role authorization", "club data isolation"). |
| 3 | Can a player follow a club without becoming a member? | **FAIL** | No follow concept exists. The only relationship is `Membership` (`types.ts:39-50`). |
| 4 | Can a club administrator approve members? | **PASS** | `approveMember` / `rejectMember` (`api.ts:261-283`), with the plan's member limit enforced (`api.ts:267`); screen in `console/Members.tsx`. |
| 5 | Is tournament registration tied to authenticated players? | **PARTIAL** | Registration is tied to a user id and that user's membership (`api.ts:640-665`). There is no real authentication: the "signed-in" user is a demo identity chosen on the welcome screen (`session.ts:118`), and service functions trust the `userId` they are given. |
| 6 | Can administrators access another club's data? | **PARTIAL** | Writes: no. A River Kings manager is refused in Midnight because `can()` requires a membership of the target club (`permissions.ts:85-90`); tested. Reads: there is no read-side authorization at all. Screens read the in-memory database directly (for example `selectors.ts:22-24`, `clubMembers`), and the only thing keeping one club's console away from another club's data is the route guard in `App.tsx:144-148`. Acceptable for the data that existed (member lists, tournaments); not acceptable for private CRM notes and messages. |
| 7 | Is tournament history stored persistently? | **PARTIAL** | Results are stored as records (`db.results`, written by `completeTournament`, `api.ts:771-782`) and saved to the browser's local storage (`store.ts:89-103`). They live in one browser only and the whole database is discarded after eight hours (`store.ts:14`, `57`). |
| 8 | Are player statistics calculated from actual game records? | **PASS** | `playerStats` and `clubRanking` are computed from `db.results` on demand (`selectors.ts:113-135`, `150-169`); nothing is stored twice. Note that most past results in the demo are seeded history (`TournamentResult.seeded`), and are labelled so. |
| 9 | Are messaging and notifications already implemented? | **PARTIAL** | In-app notifications: yes, with read state (`api.ts:72-91`, `1011-1018`) and three preference switches (`Settings.tsx:116-119`). Player-to-club messaging: no. The only conversation feature is support tickets between club staff and the platform (`api.ts:788-851`). No tournament reminders are actually sent; `notif.starting_soon` appears only in seed data (`seed.ts:683`). No duplicate-notification protection. |
| 10 | Are club profiles customizable? | **PARTIAL** | Name, tagline, description, rules, join policy (`api.ts:335-348`) and branding: accent, logo, cover, table felt, title style (`api.ts:350-365`, `console/Branding.tsx`). No social links, no public location, no follower count, no contact action. |

## Areas examined

| Area | State in the baseline | Verdict |
|---|---|---|
| 1. Frontend architecture | React 19 + TypeScript, three shells (player, console, platform) over one in-memory router (`app/session.ts`, `app/shells.tsx`). Clean separation of screens from data. | PASS |
| 2. Backend APIs | None. A service layer of plain functions with a uniform authorize → validate → mutate → audit shape (`platform/api.ts`). | PARTIAL |
| 3. Database schema | One typed JSON object (`platform/types.ts:367-388`) shaped like relational tables with `clubId` as tenant key. No indexes or constraints; uniqueness is enforced in code. | PARTIAL |
| 4. Authentication | Demo identities only. | FAIL (by design of the prototype) |
| 5. Authorization | Role and tenant checks on every write; none on reads. | PARTIAL |
| 6. Club management | Members, roles, branding, announcements, audit log, support. | PASS |
| 7. Tournament creation | Six-step wizard, presets, validation, lifecycle state machine. | PASS |
| 8. Tournament registration | Register, unregister, per-tournament approval, late registration, capacity. Statuses limited to `registered`, `pending`, `rejected` (`types.ts:120`). No waiting list, no revocation by staff, no invitations, no access code. A request waiting for approval holds a seat (`api.ts:650`). | PARTIAL |
| 9. Player profiles | A player's own statistics, badges and history. Staff see a small member dialog. No club-specific CRM profile. | PARTIAL |
| 10. Poker engine integration | Tournament results flow from the engine into `db.results` (`runtime.ts:471-498`). | PASS |
| 11. CRM-like functionality | Member list with search, role filter and sort. No tags, notes, segments, assignments, timeline or lifecycle. | FAIL |
| 12. Notifications | In-app, per-user, with read state and three preferences. | PARTIAL |
| 13. Messaging | Not present. | FAIL |
| 14. Design system | Tokens, primitives, charts, dialogs, tables (`src/ui`). Reused for all new screens. | PASS |
| 15. Routing and navigation | In-memory routes with per-route permission gate in the console (`console/ConsoleRouter.tsx`). | PASS |

Also found:

- **Analytics are not derived from records.** The console's analytics screen
  and the "monthly active players" figure used for plan usage and billing
  estimates read a generated series (`seed.ts:777-844`, `api.ts:137-145`), not
  tournament records. A funnel or retention report built on top of that would
  not match any player list.
- **Membership history is destroyed on leaving.** `leaveClub` and
  `cancelJoinRequest` delete the membership row (`api.ts:234`, `257`), so there
  is nothing to build a timeline from.
- **Announcements go to members only** and their body has no audience,
  schedule or delivery record (`api.ts:367-403`).

## Authorization problems fixed first

These were corrected before any CRM feature was added (see the completion
report for the tests that cover each):

1. Watching a table of a private tournament now requires an approved
   membership of the club, staff rights in it, or a seat in the tournament.
   The check is in the service layer (`canWatchTournament`, called by
   `Runtime.attach`), not only in the lobby. Tournaments a club marks as
   public demonstrations can be watched by anyone; playing in them still
   needs an approved membership.
2. A private tournament's lobby, player list and tables are no longer shown to
   people who are not approved members; they get a "private tournament" page.
3. The club page shows non-members only what the club has made public.
4. A request waiting for approval no longer holds a seat.
5. All CRM data (notes, tags, assignments, segments, automation, analytics,
   the club inbox) is read through service functions that check the actor's
   permission in that club. A test fails the build if a screen reads the CRM
   store directly.

## The same questions after the work

| # | Question | Now | Evidence |
|---|---|---|---|
| 1 | Can players join private tournaments without authorization? | **PASS** (service layer) | `canViewTournament`, `canWatchTournament`, `registerForTournament` in `api.ts`; `tests/crm.test.ts` 1, 1b, 1c, 3, 3b; browser journey E opens private lobbies and tables by address as a non-member. |
| 2 | Are membership permissions checked by the backend? | **PASS** (service layer) | Unchanged, and extended to reads; tests 4, 4b, 13, 26. |
| 3 | Can a player follow a club without becoming a member? | **PASS** | `followClub` / `db.follows`; test 2; journey D. |
| 4 | Can a club administrator approve members? | **PASS** | Approval queue with decline, suspend, ban and reinstate; journey D. |
| 5 | Is tournament registration tied to authenticated players? | **PARTIAL** | Tied to the acting user and that user's membership. There is still no real authentication. |
| 6 | Can administrators access another club's data? | **PASS** (service layer) | Reads and writes are both guarded; tests 4, 14, 26, the architecture tests; journey E opens twelve Midnight addresses as River Kings' owner. |
| 7 | Is tournament history stored persistently? | **PARTIAL** | Unchanged: one browser's local storage, discarded after eight hours. |
| 8 | Are player statistics calculated from actual game records? | **PASS** | Now also true of every analytics figure and of plan usage; test "seeded figures are derived from records, not stored". |
| 9 | Are messaging and notifications already implemented? | **PASS** (in-app only) | `messaging.ts`, delivery records, five preferences, dedupe keys; tests 14, 14b, 15, 15b, 15c, 16. No email, SMS or push. |
| 10 | Are club profiles customizable? | **PASS** | Location, time zone, social links with per-link visibility, public switches, follower count, contact action; "club profile" tests. |
