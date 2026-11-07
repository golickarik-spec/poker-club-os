import { useEffect, useMemo, useState } from 'react';
import { LuCheck, LuChevronRight, LuHash, LuHeart, LuHourglass, LuLink, LuLock, LuLockOpen, LuMailCheck, LuPlus, LuQrCode, LuScanLine, LuSparkles, LuUsers } from 'react-icons/lu';
import { act, errorText } from '../app/context.ts';
import { relativeTime } from '../app/format.ts';
import { go, useDb, useMe, useNow, useT } from '../app/hooks.ts';
import { seededRng } from '../engine/rng.ts';
import * as api from '../platform/api.ts';
import { isLive, isUpcoming } from '../platform/lifecycle.ts';
import { membershipOf } from '../platform/permissions.ts';
import { followedClubs, userClubs } from '../platform/selectors.ts';
import { DomainError, type Club, type DB, type Membership } from '../platform/types.ts';
import { Badge, Button, cx, EmptyState, Notice, PageHeader } from '../ui/core.tsx';
import { Checkbox, Field, TextInput } from '../ui/forms.tsx';
import { accentStyle, ClubCover, ClubLogo, ClubName, codeFor } from '../ui/identity.tsx';
import { Dialog, Tabs } from '../ui/overlay.tsx';

export function ClubCard({ db, club, membership, viewerId }: { db: DB; club: Club; membership: Membership | undefined; viewerId: string }) {
  const t = useT();
  const now = useNow(60_000);
  // Only what this person may see: a visitor's card counts public tournaments and shows public news.
  const view = api.clubView(db, viewerId, club.id);
  const running = view.tournaments.filter((x) => isLive(x.status)).length;
  const upcoming = view.tournaments.filter((x) => isUpcoming(x.status)).length;
  const latest = view.announcements[0];
  const seed = Number(club.code) || 1;
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-panel border border-line bg-surface transition-colors hover:border-line-strong" style={accentStyle(club.branding.accent)} data-testid={`club-card-${club.id}`}>
      <ClubCover branding={club.branding} seed={seed} className="h-24" />
      <div className="relative -mt-9 flex flex-1 flex-col px-4 pb-4">
        <div className="flex items-end justify-between gap-3">
          <ClubLogo branding={club.branding} name={club.name} size={56} className="ring-4 ring-surface" />
          {membership?.status === 'active' ? (
            <Badge tone="success">
              <LuCheck className="size-3" aria-hidden />
              {t(`role.${membership.role}`)}
            </Badge>
          ) : membership?.status === 'pending' ? (
            <Badge tone="warning">
              <LuHourglass className="size-3" aria-hidden />
              {t('clubs.status.pending_short')}
            </Badge>
          ) : view.following ? (
            <Badge tone="accent">
              <LuHeart className="size-3" aria-hidden />
              {t('club.following')}
            </Badge>
          ) : (
            <Badge>
              {club.joinPolicy === 'open' ? <LuLockOpen className="size-3" aria-hidden /> : <LuLock className="size-3" aria-hidden />}
              {t(`clubs.policy.${club.joinPolicy}`)}
            </Badge>
          )}
        </div>
        <h3 className="mt-3 text-[17px] leading-snug font-semibold text-ink">
          <button type="button" onClick={() => go('club', { clubId: club.id })} className="text-start after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-accent">
            <ClubName club={club} />
          </button>
        </h3>
        <p className="mt-0.5 text-[13px] text-ink-2">{club.tagline}</p>
        <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-2 tabular-nums">
          {view.members !== null && (
            <div className="flex items-center gap-1.5">
              <LuUsers className="size-3.5 text-ink-3" aria-hidden />
              <dd>{t.n('clubs.members', view.members)}</dd>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <LuHeart className="size-3.5 text-ink-3" aria-hidden />
            <dd>{t.n('clubs.followers', view.followers)}</dd>
          </div>
          {running > 0 && (
            <div className="flex items-center gap-1.5 text-success">
              <span className="size-1.5 animate-pulse-dot rounded-full bg-current" aria-hidden />
              <dd>{t.n('clubs.running', running)}</dd>
            </div>
          )}
          {(membership?.status === 'active' || upcoming > 0) && <dd>{t.n('clubs.upcoming', upcoming)}</dd>}
        </dl>
        {latest && (
          <p className="mt-3 line-clamp-2 border-t border-line pt-3 text-[12.5px] leading-snug text-ink-2">
            <span className="font-medium text-ink">{latest.title}</span> · {relativeTime(latest.at, now, t.lang)}
          </p>
        )}
      </div>
    </article>
  );
}

export function Clubs() {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const [joining, setJoining] = useState(false);
  const mine = userClubs(db, me.id);
  const followed = followedClubs(db, me.id);
  const mineIds = new Set([...mine.map((m) => m.club.id), ...followed.map((f) => f.club.id)]);
  const others = Object.values(db.clubs).filter((c) => !mineIds.has(c.id) && c.status === 'active');
  return (
    <>
      <PageHeader
        title={t('clubs.title')}
        subtitle={t('clubs.subtitle')}
        actions={
          <>
            <Button icon={<LuSparkles className="size-4" aria-hidden />} onClick={() => go('club.new')} data-testid="open-club">
              {t('clubs.open_club')}
            </Button>
            <Button variant="primary" icon={<LuPlus className="size-4" aria-hidden />} onClick={() => setJoining(true)} data-testid="join-club">
              {t('clubs.join')}
            </Button>
          </>
        }
      />
      {mine.length === 0 ? (
        <EmptyState
          icon={<LuUsers />}
          title={t('home.no_clubs.title')}
          body={t('home.no_clubs.body')}
          action={
            <Button variant="primary" onClick={() => setJoining(true)}>
              {t('clubs.join')}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {mine.map(({ club, membership }) => (
            <ClubCard key={club.id} db={db} club={club} membership={membership} viewerId={me.id} />
          ))}
        </div>
      )}
      {followed.length > 0 && (
        <section className="mt-9" data-testid="clubs-following">
          <h2 className="text-[15px] font-semibold text-ink">{t('clubs.following')}</h2>
          <p className="mt-0.5 mb-3 text-[13px] text-ink-2">{t('clubs.following_hint')}</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {followed.map(({ club }) => (
              <ClubCard key={club.id} db={db} club={club} membership={membershipOf(db, me.id, club.id)} viewerId={me.id} />
            ))}
          </div>
        </section>
      )}
      {others.length > 0 && (
        <section className="mt-9">
          <h2 className="text-[15px] font-semibold text-ink">{t('clubs.discover')}</h2>
          <p className="mt-0.5 mb-3 text-[13px] text-ink-2">{t('clubs.discover_hint')}</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {others.map((club) => (
              <ClubCard key={club.id} db={db} club={club} membership={membershipOf(db, me.id, club.id)} viewerId={me.id} />
            ))}
          </div>
        </section>
      )}
      <JoinDialog open={joining} onClose={() => setJoining(false)} />
    </>
  );
}

// ----- Joining ------------------------------------------------------------------------------

type JoinTab = 'link' | 'id' | 'qr';

/** A decorative code tile for the simulated scanner. It is not a real, scannable QR code. */
function SampleCode({ seed, size = 84 }: { seed: number; size?: number }) {
  const cells = useMemo(() => {
    const rng = seededRng(seed);
    const n = 21;
    const grid: boolean[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => rng.float() < 0.48));
    const finder = (r0: number, c0: number) => {
      for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) grid[r0 + r]![c0 + c] = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      for (let i = -1; i <= 7; i++) {
        for (const [r, c] of [[r0 - 1, c0 + i], [r0 + 7, c0 + i], [r0 + i, c0 - 1], [r0 + i, c0 + 7]] as const) {
          if (r >= 0 && r < n && c >= 0 && c < n) grid[r]![c] = false;
        }
      }
    };
    finder(0, 0);
    finder(0, n - 7);
    finder(n - 7, 0);
    return grid;
  }, [seed]);
  return (
    <svg viewBox="0 0 23 23" width={size} height={size} className="rounded-chip bg-white" aria-hidden>
      {cells.map((row, r) => row.map((on, c) => (on ? <rect key={`${r}-${c}`} x={c + 1} y={r + 1} width="1.020" height="1.020" fill="#0b0f14" /> : null)))}
    </svg>
  );
}

export function JoinDialog({ open, onClose, initialClubId }: { open: boolean; onClose: () => void; initialClubId?: string }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const [tab, setTab] = useState<JoinTab>('link');
  const [link, setLink] = useState('');
  const [code, setCode] = useState('');
  const [foundId, setFoundId] = useState<string | null>(initialClubId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState<string | null>(null);
  const [via, setVia] = useState<Membership['via']>(initialClubId ? 'profile' : 'link');
  const [token, setToken] = useState<string | undefined>(undefined);
  const [invite, setInvite] = useState<api.OpenedInvite | null>(null);
  const [shareContact, setShareContact] = useState(false);
  const [announcements, setAnnouncements] = useState(true);

  useEffect(() => {
    if (open) {
      setFoundId(initialClubId ?? null);
      setVia(initialClubId ? 'profile' : 'link');
      setToken(undefined);
      setInvite(null);
      setShareContact(false);
      setAnnouncements(true);
      setError(null);
      setLink('');
      setCode('');
      setScanning(null);
    }
  }, [open, initialClubId]);

  const found = foundId ? db.clubs[foundId] : undefined;
  const membership = found ? membershipOf(db, me.id, found.id) : undefined;

  const lookup = () => {
    if (tab === 'link') {
      // Opening an invitation is recorded (once a day per link) so the club knows which of its links work.
      // An expired, revoked or used-up link is refused here, with the reason.
      try {
        const opened = api.openInvite(db, me.id, link);
        act(() => undefined);
        setError(null);
        setVia('link');
        setToken(link);
        setInvite(opened);
        setFoundId(opened.club.id);
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        setError(err.code === 'invite_not_found' ? t('join.error.link') : errorText(err));
        setFoundId(null);
      }
      return;
    }
    const club = api.findClubByCode(db, code);
    if (!club) {
      setError(t('join.error.id'));
      setFoundId(null);
      return;
    }
    setError(null);
    setVia('club_id');
    setToken(undefined);
    setInvite(null);
    setFoundId(club.id);
  };

  const scan = (club: Club) => {
    setScanning(club.id);
    setTimeout(() => {
      setScanning(null);
      setVia('qr');
      setToken(undefined);
      setInvite(null);
      setFoundId(club.id);
    }, 1100);
  };

  const join = () => {
    if (!found) return;
    act(() => api.requestJoin(db, me.id, found.id, via, { linkToken: token, shareContact, announcements }));
  };

  const samples = Object.values(db.clubs).filter((c) => c.status === 'active');

  return (
    <Dialog open={open} onClose={onClose} title={t('join.title')} description={found ? undefined : t('join.subtitle')} size="md">
      {found ? (
        <div style={accentStyle(found.branding.accent)} data-testid="join-preview">
          <div className="overflow-hidden rounded-inner border border-line">
            <ClubCover branding={found.branding} seed={Number(found.code)} className="h-20" />
            <div className="-mt-7 flex items-end gap-3 px-4">
              <ClubLogo branding={found.branding} name={found.name} size={52} className="relative ring-4 ring-surface" />
              <div className="relative min-w-0 flex-1 pb-0.5">
                <p className="truncate text-[17px] font-semibold text-ink">
                  <ClubName club={found} />
                </p>
              </div>
            </div>
            <div className="px-4 pt-2 pb-4">
              <p className="text-[13px] text-ink-2">{found.tagline}</p>
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-2 tabular-nums">
                <span>{t.n('clubs.followers', api.followerCount(db, found.id))}</span>
                <span dir="ltr">ID {codeFor(found)}</span>
                <span>{t(`clubs.policy.${found.joinPolicy}`)}</span>
              </p>
            </div>
          </div>

          {/* Three steps, so it is always clear where the request stands. */}
          <ol className="mt-4 grid grid-cols-3 gap-2 text-[12px]">
            {(['found', 'requested', 'member'] as const).map((step, i) => {
              const done = step === 'found' || (step === 'requested' && !!membership && membership.status !== 'rejected') || (step === 'member' && membership?.status === 'active');
              const current = (step === 'requested' && membership?.status === 'pending') || (step === 'found' && (!membership || membership.status === 'rejected'));
              return (
                <li key={step} className={cx('rounded-control border px-2 py-2', done ? 'border-accent/40 bg-accent/8 text-ink' : 'border-line text-ink-3', current && 'ring-1 ring-accent/50')}>
                  <span className="block text-[11px] text-ink-3 tabular-nums">{i + 1}</span>
                  {t(`join.step.${step}${step === 'requested' && found.joinPolicy === 'open' ? '_open' : ''}`)}
                </li>
              );
            })}
          </ol>

          <div className="mt-4">
            {membership?.status === 'active' ? (
              <Notice tone="success" icon={<LuCheck />}>
                {t('join.done', { club: found.name })}
              </Notice>
            ) : membership?.status === 'pending' ? (
              <Notice tone="warning" icon={<LuHourglass />}>
                {t('join.pending', { club: found.name })}
                {found.simulatedStaff && <span className="mt-1 block text-[12px] text-ink-3">{t('join.pending_simulated')}</span>}
              </Notice>
            ) : membership?.status === 'suspended' ? (
              <Notice tone="danger">{t('err.suspended')}</Notice>
            ) : membership?.status === 'banned' ? (
              <Notice tone="danger">{t('club.status.banned_note')}</Notice>
            ) : (
              <>
                {membership?.status === 'rejected' && (
                  <Notice tone="danger" className="mb-3">
                    {t('join.rejected')}
                  </Notice>
                )}
                <p className="text-[13px] leading-relaxed text-ink-2">{found.joinPolicy === 'open' ? t('join.explain.open') : t('join.explain.approval')}</p>
                <div className="mt-3 space-y-2.5 rounded-inner border border-line px-3 py-3">
                  <Checkbox checked={announcements} onChange={setAnnouncements} label={<span className="text-[13px]">{t('join.consent.announcements')}</span>} />
                  <Checkbox checked={shareContact} onChange={setShareContact} label={<span className="text-[13px]">{t('join.consent.contact', { email: me.email })}</span>} />
                  <p className="text-[12px] leading-snug text-ink-3">{t('join.consent.note')}</p>
                </div>
              </>
            )}
            {invite?.tournamentId && invite.tournament && (
              <Notice tone={invite.tournament === 'authorised' ? 'accent' : 'neutral'} icon={<LuMailCheck />} className="mt-3">
                <span data-testid="invite-outcome">{t(`join.invite.${invite.tournament}`, { name: db.tournaments[invite.tournamentId]?.name ?? '' })}</span>
                {invite.tournament === 'authorised' && (
                  <button
                    type="button"
                    className="mt-1 block text-[13px] font-medium text-accent hover:underline"
                    onClick={() => {
                      onClose();
                      go('tournament', { id: invite.tournamentId! });
                    }}
                  >
                    {t('club.open_tournament')}
                  </button>
                )}
              </Notice>
            )}
          </div>

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setFoundId(null)}>
              {t('join.other')}
            </Button>
            {membership?.status === 'active' ? (
              <Button
                variant="primary"
                trailing={<LuChevronRight className="size-4 flip-rtl" aria-hidden />}
                data-testid="join-go"
                onClick={() => {
                  onClose();
                  go('club', { clubId: found.id });
                }}
              >
                {t('join.go')}
              </Button>
            ) : membership?.status === 'pending' ? (
              <Button variant="secondary" onClick={() => act(() => api.cancelJoinRequest(db, me.id, found.id), { key: 'join.cancelled' })}>
                {t('join.cancel_request')}
              </Button>
            ) : membership?.status === 'suspended' || membership?.status === 'banned' ? null : (
              <Button variant="primary" onClick={join} data-testid="join-confirm">
                {found.joinPolicy === 'open' ? t('join.join_now') : t('join.request')}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
          <Tabs
            value={tab}
            onChange={(v) => {
              setTab(v);
              setError(null);
            }}
            label={t('join.title')}
            tabs={[
              { value: 'link', label: <><LuLink className="size-4" aria-hidden />{t('join.tab.link')}</> },
              { value: 'id', label: <><LuHash className="size-4" aria-hidden />{t('join.tab.id')}</> },
              { value: 'qr', label: <><LuQrCode className="size-4" aria-hidden />{t('join.tab.qr')}</> },
            ]}
          />
          <div className="pt-4">
            {tab === 'link' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  lookup();
                }}
              >
                <Field label={t('join.link.label')} htmlFor="join-link" error={error} hint={t('join.link.hint')}>
                  <TextInput id="join-link" value={link} onChange={setLink} placeholder="https://join.pokerclubos.example/…" invalid={!!error} data-autofocus dir="ltr" />
                </Field>
                <DemoSamples
                  label={t('join.samples')}
                  items={samples.map((c) => ({ key: c.id, label: c.name, onPick: () => setLink(api.inviteLink(c)) }))}
                />
                <div className="mt-4 flex justify-end">
                  <Button type="submit" variant="primary" disabled={!link.trim()} data-testid="join-find">
                    {t('join.find')}
                  </Button>
                </div>
              </form>
            )}
            {tab === 'id' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  lookup();
                }}
              >
                <Field label={t('join.id.label')} htmlFor="join-id" error={error} hint={t('join.id.hint')}>
                  <TextInput
                    id="join-id"
                    value={code}
                    onChange={(v) => setCode(v.replace(/[^\d ]/g, '').slice(0, 7))}
                    placeholder="000 000"
                    invalid={!!error}
                    inputMode="numeric"
                    autoComplete="off"
                    dir="ltr"
                    className="h-12 text-center text-[20px] font-semibold tracking-[0.2em] tabular-nums"
                    data-testid="join-id-input"
                  />
                </Field>
                <DemoSamples label={t('join.samples')} items={samples.map((c) => ({ key: c.id, label: `${codeFor(c)} · ${c.name}`, onPick: () => setCode(codeFor(c)) }))} />
                <div className="mt-4 flex justify-end">
                  <Button type="submit" variant="primary" disabled={code.replace(/\D/g, '').length !== 6} data-testid="join-find">
                    {t('join.find')}
                  </Button>
                </div>
              </form>
            )}
            {tab === 'qr' && (
              <div>
                <div className="relative mx-auto flex aspect-square w-full max-w-[220px] items-center justify-center overflow-hidden rounded-hero border border-line-strong bg-black">
                  <LuScanLine className={cx('size-16 text-white/25', scanning && 'animate-pulse text-accent')} aria-hidden />
                  {(['start-3 top-3 border-s-2 border-t-2', 'end-3 top-3 border-e-2 border-t-2', 'start-3 bottom-3 border-s-2 border-b-2', 'end-3 bottom-3 border-e-2 border-b-2'] as const).map((pos) => (
                    <span key={pos} className={cx('absolute size-6 rounded-[3px] border-accent', pos)} aria-hidden />
                  ))}
                  <p className="absolute inset-x-3 bottom-3 text-center text-[11.5px] text-white/60">{scanning ? t('join.qr.scanning') : t('join.qr.no_camera')}</p>
                </div>
                <p className="mt-4 text-[13px] text-ink-2">{t('join.qr.simulate')}</p>
                <div className="mt-2.5 grid grid-cols-3 gap-2.5">
                  {samples.map((c) => (
                    <button key={c.id} type="button" onClick={() => scan(c)} disabled={!!scanning} className="flex flex-col items-center gap-1.5 rounded-inner border border-line p-2.5 text-center hover:border-line-strong hover:bg-raised disabled:opacity-50" data-testid={`qr-${c.id}`}>
                      <SampleCode seed={Number(c.code)} size={64} />
                      <span className="line-clamp-2 text-[11.5px] leading-tight text-ink-2">{c.name}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-2.5 text-[12px] text-ink-3">{t('join.qr.sample_note')}</p>
              </div>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}

function DemoSamples({ label, items }: { label: string; items: { key: string; label: string; onPick: () => void }[] }) {
  return (
    <div className="mt-3">
      <p className="text-[12px] text-ink-3">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <button key={item.key} type="button" onClick={item.onPick} className="rounded-full border border-line-strong/70 bg-raised px-2.5 py-1 text-[12px] text-ink-2 tabular-nums hover:text-ink" dir="auto">
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
