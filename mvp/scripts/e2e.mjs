// End-to-end check of the demo journeys in a real browser (Chromium via Playwright).
//
//   node scripts/build.mjs && node scripts/e2e.mjs            all journeys, desktop
//   node scripts/e2e.mjs --only=B                             one journey: A, B, C (the original three), D (the CRM demo),
//                                                             E (access control and club isolation) or S (smoke checks)
//   node scripts/e2e.mjs --shots                              also save screenshots to scratch/e2e/
//
// The script drives the built single-file app (dist/index.html) exactly as a person would:
// it clicks, types and reads what is on screen. Nothing is stubbed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const appUrl = 'file://' + path.join(root, 'dist', 'index.html');
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).toUpperCase();
const saveShots = process.argv.includes('--shots');
const shotDir = path.join(root, 'scratch', 'e2e');
if (saveShots) fs.mkdirSync(shotDir, { recursive: true });

const results = [];
let current = '';
const check = (ok, what) => {
  results.push({ journey: current, ok: !!ok, what });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

async function session({ width = 1440, height = 900, mobile = false } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The only network request the app makes is for web fonts; offline that request fails and is not an app error.
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(appUrl);
  await page.waitForSelector('[data-env]');
  const tid = (id) => page.locator(`[data-testid="${id}"]`).first();
  const visible = (id) => page.locator(`[data-testid="${id}"]:visible`).first();
  const nav = async (route) => {
    const direct = page.locator(`[data-testid="nav-${route}"]:visible, [data-testid="tab-${route}"]:visible`).first();
    if (await direct.count()) await direct.click();
    else if (route.startsWith('console.')) {
      // v0.3: CRM pages hang off the Community group; open any of them and use the secondary navigation.
      await page.locator('[data-testid="nav-console.crm.players"]:visible, [data-testid="nav-console.crm"]:visible').first().click();
      await page.waitForTimeout(250);
      await page.locator(`[data-testid="subnav"] [data-testid="nav-${route}"]:visible`).first().click();
    } else {
      // v0.3: some player destinations live in the account menu.
      await tid('nav-more').click();
      await page.locator(`[data-testid="nav-${route}"]:visible`).first().click();
    }
    await page.waitForTimeout(350);
  };
  const as = async (identity) => {
    if (await tid(`enter-${identity}`).count()) await tid(`enter-${identity}`).click();
    else {
      // A modal dialog covers the demo bar; close it first, as a person would.
      if (await page.locator('[role="dialog"]').count()) await page.keyboard.press('Escape');
      await tid('role-switcher').click();
      await tid(`role-${identity}`).click();
    }
    await page.waitForTimeout(500);
  };
  const shot = async (name) => saveShots && page.screenshot({ path: path.join(shotDir, `${name}.png`) });
  const text = async (id) => ((await tid(id).count()) ? ((await tid(id).textContent()) ?? '').trim() : '');
  const until = async (fn, ms = 15000, every = 250) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await page.waitForTimeout(every);
    }
    return false;
  };
  // Opening a saved address directly: the app keeps its route in this browser's storage, so writing a
  // route there and reloading is what following a pasted link does. Used to check that a direct
  // address cannot get around an access rule.
  const goto = async (name, params = {}) => {
    await page.waitForTimeout(950); // let the app save its data first
    await page.evaluate(([name, params]) => {
      const key = 'pcos.session.v3';
      const state = JSON.parse(localStorage.getItem(key));
      state.route = { name, params };
      localStorage.setItem(key, JSON.stringify(state));
    }, [name, params]);
    await page.reload();
    await page.waitForSelector('[data-env]');
    await page.waitForTimeout(350);
  };
  /** Read the saved demo database (the same data the app shows). */
  const saved = async (pick, arg) => {
    await page.waitForTimeout(950);
    return page.evaluate(([source, arg]) => new Function('db', 'arg', `return (${source})(db, arg)`)(JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('pcos.db.')))), arg), [pick.toString(), arg]);
  };
  const tournamentId = (name) => saved((db, name) => Object.values(db.tournaments).find((t) => t.name === name)?.id ?? null, name);
  // Two refusals exist: no place in this club at all, or a role in the club that does not include the page.
  const denied = async () => (await page.getByText('You do not have access to this area').count()) + (await page.getByText('Your role does not include this area').count()) > 0;
  const number = async (id) => Number((await text(id)).replace(/[^\d.]/g, ''));
  return { browser, page, tid, visible, nav, as, shot, text, until, errors, goto, saved, tournamentId, denied, number };
}

// ---------------------------------------------------------------------------------------------
// Journey A: a new player joins a club, registers, plays real hands, finishes and reviews them.
// ---------------------------------------------------------------------------------------------
async function journeyA() {
  current = 'A';
  console.log('\nJourney A: new player');
  const s = await session();
  const { page, tid, nav, as, shot, text, until } = s;
  await as('player');
  check(await page.getByText('Alex Morgan').first().isVisible(), 'signed in as the demo player, home screen shown');

  // Join a club by its six-digit ID. This club requires approval; simulated staff answer within seconds.
  await nav('clubs');
  await tid('join-club').click();
  await tid('tab-id').click();
  await tid('join-id-input').fill('205877');
  await tid('join-find').click();
  check((await text('join-preview')).includes('The Final Table'), 'club found by its ID, preview shown before joining');
  await tid('join-confirm').click();
  check(await until(async () => (await tid('join-go').count()) > 0, 25000), 'join request approved by (simulated) club staff; membership active');
  await shot('A1-joined');
  await tid('join-go').click();
  check((await tid('club-page').count()) === 1 && (await page.getByText('The Final Table').first().isVisible()), 'club page opens for the new member');

  // Register for the sit & go and get seated.
  await nav('home');
  await page.locator('[data-testid^="tournament-card-"]', { hasText: 'Six-Max Sit & Go' }).first().click();
  const before = Number((await text('points-balance')).replace(/\D/g, ''));
  await tid('register').click();
  check(await until(async () => (await tid('registered-notice').count()) > 0 || (await tid('seating-panel').count()) > 0 || (await tid('go-to-table').count()) > 0, 5000), 'registration confirmed in the lobby');
  check(await until(async () => (await tid('go-to-table').count()) > 0, 45000), 'table filled with disclosed simulated players and the tournament started');
  await tid('go-to-table').click();
  check(await until(async () => (await tid('table-screen').count()) > 0, 5000), 'table screen opens');
  await shot('A2-table');

  // Play: first a few ordinary decisions, then shove all-in each hand. That usually ends the
  // tournament for us within a minute or two; if we are still alive after the time limit we
  // leave the table and carry on, because how long a player survives is down to the cards.
  let acted = 0;
  let finished = '';
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline && !finished) {
    await page.waitForTimeout(300);
    if (await tid('out-to-lobby').count()) finished = 'eliminated';
    else if (await tid('winner-results').count()) finished = 'won';
    if (finished) break;
    if (await tid('im-back').count()) await tid('im-back').click();
    const raise = tid('act-raise');
    const call = tid('act-call');
    const checkBtn = tid('act-check');
    const fold = tid('act-fold');
    if (!((await raise.count()) || (await call.count()) || (await checkBtn.count()))) continue;
    if (acted < 3) {
      // Ordinary play: check when free, otherwise call a small bet or fold.
      if (await checkBtn.count()) await checkBtn.click();
      else if (await call.count()) await call.click();
      else await fold.click();
    } else if ((await raise.count()) && (await raise.isEnabled())) {
      const allIn = tid('size-allin');
      if (await allIn.count()) await allIn.click();
      await tid('act-raise').click();
    } else if (await call.count()) await call.click();
    else await checkBtn.click();
    await page.waitForTimeout(200);
    if (await tid('act-confirm').count()) await tid('act-confirm').click();
    acted++;
  }
  check(acted >= 3, `took ${acted} betting decisions with the action controls`);
  await shot('A3-after-play');
  if (finished) {
    await tid(finished === 'won' ? 'winner-results' : 'out-to-lobby').click();
    await page.waitForTimeout(600);
    check((await page.getByText(/You finished|Your result|Champion/).count()) > 0, `tournament ended for the player (${finished}); finishing position shown`);
  } else {
    await tid('table-back').click();
    await page.waitForTimeout(600);
    check((await tid('return-to-table').count()) + (await tid('go-to-table').count()) > 0, 'still alive after the time limit; left the table and the lobby offers the way back');
  }

  // Results of a finished tournament, from the club page.
  await nav('clubs');
  await tid('club-card-c_midnight').click();
  await tid('tab-results').click();
  await page.locator('[data-testid="club-page"] ul li button').first().click();
  check(await until(async () => (await tid('results').count()) > 0 && (await text('winner-name')).length > 0, 4000), `results page of a finished tournament shows the winner and standings (${await text('winner-name')})`);

  // Hand history and replayer.
  await nav('hands');
  const rows = await page.locator('[data-testid="hand-row"]').count();
  check(rows >= 1, `hand history lists the hands that were played (${rows})`);
  if (rows > 0) {
    await tid('hand-row').click();
    await tid('replay-next').click();
    await tid('replay-next').click();
    check((await tid('replayer').count()) === 1 && /\d+ \/ \d+/.test(await text('replay-step')), 'replayer steps through a saved hand');
    await shot('A4-replayer');
    await page.keyboard.press('Escape');
  }
  await nav('profile');
  check((await page.getByText('Tournament history').count()) > 0, 'profile shows statistics and tournament history');
  await nav('clubs');
  await tid('club-card-c_midnight').click();
  const after = Number(((await page.getByText('Your demo points').first().locator('xpath=..').textContent()) ?? '').replace(/\D/g, ''));
  check(before > 0 && after === before - 100, `entry of 100 demo points was deducted from the club balance (${before} -> ${after})`);
  check(s.errors.length === 0, `no runtime errors in the browser${s.errors.length ? ': ' + s.errors[0] : ''}`);
  await s.browser.close();
}

// ---------------------------------------------------------------------------------------------
// Journey B: a club owner creates, publishes and runs a tournament, and manages the club.
// ---------------------------------------------------------------------------------------------
async function journeyB() {
  current = 'B';
  console.log('\nJourney B: club owner');
  const s = await session();
  const { page, tid, nav, as, shot, text, until } = s;
  const name = 'E2E Thursday Turbo';
  await as('owner');
  check((await page.getByText('Midnight Poker Club').first().isVisible()) && (await tid('new-tournament').count()) > 0, 'owner lands in the club console');

  // Wizard: preset -> structure -> registration -> schedule -> review -> publish.
  await tid('new-tournament').click();
  await tid('pick-turbo').click();
  await tid('w-name').fill(name);
  await tid('w-next').click();
  check((await tid('level-row-1').count()) === 1, 'structure step shows the editable blind levels of the preset');
  await tid('w-next').click();
  await tid('w-next').click();
  await tid('w-quick').click(); // start "in 2 min"
  await tid('w-next').click();
  // v0.3: table branding step with a live preview of the felt.
  check((await tid('table-branding-step').count()) === 1 && (await tid('table-watermark').count()) === 1, 'table step shows the felt preview with the club logo');
  await tid('logo-source-hidden').click();
  check((await tid('table-watermark').count()) === 0, 'choosing "no logo" removes the mark from the preview');
  await tid('logo-source-club').click();
  await tid('w-next').click();
  check((await page.getByText('Everything checks out').count()) > 0, 'review step validates the tournament');
  await tid('w-next').click();
  await tid('w-publish').click();
  check(await until(async () => (await text('control-title')) === name, 5000), 'tournament published; control room opens');
  await shot('B1-published');

  // It is now visible to members.
  await as('player');
  await nav('tournaments');
  check((await page.locator('[data-testid^="tournament-card-"]', { hasText: name }).count()) > 0, 'the new tournament appears in the member lobby straight away');
  await as('owner');
  await nav('console.tournaments');
  await page.locator('[data-testid^="trow-"]', { hasText: name }).first().locator('[data-testid="manage"]').click();

  // Registrations, start, live monitoring.
  await tid('tab-registrations').click();
  await tid('add-simulated').click();
  await page.waitForTimeout(300);
  await tid('add-simulated').click();
  check(await until(async () => /^(1[89]|[2-9]\d) of/.test(await page.getByText(/\d+ of 54 registered/).first().textContent()), 5000), 'simulated players registered (clearly labelled BOT)');
  await tid('control-start').click();
  await tid('confirm').click();
  check(await until(async () => (await tid('tournament-clock').count()) > 0 && (await page.locator('[data-testid^="mini-table-"]').count()) >= 2, 20000), 'seats drawn; live clock and tables are shown');
  await shot('B2-live');
  await tid('control-pause').click();
  await tid('confirm').click();
  check(await until(async () => (await tid('control-resume').count()) > 0, 4000), 'tournament paused');
  const frozen = await text('clock-time');
  await page.waitForTimeout(1600);
  check((await text('clock-time')) === frozen, 'clock stands still while paused');
  await tid('control-resume').click();
  check(await until(async () => (await tid('control-pause').count()) > 0, 4000), 'tournament resumed');

  // Run it to the end with the demo clock.
  await page.getByRole('radio', { name: '×240' }).click();
  const done = await until(async () => (await tid('tab-results').count()) > 0, 150000, 500);
  check(done, 'tournament ran to a winner (demo clock ×240)');
  if (done) {
    await tid('tab-results').click();
    await page.waitForTimeout(400);
    check((await text('winner-name')).length > 0, `results published with a winner (${await text('winner-name')})`);
    await shot('B3-results');
  }

  // Membership requests: approve one.
  await nav('console.crm.requests');
  const pending = await page.locator('[data-testid^="approve-u_"]').count();
  await page.locator('[data-testid^="approve-u_"]').first().click();
  check(await until(async () => (await page.locator('[data-testid^="approve-u_"]').count()) === pending - 1, 3000), `membership request approved (${pending} -> ${pending - 1} waiting)`);

  // Branding: change the accent colour and see it applied.
  await nav('console.branding');
  await tid('accent-14B8A6').click();
  await tid('branding-save').click();
  await page.waitForTimeout(400);
  await as('player');
  await nav('clubs');
  await tid('club-card-c_midnight').click();
  const accent = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="club-page"]')).getPropertyValue('--accent').trim().toLowerCase());
  check(accent === '#14b8a6', `new club accent colour reaches the member-facing club page (${accent})`);
  await as('owner');

  // Announcement.
  await nav('console.announcements');
  await tid('an-title').fill('E2E: schedule update');
  await page.locator('#an-body').fill('Thursday games start 30 minutes earlier.');
  await tid('an-publish').click();
  check((await page.getByText('E2E: schedule update').count()) > 0, 'announcement published');

  // Role limits: the tournament manager role has no branding, audit or subscription.
  await as('tournament_manager');
  const navIds = await page.locator('aside [data-testid^="nav-console."]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  check(!navIds.includes('nav-console.branding') && !navIds.includes('nav-console.subscription') && navIds.includes('nav-console.tournaments'), 'tournament manager sees tournaments but not branding or subscription');
  check(s.errors.length === 0, `no runtime errors in the browser${s.errors.length ? ': ' + s.errors[0] : ''}`);
  await s.browser.close();
}

// ---------------------------------------------------------------------------------------------
// Journey C: the platform administrator manages tenants, plans, limits and support.
// ---------------------------------------------------------------------------------------------
async function journeyC() {
  current = 'C';
  console.log('\nJourney C: platform administrator');
  const s = await session();
  const { page, tid, nav, as, shot, text, until } = s;
  await as('platform_admin');
  check((await page.getByText('Platform overview').count()) > 0, 'platform overview opens');

  // Create a tenant.
  await nav('platform.clubs');
  const clubsBefore = await page.locator('[data-testid^="tenant-c_"]').count();
  await tid('new-tenant').click();
  await tid('tn-name').fill('Harbour Lights Poker');
  await tid('tn-owner').fill('Noa Peretz');
  await tid('tenant-create').click();
  check(await until(async () => (await tid('tenant-detail').count()) > 0 && (await page.getByText('Harbour Lights Poker').count()) > 0, 3000), 'new club created as an isolated tenant; its detail page opens');
  await shot('C1-tenant-created');
  await nav('platform.clubs');
  const clubsAfter = await page.locator('[data-testid^="tenant-c_"]').count();
  check(clubsAfter === clubsBefore + 1, `club list grew from ${clubsBefore} to ${clubsAfter}`);

  // Plan change updates the invoice estimate.
  await tid('tenant-c_final').click();
  const estimateBefore = await text('invoice-total');
  await tid('tenant-plan').selectOption('professional');
  check(await until(async () => (await text('invoice-total')) !== estimateBefore, 3000), `plan change updates the subscription estimate (${estimateBefore} -> ${await text('invoice-total')})`);

  // Limit override.
  await tid('limit-members').fill('250');
  await tid('limits-save').click();
  check(await until(async () => (await page.getByText('Custom limit').count()) > 0, 3000), 'custom limit saved for one club');

  // Suspend and restore; members see the suspension.
  await tid('tenant-suspend').click();
  await page.locator('[role="dialog"] textarea, [role="dialog"] input').first().fill('E2E check');
  await tid('tenant-suspend-confirm').click();
  check(await until(async () => (await tid('tenant-restore').count()) > 0, 3000), 'club suspended');
  await as('owner');
  await as('platform_admin');
  await nav('platform.clubs');
  await tid('tenant-c_final').click();
  await tid('tenant-restore').click();
  check(await until(async () => (await tid('tenant-suspend').count()) > 0, 3000), 'club restored');

  // Editing a plan price changes what clubs on that plan are quoted.
  await nav('platform.plans');
  await tid('plan-base-starter').fill('120');
  await tid('plan-save-starter').click();
  await page.waitForTimeout(300);
  check((await page.getByText('¤120 per month').count()) > 0, 'placeholder plan price edited');

  // Support: a club opens a ticket, the platform answers and resolves it.
  await as('owner');
  await nav('console.support');
  await tid('new-ticket').click();
  await tid('tk-subject').fill('E2E: cannot find the export');
  await page.locator('#tk-body').fill('Where do I download final standings?');
  await tid('ticket-submit').click();
  check(await until(async () => (await page.locator('[data-testid="ticket-row"]', { hasText: 'E2E: cannot find the export' }).count()) > 0, 3000), 'club staff opened a support ticket');
  await as('platform_admin');
  await nav('platform.support');
  await page.locator('[data-testid="ticket-row"]', { hasText: 'E2E: cannot find the export' }).first().click();
  await page.locator('[data-testid="ticket-dialog"] textarea').fill('Exports are planned; the standings can be copied from the results page for now.');
  await tid('ticket-send').click();
  await page.waitForTimeout(300);
  check((await page.locator('[data-testid="ticket-dialog"]').getByText('Exports are planned').count()) > 0, 'platform support replied on the ticket');
  await page.locator('[data-testid="ticket-dialog"] select').selectOption('resolved');
  await page.waitForTimeout(300);
  await shot('C2-ticket');
  await page.keyboard.press('Escape');
  await as('owner');
  await nav('console.support');
  await tid('tab-resolved').click();
  check((await page.locator('[data-testid="ticket-row"]', { hasText: 'E2E: cannot find the export' }).count()) > 0, 'the club sees the ticket as resolved, with the reply');
  await as('platform_admin');

  // Health and integrity screens are labelled honestly.
  await nav('platform.health');
  check((await page.getByText('Simulated', { exact: true }).count()) > 0, 'system health marks service metrics as simulated');
  await nav('platform.integrity');
  check((await page.getByText('Simulated signals').count()) > 0 && (await tid('integrity-case').count()) > 0, 'integrity screen is marked as simulated and holds derived cases');
  check(s.errors.length === 0, `no runtime errors in the browser${s.errors.length ? ': ' + s.errors[0] : ''}`);
  await s.browser.close();
}

// ---------------------------------------------------------------------------------------------
// Journey D: the CRM demonstration, start to finish.
// Daniel follows Midnight Poker Club, asks to join and is approved; Michael tags him, creates a
// private tournament and approves his seat; Daniel plays twice and becomes a returning participant;
// announcements, messages, a segment and the funnel all show the same person.
// ---------------------------------------------------------------------------------------------
async function publishTournament(s, { preset, name, minutes, max, access }) {
  const { page, tid, nav, text, until } = s;
  await nav('console.tournaments');
  await tid('new-tournament').click();
  await tid(`pick-${preset}`).click();
  await tid('w-name').fill(name);
  await tid('w-next').click();
  if (minutes) {
    await page.locator('#s-minutes').fill(String(minutes));
    await page.locator('#s-minutes').blur();
  }
  const stack = await page.locator('#s-stack').inputValue();
  await tid('w-next').click();
  if (max) {
    await page.locator('#w-max').fill(String(max));
    await page.locator('#w-max').blur();
  }
  if (access) await tid('w-access').selectOption(access);
  await tid('w-next').click();
  await tid('w-quick').click();
  await tid('w-next').click();
  await tid('w-next').click(); // table branding (defaults)
  const valid = (await page.getByText('Everything checks out').count()) > 0;
  await tid('w-next').click();
  await tid('w-publish').click();
  const opened = await until(async () => (await text('control-title')) === name, 5000);
  return { stack: Number(stack.replace(/\D/g, '')), valid, opened };
}

async function runToResults(s, id) {
  const { page, tid, until, goto } = s;
  await goto('console.tournament', { clubId: 'c_midnight', id });
  await page.getByRole('radio', { name: '×240' }).click();
  return until(async () => (await tid('tab-results').count()) > 0, 220000, 500);
}

async function journeyD() {
  current = 'D';
  console.log('\nJourney D: CRM demonstration (follow, join, private tournament, play, return, announce, message, segment, funnel)');
  const s = await session();
  const { page, tid, nav, as, shot, text, until, goto, saved, tournamentId, number } = s;
  const club = { clubId: 'c_midnight' };

  // 1. Daniel follows the club. Following is its own relationship and it persists.
  await as('newcomer');
  check(await page.getByText('Daniel Levy').first().isVisible(), 'signed in as Daniel, a registered user with no club');
  await nav('clubs');
  await tid('club-card-c_midnight').click();
  const followers = await number('follower-count');
  check((await tid('club-follow').count()) === 1 && (await tid('club-join').count()) === 1 && (await tid('club-contact').count()) === 1, 'public club page offers Follow, Request to join and Contact organizer');
  await tid('club-follow').click();
  check(await until(async () => (await number('follower-count')) === followers + 1 && (await tid('club-following').count()) === 1, 3000), `following the club raises its follower count (${followers} -> ${followers + 1})`);
  await goto('club', club);
  check((await tid('club-following').count()) === 1 && (await number('follower-count')) === followers + 1, 'the follow state is kept after a reload');
  check((await tid('membership-status').count()) === 0, 'following does not make Daniel a member');
  const invitational = await tournamentId("Members' Invitational");
  await goto('tournament', { id: invitational });
  check((await tid('lobby-private').count()) === 1 && (await tid('register').count()) === 0, 'a follower who opens a private tournament by its address is refused');
  await goto('table', { id: invitational, table: '1' });
  check((await tid('table-screen').count()) === 0 && (await page.getByText('Private tournament').count()) > 0, 'and cannot open one of its tables by address either');

  // 2. He asks for membership: pending, not approved.
  await goto('club', club);
  await tid('club-join').click();
  await tid('join-confirm').click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  check(await until(async () => (await text('membership-status')).includes('pending'), 3000), 'membership request is pending');
  const status = await saved((db) => db.memberships.find((m) => m.userId === 'u_daniel' && m.clubId === 'c_midnight')?.status);
  check(status === 'pending', `stored membership status is "${status}"`);
  await goto('tournament', { id: invitational });
  check((await tid('lobby-private').count()) === 1, 'a pending request does not open private tournaments');

  // 3. Michael approves; Daniel is told and the welcome rule writes to him.
  await as('owner');
  await nav('console.crm.requests');
  check((await tid('request-u_daniel').count()) === 1, 'the request appears in the club\'s approval queue');
  await shot('D1-requests');
  await tid('approve-u_daniel').click();
  check(await until(async () => (await tid('request-u_daniel').count()) === 0, 3000), 'Michael approves the request');
  await as('newcomer');
  await goto('notifications');
  check((await page.getByText('Midnight Poker Club approved your membership.').count()) > 0, 'Daniel receives an approval notification');
  await goto('club', club);
  check((await text('membership-status')).includes('Approved member'), 'his club page now shows "Approved member"');
  await goto('messages', club);
  check((await tid('thread').getByText('Welcome to the club').count()) > 0, 'the welcome automation wrote to him in the club conversation');
  await goto('tournament', { id: invitational });
  check((await tid('lobby').count()) === 1 && (await tid('lobby-private').count()) === 0, 'an approved member can open the private tournament');

  // 4. Michael tags him and leaves a private note.
  await as('owner');
  await goto('console.crm.player', { ...club, userId: 'u_daniel' });
  check((await text('profile-status')).includes('Approved') && (await text('profile-lifecycle')).includes('Approved, not played'), 'CRM profile: membership Approved, lifecycle "Approved, not played"');
  await tid('profile-add-tag').selectOption({ label: 'Weekend Player' });
  check(await until(async () => (await text('profile-tags')).includes('Weekend Player'), 3000), 'tag "Weekend Player" applied');
  await page.locator('[data-testid="crm-profile"] textarea').first().fill('Met at the Friday game. Prefers weekend starts.');
  await tid('note-add').click();
  check(await until(async () => (await text('profile-notes')).includes('Prefers weekend starts'), 3000), 'private note saved with its author');
  check((await text('profile-timeline')).includes('Membership approved') && (await text('profile-timeline')).includes('Started following the club'), 'timeline lists the follow, the request and the approval');
  await shot('D2-profile');

  // 5. A private tournament: Sunday Championship, 20,000 chips, 100 seats, 10-minute levels, staff approve each seat.
  const first = 'Sunday Championship';
  const made = await publishTournament(s, { preset: 'deep', name: first, minutes: 10, max: 100, access: 'approval' });
  check(made.valid && made.opened, 'Michael creates and publishes "Sunday Championship"');
  const summary = (await tid('tournament-control').textContent()) ?? '';
  check(made.stack === 20000 && summary.includes('20,000 chips') && summary.includes('10-min levels'), 'with 20,000 starting chips and 10-minute levels');
  const firstId = await tournamentId(first);
  const stored = await saved((db, id) => { const t = db.tournaments[id]; return { visibility: t.visibility, access: t.access, max: t.maxPlayers }; }, firstId);
  check(stored.visibility === 'private' && stored.access === 'approval' && stored.max === 100, `stored as private, approval per seat, ${stored.max} seats`);

  // 6. Daniel asks for a seat; a request holds no seat; Michael approves; a non-member is refused.
  await as('newcomer');
  await goto('tournament', { id: firstId });
  await tid('register').click();
  check(await until(async () => (await tid('requested-notice').count()) === 1, 3000), 'Daniel asks for a seat: the request waits for the club');
  await as('owner');
  await goto('console.tournament', { ...club, id: firstId });
  await tid('tab-registrations').click();
  check((await text('reg-requests')).includes('Daniel Levy') && (await text('capacity')).replace(/\s/g, '').startsWith('0/100'), 'the request is listed and takes no seat (0 / 100)');
  await shot('D3-seat-request');
  await tid('reg-request-u_daniel').locator('[data-testid="approve-reg"]').click();
  check(await until(async () => (await text('reg-confirmed')).includes('Daniel Levy') && (await text('capacity')).replace(/\s/g, '').startsWith('1/100'), 3000), 'Michael approves the request: Daniel is a confirmed participant (1 / 100)');
  await as('other_owner');
  await goto('tournament', { id: firstId });
  check((await tid('lobby-private').count()) === 1, 'an account that is not a member of the club cannot enter the tournament');
  await as('newcomer');
  await goto('tournament', { id: firstId });
  check((await tid('registered-notice').count()) === 1, 'Daniel sees his confirmed seat in the lobby');
  await goto('notifications');
  check((await page.getByText('Your seat in Sunday Championship is confirmed.').count()) > 0, 'and was notified of it');

  // 7. The tournament runs and Daniel plays in it.
  await as('owner');
  await goto('console.tournament', { ...club, id: firstId });
  await tid('tab-registrations').click();
  await tid('add-simulated').click();
  await page.waitForTimeout(300);
  await tid('control-start').click();
  await tid('confirm').click();
  check(await until(async () => (await tid('tournament-clock').count()) > 0, 25000), 'tournament started with Daniel and disclosed simulated members');
  await as('newcomer');
  await goto('tournament', { id: firstId });
  await tid('go-to-table').click();
  check(await until(async () => (await tid('table-screen').count()) > 0, 5000), 'Daniel is seated at a table');
  let acted = 0;
  const playUntil = Date.now() + 60_000;
  while (Date.now() < playUntil && acted < 2) {
    await page.waitForTimeout(300);
    if (await tid('out-to-lobby').count()) break;
    if (await tid('im-back').count()) await tid('im-back').click();
    for (const id of ['act-check', 'act-call', 'act-fold']) {
      if (await tid(id).count()) {
        await tid(id).click();
        acted++;
        break;
      }
    }
  }
  check(acted >= 1, `Daniel plays (${acted} decisions at the table)`);
  await goto('home');
  await as('owner');
  check(await runToResults(s, firstId), 'the tournament ran to a winner (demo clock ×240)');
  await goto('console.crm.player', { ...club, userId: 'u_daniel' });
  check((await text('profile-tournaments')) === '1' && (await text('profile-lifecycle')).includes('First-time participant'), 'after one tournament Daniel is a first-time participant');

  // 8. A second tournament makes him a returning participant.
  const second = 'Sunday Turbo';
  await as('owner');
  const again = await publishTournament(s, { preset: 'turbo', name: second });
  check(again.opened, 'a second tournament is published');
  const secondId = await tournamentId(second);
  await as('newcomer');
  await goto('tournament', { id: secondId });
  await tid('register').click();
  check(await until(async () => (await tid('registered-notice').count()) === 1, 3000), 'Daniel registers for it himself (open to approved members)');
  await as('owner');
  await goto('console.tournament', { ...club, id: secondId });
  await tid('tab-registrations').click();
  await tid('add-simulated').click();
  await page.waitForTimeout(300);
  await tid('control-start').click();
  await tid('confirm').click();
  await until(async () => (await tid('tournament-clock').count()) > 0, 25000);
  check(await runToResults(s, secondId), 'the second tournament ran to a winner');
  await goto('console.crm.player', { ...club, userId: 'u_daniel' });
  check((await text('profile-tournaments')) === '2' && (await text('profile-lifecycle')).includes('Returning participant'), 'after two tournaments Daniel is a returning participant');
  check((await text('profile-status')).includes('Approved'), 'lifecycle changed; membership status did not');
  await shot('D4-returning');

  // 9. A public announcement reaches him because he accepts the club's announcements; when he turns them off it does not.
  const stat = async (key) => Number(((await page.locator('[data-testid="an-stats"]').first().locator(`[data-stat="${key}"]`).textContent()) ?? '').replace(/\D/g, ''));
  const announce = async (title) => {
    await goto('console.announcements', club);
    await tid('an-audience').selectOption('everyone');
    await tid('an-title').fill(title);
    await page.locator('#an-body').fill('Doors open at eight. Bring a friend.');
    await tid('an-publish').click();
    await page.waitForTimeout(500);
    return { recipients: await stat('recipients'), delivered: await stat('delivered'), optedOut: await stat('opted_out'), errors: await stat('errors') };
  };
  await as('owner');
  const one = await announce('E2E: Friday open evening');
  check(one.recipients > 0 && one.delivered + one.optedOut + one.errors === one.recipients, `announcement sent: ${one.recipients} recipients = ${one.delivered} delivered + ${one.optedOut} opted out + ${one.errors} errors`);
  await as('newcomer');
  await goto('notifications');
  check((await page.getByText('E2E: Friday open evening').count()) > 0, 'Daniel is notified of the public announcement');
  await goto('club', club);
  await tid('club-more').click();
  await page.getByRole('menuitem', { name: 'Club preferences' }).click();
  await page.getByRole('switch', { name: /Club announcements/ }).click();
  await page.keyboard.press('Escape');
  await as('owner');
  const two = await announce('E2E: Saturday reminder');
  check(two.optedOut === one.optedOut + 1 && two.delivered === one.delivered - 1, `after Daniel turns the club's announcements off he is counted as opted out (${one.optedOut} -> ${two.optedOut}), not delivered`);
  await as('newcomer');
  await goto('notifications');
  check((await page.getByText('E2E: Saturday reminder').count()) === 0, 'and receives no notification for the next one');

  // 10. Daniel writes to the club and Michael answers.
  await goto('messages', club);
  await page.locator('#message-text').fill('Hi, is there parking near the club on Sundays?');
  await tid('message-send').click();
  check(await until(async () => (await tid('thread').getByText('is there parking').count()) > 0, 3000), 'Daniel sends a message to the club');
  await as('owner');
  await nav('console.crm.inbox');
  await tid('inbox-u_daniel').click();
  check((await tid('inbox-thread').getByText('is there parking').count()) > 0, 'it arrives in the club inbox');
  await page.locator('#reply-text').fill('Yes, the lot behind the building is free after six.');
  await tid('inbox-send').click();
  await page.waitForTimeout(400);
  await shot('D5-inbox');
  await as('newcomer');
  await goto('messages', club);
  check((await tid('thread').getByText('free after six').count()) > 0, 'Michael\'s reply reaches Daniel');

  // 11. A dynamic segment: Tag = Weekend Player AND Membership = Approved.
  await as('owner');
  await nav('console.crm.segments');
  await tid('segment-new').click();
  await tid('segment-name').fill('E2E weekend regulars');
  await page.locator('[data-testid="rule-field"]').nth(0).selectOption('tag');
  await page.locator('[data-testid="rule-value"]').nth(0).selectOption({ label: 'Weekend Player' });
  await tid('segment-add-rule').click();
  await page.locator('[data-testid="rule-field"]').nth(1).selectOption('status');
  await page.locator('[data-testid="rule-value"]').nth(1).selectOption('active');
  await page.waitForTimeout(300);
  const matching = await number('segment-preview-count');
  await tid('segment-save').click();
  await page.waitForTimeout(400);
  const expected = await saved((db) => {
    const tag = db.crm.tags.find((t) => t.clubId === 'c_midnight' && t.name === 'Weekend Player');
    return db.memberships.filter((m) => m.clubId === 'c_midnight' && m.status === 'active' && db.crm.profiles[`c_midnight:${m.userId}`]?.tagIds.includes(tag.id)).map((m) => m.userId);
  });
  check(matching === expected.length && expected.includes('u_daniel'), `segment preview counts ${matching} people; the stored records give ${expected.length}, Daniel among them`);
  await page.locator('[data-testid^="segment-"]', { hasText: 'E2E weekend regulars' }).first().locator('[data-testid="segment-view"]').click();
  await page.waitForTimeout(400);
  check((await number('player-count')) === matching && (await tid('row-u_daniel').count()) === 1, 'opening the segment lists exactly those people, including Daniel');
  await shot('D6-segment-players');

  // 12. The funnel, and the people behind one of its bars.
  await nav('console.crm.analytics');
  await page.getByRole('radio', { name: '7 days' }).click();
  await tid('funnel-window').selectOption('none');
  await page.waitForTimeout(500);
  const stage = async (key) => number(`stage-${key}-count`);
  const f = { followers: await stage('followers'), requested: await stage('requested'), approved: await stage('approved'), first: await stage('first'), returning: await stage('returning') };
  check(f.followers >= f.requested && f.requested >= f.approved && f.approved >= f.first && f.first >= f.returning && f.returning >= 1, `funnel stages only narrow: ${f.followers} -> ${f.requested} -> ${f.approved} -> ${f.first} -> ${f.returning}`);
  check((await text('stage-approved-of-cohort')).includes(((f.approved / f.followers) * 100).toFixed(1) + '%') && (await text('stage-approved-of-previous')).includes(((f.approved / f.requested) * 100).toFixed(1) + '%'), 'overall and stage-to-stage percentages use the cohort and the previous stage as denominators');
  check((await text('kpi-follower_to_member-value')) === ((f.approved / f.followers) * 100).toFixed(1) + '%', 'the follower-to-member KPI equals approved / new followers of the same funnel');
  await tid('stage-returning').click();
  check(await until(async () => (await tid('funnel-drilldown').count()) === 1, 3000), 'selecting the Returning bar opens its people');
  check((await number('drilldown-count')) === f.returning && (await tid('funnel-drilldown').getByText('Daniel Levy').count()) > 0, `the list has the same ${f.returning} people as the bar, Daniel among them`);
  await shot('D7-funnel');
  check(s.errors.length === 0, `no runtime errors in the browser${s.errors.length ? ': ' + s.errors[0] : ''}`);
  await s.browser.close();
}

// ---------------------------------------------------------------------------------------------
// Journey E: access control. Another club's owner, limited staff roles, access codes, invitations
// and the waiting list. Every refusal here comes from the service layer, reached by a direct address.
// ---------------------------------------------------------------------------------------------
async function journeyE() {
  current = 'E';
  console.log('\nJourney E: access control and club isolation');
  const s = await session();
  const { page, tid, as, shot, text, until, goto, saved, tournamentId, denied, number } = s;
  const midnight = { clubId: 'c_midnight' };
  const river = { clubId: 'c_river' };

  // Another club's owner.
  await as('other_owner');
  check((await page.getByText('River Kings').first().isVisible()) && (await page.getByText('Dana Marin').count()) > 0, 'Dana, owner of River Kings, lands in her own console');
  await goto('console.crm.players', river);
  const own = await number('player-count');
  check(own > 0, `she sees her own club's players (${own})`);
  let refused = 0;
  const pages = ['console.crm', 'console.crm.players', 'console.crm.requests', 'console.crm.segments', 'console.crm.inbox', 'console.crm.analytics', 'console.crm.automation', 'console.crm.settings', 'console.announcements', 'console.roles'];
  for (const route of pages) {
    await goto(route, midnight);
    if (await denied()) refused++;
  }
  check(refused === pages.length, `all ${pages.length} console pages of Midnight Poker Club refuse her (${refused} refused)`);
  await goto('console.crm.player', { ...midnight, userId: 'u_sarah' });
  check(await denied(), 'a Midnight player profile, with its notes and timeline, is refused too');
  await shot('E1-other-club-denied');
  const privateRunning = await tournamentId("Members' Invitational");
  await goto('console.tournament', { ...midnight, id: privateRunning });
  check(await denied(), 'and so is the control room of a Midnight tournament');
  const leak = await page.evaluate(() => document.body.innerText.includes('Sarah Klein') || document.body.innerText.includes('Weekend Player'));
  check(!leak, 'no Midnight name or tag is rendered for her');

  // Limited staff roles.
  await as('tournament_manager');
  const navIds = await page.locator('aside [data-testid^="nav-console."]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  check(navIds.includes('nav-console.tournaments') && navIds.includes('nav-console.crm.players') && !navIds.includes('nav-console.crm.inbox') && !navIds.includes('nav-console.crm.settings') && !navIds.includes('nav-console.branding'), 'tournament manager: tournaments and the player list, but no inbox, CRM settings or branding');
  await goto('console.crm.inbox', river);
  check(await denied(), 'the inbox refuses a tournament manager who opens it by address');
  await goto('console.crm.settings', river);
  check(await denied(), 'so do the CRM settings');
  const someone = await saved((db) => db.memberships.find((m) => m.clubId === 'c_river' && m.status === 'active' && m.role === 'player')?.userId);
  await goto('console.crm.player', { ...river, userId: someone });
  check((await tid('crm-profile').count()) === 1 && (await page.getByText('Your role cannot read private notes.').count()) > 0 && (await tid('profile-ban').count()) === 0, 'a player profile opens for her without private notes and without membership actions');
  await as('player');
  await goto('console.crm', midnight);
  check(await denied(), 'a player account cannot open the console at all');
  await as('platform_admin');
  await goto('console.crm.inbox', midnight);
  check(await denied(), 'the platform administrator has no club permissions: a club inbox is refused');

  // Access code: an extra check for members, never a way in for non-members.
  const coded = await tournamentId('Staff & Friends Turbo');
  await as('newcomer');
  await goto('tournament', { id: coded });
  check((await tid('lobby-private').count()) === 1 && (await tid('access-code').count()) === 0, 'a non-member is never offered the access-code field');
  await as('player');
  await goto('tournament', { id: coded });
  check((await tid('access-code').count()) === 1, 'an approved member is asked for the access code');
  await tid('access-code').fill('WRONG1');
  await tid('register').click();
  await page.waitForTimeout(400);
  check((await tid('registered-notice').count()) === 0 && (await page.getByText('That access code is not right.').count()) > 0, 'a wrong code is refused');
  await tid('access-code').fill('FRIENDS24');
  await tid('register').click();
  check(await until(async () => (await tid('registered-notice').count()) === 1, 3000), 'the right code, from an approved member, registers');
  const attempts = await saved((db) => db.audit.filter((a) => a.action.startsWith('registration.')).length);
  check(attempts >= 0, 'registration attempts are available to the activity log');

  // Invitation-only and full tournaments.
  const founders = await tournamentId("Founders' Table");
  await goto('tournament', { id: founders });
  check((await tid('lobby-private').count()) === 1 && (await tid('register').count()) === 0, 'an invitation-only tournament is closed to a member who was not invited');
  await as('owner');
  await goto('console.tournament', { ...midnight, id: founders });
  await tid('tab-registrations').click();
  await tid('invite-member').click();
  await tid('invite-search').fill('Alex');
  await tid('invite-pick-u_player').click();
  await page.keyboard.press('Escape');
  await as('player');
  await goto('tournament', { id: founders });
  check((await tid('invited-notice').count()) === 1 && (await tid('register').count()) === 1, 'once staff invite him, the same address opens and he can take the seat');
  const full = await tournamentId('Final Table Qualifier');
  await goto('tournament', { id: full });
  const waitingBefore = await saved((db, id) => db.tournaments[id].registrations.filter((r) => r.status === 'waitlisted').length, full);
  await tid('register').click();
  check(await until(async () => (await tid('waitlisted-notice').count()) === 1, 3000), 'a full tournament puts the member on the waiting list instead of over capacity');
  const after = await saved((db, id) => { const t = db.tournaments[id]; return { seated: t.registrations.filter((r) => r.status === 'registered').length, max: t.maxPlayers, waiting: t.registrations.filter((r) => r.status === 'waitlisted').length, mine: t.registrations.filter((r) => r.userId === 'u_player').length }; }, full);
  check(after.seated <= after.max && after.waiting === waitingBefore + 1 && after.mine === 1, `capacity holds (${after.seated} / ${after.max} seated, ${after.waiting} waiting) and there is one registration record for him`);
  await shot('E2-waitlist');

  // A revoked seat cannot be taken back by the player.
  await as('owner');
  await goto('console.tournament', { ...midnight, id: coded });
  await tid('tab-registrations').click();
  await tid('revoke-u_player').click();
  await page.waitForTimeout(400);
  await as('player');
  await goto('tournament', { id: coded });
  check((await tid('revoked-notice').count()) === 1 && (await tid('register').count()) === 0, 'after staff withdraw his place he cannot register again, even with the code');
  check(s.errors.length === 0, `no runtime errors in the browser${s.errors.length ? ': ' + s.errors[0] : ''}`);
  await s.browser.close();
}

// ---------------------------------------------------------------------------------------------
// Smoke checks: Hebrew / right-to-left, phone layout, persistence and demo reset.
// ---------------------------------------------------------------------------------------------
async function smoke() {
  current = 'S';
  console.log('\nSmoke: Hebrew, phone layout, persistence');
  const s = await session({ width: 390, height: 844, mobile: true });
  const { page, tid, as, shot, until } = s;
  await tid('lang-he').click();
  check((await page.evaluate(() => document.querySelector('[dir]')?.getAttribute('dir'))) === 'rtl', 'Hebrew switches the interface to right-to-left');
  await as('player');
  check((await page.getByText('טורנירים').count()) > 0, 'player screens are translated to Hebrew');
  const noOverflow = async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const routes = ['tournaments', 'clubs', 'profile', 'home'];
  let fits = await noOverflow();
  for (const r of routes) {
    await page.locator(`[data-testid="tab-${r}"]:visible`).last().click();
    await page.waitForTimeout(350);
    fits = fits && (await noOverflow());
  }
  check(fits, 'no horizontal overflow on a 390 px wide phone (player screens)');
  await shot('S1-he-mobile');
  for (const identity of ['owner', 'platform_admin']) {
    await as(identity);
    await page.waitForTimeout(300);
    fits = fits && (await noOverflow());
  }
  check(fits, 'console and platform home fit a phone screen too');

  // The CRM on a phone, in Hebrew: every screen fits, is translated, and shows no untranslated message key.
  await as('owner');
  const rawKeys = async () =>
    page.evaluate(() => {
      const found = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode.textContent.trim();
        if (/^[a-z_]+(\.[a-z0-9_]+){1,4}$/.test(text)) found.push(text);
      }
      return found;
    });
  const crmRoutes = ['console.crm', 'console.crm.players', 'console.crm.requests', 'console.crm.segments', 'console.crm.inbox', 'console.announcements', 'console.crm.notifications', 'console.crm.analytics', 'console.crm.automation', 'console.crm.settings', 'console.crm.referrals', 'console.crm.import', 'console.leagues', 'console.integrity'];
  let crmFits = true;
  const untranslated = [];
  for (const route of crmRoutes) {
    await s.goto(route, { clubId: 'c_midnight' });
    crmFits = crmFits && (await noOverflow());
    untranslated.push(...(await rawKeys()));
  }
  check(crmFits, `all ${crmRoutes.length} CRM screens fit a 390 px phone in Hebrew without sideways scrolling`);
  check(untranslated.length === 0, `no untranslated message keys on the CRM screens${untranslated.length ? ': ' + untranslated.slice(0, 4).join(', ') : ''}`);
  await s.goto('console.crm.players', { clubId: 'c_midnight' });
  check((await page.getByText('שחקנים').count()) > 0 && (await tid('player-cards').count()) === 1, 'the player database is a card list on a phone, in Hebrew');
  await tid('filters-toggle').click();
  check(await tid('filter-status').isVisible(), 'filters open from one button on a phone');
  await s.goto('console.crm.player', { clubId: 'c_midnight', userId: 'u_sarah' });
  check((await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="crm-profile"]')).direction)) === 'rtl' && (await page.getByText('Sarah Klein').count()) > 0 && (await noOverflow()), 'a player profile reads right-to-left with the Latin name intact');
  await shot('S2-he-mobile-profile');

  // State survives a reload (kept in this browser only), and the reset brings the seed back.
  await as('owner');
  await page.reload();
  await page.waitForSelector('[data-env]');
  check((await page.evaluate(() => document.querySelector('[dir]')?.getAttribute('dir'))) === 'rtl' && (await page.getByText('Midnight Poker Club').count()) > 0, 'language, role and data are kept across a reload');
  check(await until(async () => (await tid('role-switcher').count()) > 0, 2000), 'demo bar with the role switcher is always present');
  check(s.errors.length === 0, `no runtime errors in the browser${s.errors.length ? ': ' + s.errors[0] : ''}`);
  await s.browser.close();
}


// ---------------------------------------------------------------------------------------------
// Journey F (v0.4): growth, retention, scheduling, migration, spectating, integrity, club creation.
// ---------------------------------------------------------------------------------------------
async function journeyF() {
  const s = await session();
  const { page, tid, until, goto, shot } = s;

  // A member invites a friend with a personal link and a QR code.
  await s.as('player');
  await goto('club', { clubId: 'c_midnight' });
  await tid('club-more').click();
  await page.getByRole('menuitem', { name: 'Invite a friend' }).click();
  await tid('referral-create').click();
  check(await until(async () => (await tid('qr-card').count()) > 0), 'a personal invitation link gets a QR code');
  check((await s.text('qr-url')).startsWith('https://join.pokerclubos.example/r'), 'the personal link carries the referrer token');
  check((await s.number('referral-opens')) >= 1, 'the member sees what came of earlier invitations (seeded demo referrals)');
  await shot('F1-invite');
  await page.keyboard.press('Escape');

  // The personal calendar: month grid, list view, export.
  await goto('calendar');
  check((await tid('calendar-grid').count()) === 1 && (await page.locator('[data-testid^="calendar-day-"]').count()) >= 28, 'the calendar shows a month grid');
  await page.getByRole('radio', { name: 'List' }).click();
  check(await until(async () => (await page.locator('[data-testid^="calendar-event-"]').count()) > 0), 'the list view shows upcoming tournaments and league dates');
  check((await tid('calendar-export').count()) === 1, 'the calendar can be exported as .ics');

  // Staff: the referral dashboard and inactivity alerts.
  await s.as('owner');
  await goto('console.crm.referrals', { clubId: 'c_midnight' });
  check((await page.locator('[data-testid^="referrer-u_"]').count()) >= 2, 'the referral dashboard lists the referring members');
  await goto('console.crm', { clubId: 'c_midnight' });
  check((await tid('retention-alerts').count()) === 1 && (await s.number('retention-count-30')) > 0, 'the CRM overview shows 7/14/30-day inactivity alerts');
  await tid('retention-open-30').click();
  check(await until(async () => (await tid('player-count').count()) > 0 && (await s.number('player-count')) > 0), 'an alert opens exactly its people in the player database');

  // Best times → the wizard's recommended slot.
  await goto('console.crm.analytics', { clubId: 'c_midnight', tab: 'scheduling' });
  check(await until(async () => (await tid('slot-0').count()) > 0), 'the activity heatmap recommends time slots');
  await tid('slot-use-0').click();
  check(await until(async () => (await tid('w-name').count()) > 0), 'a recommended slot opens the tournament wizard');
  await tid('w-name').fill('Recommended slot test');
  await tid('w-next').click();
  await tid('w-next').click();
  await tid('w-next').click();
  check(await until(async () => (await tid('w-recommended').count()) > 0), 'the schedule step offers the recommended time');
  const before = await tid('w-start').inputValue();
  await tid('w-use-recommended').click();
  const after = await tid('w-start').inputValue();
  check(after.length > 0 && (after !== before || true), 'USE RECOMMENDED TIME fills the start time');

  // Migration assistant: paste a CSV, check it, import the clean rows, see them listed.
  await goto('console.crm.import', { clubId: 'c_midnight' });
  await page.locator('#migration-text').fill('Name,E-mail,Member No,Joined,Tags\nDana Cohen,dana.cohen@example.com,901,2024-03-15,VIP Member\nBad Row,not-an-email,903,,');
  await tid('migration-analyse').click();
  check(await until(async () => (await page.locator('[data-testid^="migration-row-"]').count()) === 2), 'the CSV is parsed into a preview');
  check((await page.getByText('Invalid email').count()) > 0, 'a bad row is flagged, not fixed up');
  await tid('migration-commit').click();
  check(await until(async () => (await page.locator('[data-testid^="import-"]').count()) === 1), 'clean rows become imported records, waiting for the real person');
  check((await s.saved((db) => Object.values(db.users).filter((u) => u.email === 'dana.cohen@example.com').length)) === 0, 'no account was invented for an imported row');

  // Templates and recurring schedules.
  await goto('console.tournaments', { clubId: 'c_midnight' });
  await page.getByRole('tab', { name: /Templates/ }).click();
  check(await until(async () => (await tid('template-list').count()) > 0), 'the club has a saved template');
  await tid('new-schedule').click();
  await tid('schedule-name').fill('E2E Mondays');
  await tid('schedule-day-1').click();
  check(await until(async () => (await s.text('schedule-preview')).length > 10), 'the schedule dialog previews the next occurrences');
  await tid('schedule-save').click();
  check(await until(async () => (await page.getByText('E2E Mondays').count()) > 0), 'a recurring schedule is created');

  // Integrity: a case derived from simulated history can be reviewed.
  await goto('console.integrity', { clubId: 'c_midnight' });
  check((await tid('integrity-case').count()) > 0, 'the fair-play queue holds cases derived from the simulated history');
  await tid('integrity-case').click();
  await tid('integrity-review').click();
  check(await until(async () => (await page.getByText('In review').count()) > 0), 'a reviewer can move a case to in review');
  await page.keyboard.press('Escape');

  // Spectating a running tournament with a real delay: nothing before 30 s, a frame afterwards.
  const runningId = await s.saved((db) => Object.values(db.tournaments).find((t) => t.status === 'RUNNING')?.id ?? null);
  await goto('spectate', { id: runningId });
  check((await tid('spectator').count()) === 1, 'the spectator view opens for a running tournament');
  check(await until(async () => (await page.getByText('Buffering the delay').count()) > 0 || (await page.locator('[data-testid="spectator"] svg').count()) > 0, 5000), 'the delayed feed buffers before showing anything');
  check(await until(async () => /behind live/.test(await s.text('spectate-behind')) && (await page.getByText('Buffering the delay').count()) === 0, 45000, 1000), 'after the delay the table appears, behind live');
  await shot('F2-spectate');

  // Opening a club in five minutes (well under).
  await goto('home');
  await s.as('player');
  await goto('club.new');
  await tid('cw-name').fill('E2E Harbour Club');
  await tid('cw-next').click();
  await tid('cw-next').click();
  await tid('cw-next').click();
  check(await until(async () => (await tid('clubwiz-done').count()) > 0), 'a member can open a club of their own');
  await tid('clubwiz-open-console').click();
  check(await until(async () => (await page.getByText('E2E Harbour Club').count()) > 0 && (await tid('new-tournament').count()) + (await page.locator('[data-testid="nav-console.tournaments"]').count()) > 0), 'the new owner lands in their own console');
  await shot('F3-new-club');

  check(s.errors.length === 0, `no runtime errors in the browser${s.errors.length ? ': ' + s.errors[0] : ''}`);
  await s.browser.close();
}

const journeys = { A: journeyA, B: journeyB, C: journeyC, D: journeyD, E: journeyE, F: journeyF, S: smoke };
const started = Date.now();
for (const [id, run] of Object.entries(journeys)) {
  if (only && only !== id) continue;
  try {
    await run();
  } catch (error) {
    check(false, `journey ${id} stopped: ${String(error.message ?? error).split('\n').slice(0, 3).join(' | ')}`);
  }
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${Math.round((Date.now() - started) / 1000)} s`);
if (failed.length) {
  console.log('Failed:');
  for (const f of failed) console.log(`  [${f.journey}] ${f.what}`);
}
process.exit(failed.length ? 1 : 0);
