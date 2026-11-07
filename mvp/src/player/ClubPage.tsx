import { useState, type ReactNode } from 'react';
import {
  LuArrowLeft,
  LuBan,
  LuBell,
  LuBellOff,
  LuCalendarClock,
  LuCheck,
  LuCopy,
  LuEllipsis,
  LuGlobe,
  LuHeart,
  LuHourglass,
  LuLayoutDashboard,
  LuLock,
  LuLogOut,
  LuMail,
  LuMapPin,
  LuPin,
  LuQrCode,
  LuSettings2,
  LuTrophy,
  LuUserPlus,
  LuUsers,
} from 'react-icons/lu';
import { FaDiscord, FaFacebookF, FaInstagram, FaTelegram, FaTiktok, FaWhatsapp, FaXTwitter } from 'react-icons/fa6';
import { act, toasts } from '../app/context.ts';
import { chips, dateShort, ordinal, relativeTime } from '../app/format.ts';
import { go, useDb, useMe, useNow, useT } from '../app/hooks.ts';
import * as api from '../platform/api.ts';
import { isLive, isUpcoming } from '../platform/lifecycle.ts';
import { clubRanking, clubTournaments, resultsFor, scheduleOrder } from '../platform/selectors.ts';
import type { SocialKey } from '../platform/types.ts';
import { TournamentCard, dayLabel } from '../shared/tournament.tsx';
import { Badge, BotTag, Button, cx, DemoTag, EmptyState, Notice, Panel, PanelHeader } from '../ui/core.tsx';
import { Switch } from '../ui/forms.tsx';
import { V3 } from '../app/design.ts';
import { Avatar, ClubCover, ClubLogo, ClubName, codeFor } from '../ui/identity.tsx';
import { ConfirmDialog, Dialog, Menu, MenuItem, Tabs } from '../ui/overlay.tsx';
import { JoinDialog } from './Clubs.tsx';
import { ClubQrDialog, InviteFriendDialog } from './InviteDialog.tsx';

type Tab = 'overview' | 'tournaments' | 'results' | 'ranking' | 'rules';

export const SOCIAL_ICONS: Record<SocialKey, ReactNode> = {
  instagram: <FaInstagram />,
  telegram: <FaTelegram />,
  whatsapp: <FaWhatsapp />,
  tiktok: <FaTiktok />,
  facebook: <FaFacebookF />,
  discord: <FaDiscord />,
  x: <FaXTwitter />,
  website: <LuGlobe />,
};

/**
 * A club's page. What it shows depends on who is looking, and that decision is
 * made by the service layer (`api.clubView`): a visitor or follower gets the
 * public profile; an approved member also gets the private schedule, member
 * announcements and results.
 */
export function ClubPage({ clubId }: { clubId: string }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(60_000);
  const [tab, setTab] = useState<Tab>('overview');
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [preferences, setPreferences] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [showQr, setShowQr] = useState(false);
  if (!db.clubs[clubId]) {
    return <EmptyState title={t('club.not_found')} action={<Button onClick={() => go('clubs')}>{t('nav.clubs')}</Button>} />;
  }
  const view = api.clubView(db, me.id, clubId);
  const { club, membership, following } = view;
  const isMember = membership?.status === 'active';
  const banned = membership?.status === 'banned';
  const current = [...view.tournaments].sort(scheduleOrder).filter((x) => isLive(x.status) || isUpcoming(x.status));
  const results = view.showResults ? resultsFor(db, { clubId }) : [];
  const ranking = view.showResults ? clubRanking(db, clubId, now - 30 * 86_400_000) : [];
  const announcements = view.announcements;
  const myRank = ranking.findIndex((r) => r.userId === me.id);
  const joinLabel = club.joinPolicy === 'open' ? t('join.join_now') : t('join.request');

  const copyId = () => {
    navigator.clipboard?.writeText(club.code).then(
      () => toasts.push('success', t('club.id_copied')),
      () => toasts.push('info', `ID ${codeFor(club)}`),
    );
  };
  const follow = () => act(() => api.followClub(db, me.id, clubId), { key: 'club.followed', params: { club: club.name } });

  return (
    <div data-testid="club-page">
      <button type="button" onClick={() => go('clubs')} className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        <LuArrowLeft className="size-4 flip-rtl" aria-hidden />
        {t('nav.clubs')}
      </button>

      <div className={cx('rounded-hero border border-line bg-surface', V3 && 'stage relative overflow-hidden border-0')}>
        <ClubCover branding={club.branding} seed={Number(club.code)} className={V3 ? 'h-40 sm:h-56' : 'h-32 rounded-t-[15px] sm:h-40'} />
        {V3 && <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-transparent via-transparent to-surface sm:h-56" aria-hidden />}
        <div className={cx('relative px-4 pb-4 sm:px-6 sm:pb-5', V3 ? '-mt-12' : '-mt-10')}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <ClubLogo branding={club.branding} name={club.name} size={V3 ? 88 : 76} className={V3 ? 'shadow-pop ring-4 ring-surface' : 'ring-4 ring-surface'} />
            <div className="flex flex-wrap items-center justify-end gap-2">
              {isMember && (
                <Badge tone="success" className="h-8 px-3 text-[12.5px]">
                  <LuCheck className="size-3.5" aria-hidden />
                  <span data-testid="membership-status">{membership.role === 'player' ? t('club.status.approved') : t(`role.${membership.role}`)}</span>
                </Badge>
              )}
              {membership?.status === 'pending' && (
                <Button size="sm" icon={<LuHourglass className="size-4" aria-hidden />} onClick={() => setJoining(true)}>
                  <span data-testid="membership-status">{t('clubs.status.pending')}</span>
                </Button>
              )}
              {!banned &&
                club.status === 'active' &&
                (following ? (
                  <Menu
                    trigger={(p) => (
                      <Button size="sm" {...p} icon={<LuCheck className="size-4 text-accent" aria-hidden />} data-testid="club-following">
                        {t('club.following')}
                      </Button>
                    )}
                  >
                    {(close) => (
                      <>
                        <MenuItem
                          icon={following.notify ? <LuBellOff /> : <LuBell />}
                          onClick={() => {
                            close();
                            act(() => api.setFollowNotify(db, me.id, clubId, !following.notify), { key: following.notify ? 'club.updates_off' : 'club.updates_on' });
                          }}
                        >
                          {following.notify ? t('club.turn_updates_off') : t('club.turn_updates_on')}
                        </MenuItem>
                        <MenuItem
                          icon={<LuHeart />}
                          onClick={() => {
                            close();
                            act(() => api.unfollowClub(db, me.id, clubId), { key: 'club.unfollowed' });
                          }}
                        >
                          {t('club.unfollow')}
                        </MenuItem>
                      </>
                    )}
                  </Menu>
                ) : (
                  <Button size="sm" variant={isMember || membership?.status === 'pending' ? 'secondary' : 'primary'} icon={<LuHeart className="size-4" aria-hidden />} onClick={follow} data-testid="club-follow">
                    {t('club.follow')}
                  </Button>
                ))}
              {!membership && club.status === 'active' && (
                <Button size="sm" variant={following ? 'primary' : 'secondary'} icon={<LuUserPlus className="size-4" aria-hidden />} onClick={() => setJoining(true)} data-testid="club-join">
                  {joinLabel}
                </Button>
              )}
              {membership?.status === 'rejected' && club.status === 'active' && (
                <Button size="sm" icon={<LuUserPlus className="size-4" aria-hidden />} onClick={() => setJoining(true)} data-testid="club-join">
                  {t('club.ask_again')}
                </Button>
              )}
              {!banned && club.status === 'active' && (
                <Button size="sm" icon={<LuMail className="size-4" aria-hidden />} onClick={() => go('messages', { clubId })} data-testid="club-contact">
                  {t('club.contact')}
                </Button>
              )}
              {view.isStaff && (
                <Button size="sm" icon={<LuLayoutDashboard className="size-4" aria-hidden />} onClick={() => go('console.home', { clubId })}>
                  {t('nav.open_console')}
                </Button>
              )}
              <Menu
                trigger={(p) => (
                  <button type="button" {...p} aria-label={t('club.more')} className="inline-flex size-8 items-center justify-center rounded-control border border-line-strong/70 text-ink-2 hover:bg-raised hover:text-ink" data-testid="club-more">
                    <LuEllipsis className="size-4" aria-hidden />
                  </button>
                )}
              >
                {(close) => (
                  <>
                    <MenuItem
                      icon={<LuCopy />}
                      onClick={() => {
                        close();
                        copyId();
                      }}
                    >
                      {t('club.copy_id')}
                    </MenuItem>
                    {isMember && (
                      <MenuItem
                        icon={<LuUserPlus />}
                        onClick={() => {
                          close();
                          setInviting(true);
                        }}
                      >
                        {t('referral.invite_friend')}
                      </MenuItem>
                    )}
                    {club.status === 'active' && (
                      <MenuItem
                        icon={<LuQrCode />}
                        onClick={() => {
                          close();
                          setShowQr(true);
                        }}
                      >
                        {t('club.show_qr')}
                      </MenuItem>
                    )}
                    {(isMember || membership?.status === 'pending') && (
                      <MenuItem
                        icon={<LuSettings2 />}
                        onClick={() => {
                          close();
                          setPreferences(true);
                        }}
                      >
                        {t('club.preferences')}
                      </MenuItem>
                    )}
                    {isMember && membership.role !== 'owner' && (
                      <MenuItem
                        icon={<LuLogOut className="flip-rtl" />}
                        tone="danger"
                        onClick={() => {
                          close();
                          setLeaving(true);
                        }}
                      >
                        {t('club.leave')}
                      </MenuItem>
                    )}
                  </>
                )}
              </Menu>
            </div>
          </div>
          <h1 className={cx('mt-3 leading-tight text-ink', V3 ? 'display text-[30px] sm:text-[38px]' : 'text-[26px] font-semibold tracking-[-0.015em] sm:text-[30px]')}>
            <ClubName club={club} />
          </h1>
          <p className="mt-1 text-[14px] text-ink-2">{club.tagline}</p>
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-ink-2 tabular-nums">
            {view.members !== null && (
              <div className="flex items-center gap-1.5">
                <LuUsers className="size-4 text-ink-3" aria-hidden />
                <dd>{t.n('clubs.members', view.members)}</dd>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <LuHeart className="size-4 text-ink-3" aria-hidden />
              <dd data-testid="follower-count">{t.n('clubs.followers', view.followers)}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <LuCalendarClock className="size-4 text-ink-3" aria-hidden />
              <dd>{t.n('clubs.upcoming', current.filter((x) => isUpcoming(x.status)).length)}</dd>
            </div>
            {club.location && (
              <div className="flex items-center gap-1.5">
                <LuMapPin className="size-4 text-ink-3" aria-hidden />
                <dd>
                  {club.location} · <span dir="ltr">{club.timezone}</span>
                </dd>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <dt className="text-ink-3">{t('club.id')}</dt>
              <dd dir="ltr" className="font-medium text-ink">
                {codeFor(club)}
              </dd>
            </div>
            {isMember && (
              <div className="flex items-center gap-1.5">
                <dt className="text-ink-3">{t('club.your_points')}</dt>
                <dd className="font-medium text-ink" title={t('common.points_note')}>
                  {chips(membership.demoPoints)}
                </dd>
              </div>
            )}
          </dl>
          {view.social.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t('club.social')}>
              {view.social.map((link) => (
                <li key={link.key}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong/70 px-3 text-[12.5px] text-ink-2 hover:bg-raised hover:text-ink [&>svg]:size-3.5"
                    data-testid={`social-${link.key}`}
                  >
                    {SOCIAL_ICONS[link.key]}
                    {t(`social.${link.key}`)}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          label={club.name}
          className="px-2 sm:px-4"
          tabs={[
            { value: 'overview', label: t('club.tab.overview') },
            { value: 'tournaments', label: t('club.tab.tournaments'), count: current.length },
            { value: 'results', label: t('club.tab.results') },
            { value: 'ranking', label: t('club.tab.ranking') },
            { value: 'rules', label: t('club.tab.rules') },
          ]}
        />
      </div>

      {club.status === 'suspended' && (
        <Notice tone="danger" className="mt-4">
          {t('club.suspended')}
        </Notice>
      )}
      {banned && (
        <Notice tone="danger" icon={<LuBan />} className="mt-4">
          <span data-testid="membership-status">{t('club.status.banned_note')}</span>
        </Notice>
      )}
      {membership?.status === 'suspended' && (
        <Notice tone="danger" className="mt-4">
          <span data-testid="membership-status">{t('err.suspended')}</span>
        </Notice>
      )}
      {!isMember && !banned && membership?.status !== 'suspended' && club.status === 'active' && (
        <Notice
          tone="info"
          className="mt-4"
          icon={<LuLock />}
          action={
            membership?.status === 'pending' ? undefined : (
              <Button size="sm" variant="primary" onClick={() => setJoining(true)}>
                {membership?.status === 'rejected' ? t('club.ask_again') : joinLabel}
              </Button>
            )
          }
        >
          {membership?.status === 'pending' ? t('join.pending', { club: club.name }) : membership?.status === 'rejected' ? t('join.rejected') : following ? t('club.follower_note') : t('club.visitor_note')}
          {view.hasPrivateSchedule && <span className="mt-0.5 block text-[12.5px] text-ink-2">{t('club.private_schedule_note')}</span>}
        </Notice>
      )}

      <div className="mt-5">
        {tab === 'overview' && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-5">
              <Panel>
                <PanelHeader title={t('club.about')} />
                <p className="max-w-[70ch] text-[14px] leading-relaxed text-ink-2">{club.description || t('club.no_description')}</p>
              </Panel>
              <section>
                <div className="mb-2.5 flex items-center justify-between">
                  <h2 className="text-[15px] font-semibold text-ink">{isMember ? t('club.next_tournaments') : t('club.public_tournaments')}</h2>
                  <Button size="sm" variant="ghost" onClick={() => setTab('tournaments')}>
                    {t('club.full_calendar')}
                  </Button>
                </div>
                {current.length === 0 ? (
                  <EmptyState icon={<LuCalendarClock />} title={t('club.no_tournaments.title')} body={isMember ? t('club.no_tournaments.body') : t('club.no_public_tournaments')} />
                ) : (
                  <div className="space-y-2.5">
                    {current.slice(0, 4).map((x) => (
                      <TournamentCard key={x.id} db={db} tournament={x} userId={me.id} showClub={false} />
                    ))}
                  </div>
                )}
              </section>
            </div>
            <aside className="min-w-0 space-y-4">
              <Panel>
                <PanelHeader title={t('club.announcements')} />
                {announcements.length === 0 ? (
                  <p className="text-[13px] text-ink-3">{t('home.no_announcements')}</p>
                ) : (
                  <ul className="space-y-4">
                    {announcements.slice(0, 5).map((a) => (
                      <li key={a.id}>
                        {a.image && <img src={a.image} alt="" className="mb-2 max-h-40 w-full rounded-inner object-cover" />}
                        <p className="flex items-start gap-1.5 text-[13.5px] leading-snug font-medium text-ink">
                          {a.pinned && <LuPin className="mt-0.5 size-3.5 shrink-0 text-accent" aria-label={t('club.pinned')} />}
                          {a.title}
                        </p>
                        {a.body && <p className="mt-1 text-[13px] leading-snug text-ink-2">{a.body}</p>}
                        {a.tournamentId && db.tournaments[a.tournamentId] && api.canViewTournament(db, me.id, db.tournaments[a.tournamentId]!) && db.tournaments[a.tournamentId]!.status !== 'DRAFT' && (
                          <button type="button" className="mt-1 text-[13px] font-medium text-accent hover:underline" onClick={() => go('tournament', { id: a.tournamentId! })} data-testid="announcement-tournament">
                            {t('club.open_tournament')}
                          </button>
                        )}
                        <p className="mt-1 text-[11.5px] text-ink-3">
                          {t(`announcement.kind.${a.kind}`)} · {t(`announcement.audience_short.${a.audience.type}`)} · {relativeTime(a.at, now, t.lang)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              {view.showResults && (
                <Panel>
                  <PanelHeader
                    title={t('club.top_month')}
                    action={
                      <Button size="sm" variant="ghost" onClick={() => setTab('ranking')}>
                        {t('club.full_ranking')}
                      </Button>
                    }
                  />
                  <RankingList rows={ranking.slice(0, 5)} meId={me.id} />
                  {myRank >= 5 && (
                    <p className="mt-2 border-t border-line pt-2 text-[12.5px] text-ink-2">{t('club.your_rank', { rank: ordinal(myRank + 1, t.lang), points: ranking[myRank]!.points })}</p>
                  )}
                </Panel>
              )}
            </aside>
          </div>
        )}

        {tab === 'tournaments' && (
          <CalendarList db={db} items={current} userId={me.id} now={now} emptyTitle={t('club.no_tournaments.title')} emptyBody={isMember ? t('club.no_tournaments.body') : t('club.no_public_tournaments')} />
        )}

        {tab === 'results' &&
          (!view.showResults ? (
            <EmptyState icon={<LuLock />} title={t('club.results_private.title')} body={t('club.results_private.body')} />
          ) : results.length === 0 ? (
            <EmptyState icon={<LuTrophy />} title={t('club.no_results.title')} body={t('club.no_results.body')} />
          ) : (
            <Panel pad={false}>
              <ul className="divide-y divide-line">
                {results.slice(0, 40).map((r) => {
                  const mine = r.places.find((p) => p.userId === me.id);
                  return (
                    <li key={r.tournamentId}>
                      <button type="button" onClick={() => go('results', { id: r.tournamentId })} className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-raised/50 sm:px-5">
                        <span className="w-14 shrink-0 text-[12.5px] text-ink-3 tabular-nums">{dateShort(r.completedAt, t.lang)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium text-ink">{r.name}</span>
                          <span className="block truncate text-[12.5px] text-ink-2">
                            <LuTrophy className="me-1 inline size-3.5 -translate-y-px text-gold" aria-hidden />
                            {r.places[0]?.name} · {t.n('results.players', r.entrants)}
                          </span>
                        </span>
                        {mine && <Badge tone={mine.place === 1 ? 'gold' : mine.place <= 3 ? 'accent' : 'neutral'}>{t('results.you_n', { place: ordinal(mine.place, t.lang) })}</Badge>}
                        {r.seeded && <DemoTag label={t('common.demo')} className="hidden sm:inline-flex" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ))}

        {tab === 'ranking' &&
          (!view.showResults ? (
            <EmptyState icon={<LuLock />} title={t('club.results_private.title')} body={t('club.results_private.body')} />
          ) : (
            <Panel>
              <PanelHeader title={t('club.ranking_title')} hint={t('club.ranking_hint')} />
              {ranking.length === 0 ? <p className="text-[13px] text-ink-3">{t('club.no_results.body')}</p> : <RankingList rows={ranking.slice(0, 50)} meId={me.id} detailed />}
            </Panel>
          ))}

        {tab === 'rules' && (
          <Panel>
            <PanelHeader title={t('club.rules_title')} />
            {club.rules.length === 0 ? (
              <p className="text-[13px] text-ink-3">{t('club.no_rules')}</p>
            ) : (
              <ol className="max-w-[72ch] list-decimal space-y-2.5 ps-5 text-[14px] leading-relaxed text-ink-2 marker:text-ink-3">
                {club.rules.map((rule, i) => (
                  <li key={i}>{rule}</li>
                ))}
              </ol>
            )}
            <p className="mt-5 rounded-inner bg-raised px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-3">{t('common.points_note')}</p>
          </Panel>
        )}
      </div>

      <JoinDialog open={joining} onClose={() => setJoining(false)} initialClubId={clubId} />
      {isMember && <InviteFriendDialog club={club} open={inviting} onClose={() => setInviting(false)} />}
      <ClubQrDialog club={club} open={showQr} onClose={() => setShowQr(false)} />
      <Dialog open={preferences} onClose={() => setPreferences(false)} title={t('club.preferences')} description={t('club.preferences_hint', { club: club.name })} size="sm">
        {membership && (
          <div className="space-y-4">
            <Switch checked={membership.announcements} onChange={(v) => act(() => api.setMemberPreferences(db, me.id, clubId, { announcements: v }))} label={t('club.pref.announcements')} description={t('club.pref.announcements_hint')} />
            <Switch checked={membership.shareContact} onChange={(v) => act(() => api.setMemberPreferences(db, me.id, clubId, { shareContact: v }))} label={t('club.pref.share_contact')} description={t('club.pref.share_contact_hint', { email: me.email })} />
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={leaving}
        onClose={() => setLeaving(false)}
        onConfirm={() => {
          if (act(() => api.leaveClub(db, me.id, clubId), { key: 'club.left', params: { club: club.name } }) !== undefined) setLeaving(false);
        }}
        title={t('club.leave_title', { club: club.name })}
        body={t('club.leave_body')}
        confirmLabel={t('club.leave')}
        danger
      />
    </div>
  );
}

export function RankingList({ rows, meId, detailed }: { rows: ReturnType<typeof clubRanking>; meId: string; detailed?: boolean }) {
  const t = useT();
  if (rows.length === 0) return <p className="text-[13px] text-ink-3">{t('club.no_ranking')}</p>;
  return (
    <ol className="text-[13.5px]">
      {rows.map((r, i) => (
        <li key={r.userId} className={cx('flex items-center gap-2.5 rounded-control px-1.5 py-1.5', r.userId === meId && 'bg-accent/10')}>
          <span className={cx('flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums', i === 0 ? 'bg-gold text-[#1c1505]' : i < 3 ? 'bg-gold/15 text-gold' : 'text-ink-3')}>{i + 1}</span>
          <Avatar user={r} size={26} />
          <span className="min-w-0 flex-1 truncate text-ink">{r.name}</span>
          {r.isBot && <BotTag label={t('common.bot')} />}
          {detailed && (
            <span className="hidden w-24 shrink-0 text-end text-[12.5px] text-ink-3 tabular-nums sm:inline">
              {t.n('club.played', r.played)}
              {r.wins > 0 ? ` · ${t.n('club.wins', r.wins)}` : ''}
            </span>
          )}
          <span className="w-12 shrink-0 text-end font-semibold text-ink tabular-nums">{r.points}</span>
        </li>
      ))}
    </ol>
  );
}

export function CalendarList({ db, items, userId, now, emptyTitle, emptyBody }: { db: ReturnType<typeof useDb>; items: ReturnType<typeof clubTournaments>; userId: string; now: number; emptyTitle: string; emptyBody: string }) {
  const t = useT();
  if (items.length === 0) return <EmptyState icon={<LuCalendarClock />} title={emptyTitle} body={emptyBody} />;
  const groups: { title: string; items: typeof items }[] = [];
  for (const x of items) {
    const title = isLive(x.status) ? t('tournaments.group.running') : x.startMode === 'when_full' ? t('tournaments.group.sng') : dayLabel(t, x.startAt, now);
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.items.push(x);
    else groups.push({ title, items: [x] });
  }
  return (
    <div className="space-y-6">
      {groups.map((g, i) => (
        <section key={g.title + i}>
          <h2 className="mb-2.5 text-[13px] font-medium text-ink-2">{g.title}</h2>
          <div className="grid gap-2.5 xl:grid-cols-2">
            {g.items.map((x) => (
              <TournamentCard key={x.id} db={db} tournament={x} userId={userId} showClub={false} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
