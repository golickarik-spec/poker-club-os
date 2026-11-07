/**
 * Club console: leagues and seasons. A list with creation, and a detail page with live
 * standings, tournament assignment, season completion (freeze) and archive.
 */
import { useMemo, useState } from 'react';
import { LuArchive, LuArrowLeft, LuFlag, LuPencil, LuPlus, LuTrophy } from 'react-icons/lu';
import { act } from '../app/context.ts';
import { dateShort, dateTime, fromLocalInput, toLocalInput } from '../app/format.ts';
import { go, useDb, useMe, useNow, useT } from '../app/hooks.ts';
import * as comp from '../platform/competition.ts';
import { can } from '../platform/permissions.ts';
import { clubTournaments, scheduleOrder } from '../platform/selectors.ts';
import type { Club, League, LeagueScoringPreset, LeagueType } from '../platform/types.ts';
import { StandingsTable } from '../shared/competition.tsx';
import { dayLabel, StatusPill } from '../shared/tournament.tsx';
import { Badge, Button, cx, EmptyState, Notice, PageHeader, Panel, PanelHeader } from '../ui/core.tsx';
import { Checkbox, Field, NumberInput, Segmented, Select, Switch, TextArea, TextInput } from '../ui/forms.tsx';
import { Avatar } from '../ui/identity.tsx';
import { ConfirmDialog, Dialog } from '../ui/overlay.tsx';

const DAY = 86_400_000;

function emptyDraft(now: number): comp.LeagueDraft {
  return {
    name: '',
    description: '',
    type: 'monthly',
    startAt: now,
    endAt: now + 30 * DAY,
    scoring: comp.defaultScoring('position'),
    includeAll: true,
    tournamentIds: [],
    eligibility: 'all_members',
    memberIds: [],
    visibility: 'members',
    cover: { kind: 'pattern', pattern: 'deco' },
  };
}

function draftOfLeague(l: League): comp.LeagueDraft {
  return { name: l.name, description: l.description, type: l.type, startAt: l.startAt, endAt: l.endAt, scoring: { ...l.scoring }, includeAll: l.includeAll, tournamentIds: [...l.tournamentIds], eligibility: l.eligibility, memberIds: [...l.memberIds], visibility: l.visibility, cover: l.cover };
}

export function Leagues({ club }: { club: Club }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(60_000);
  const [creating, setCreating] = useState(false);
  const canCreate = can(db, me.id, 'tournaments.create', club.id);
  const leagues = db.leagues.filter((l) => l.clubId === club.id).sort((a, b) => b.startAt - a.startAt);
  const active = leagues.filter((l) => l.status === 'active' || l.status === 'draft');
  const past = leagues.filter((l) => l.status === 'completed' || l.status === 'archived');
  return (
    <>
      <PageHeader
        title={t('console.nav.leagues')}
        subtitle={t('league.console_subtitle')}
        actions={
          canCreate ? (
            <Button variant="primary" icon={<LuPlus className="size-4" aria-hidden />} onClick={() => setCreating(true)} data-testid="new-league">
              {t('league.new')}
            </Button>
          ) : undefined
        }
      />
      {leagues.length === 0 ? (
        <EmptyState
          icon={<LuTrophy />}
          title={t('league.console_empty_title')}
          body={t('league.console_empty_body')}
          action={
            canCreate ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                {t('league.new')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          <LeagueList title={t('league.active')} leagues={active} club={club} now={now} />
          {past.length > 0 && <LeagueList title={t('league.history')} leagues={past} club={club} now={now} />}
        </div>
      )}
      <LeagueDialog open={creating} onClose={() => setCreating(false)} club={club} />
    </>
  );
}

function LeagueList({ title, leagues, club, now }: { title: string; leagues: League[]; club: Club; now: number }) {
  const t = useT();
  const db = useDb();
  if (leagues.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2.5 text-[15px] font-semibold text-ink">{title}</h2>
      <Panel pad={false} className="overflow-hidden">
        <ul className="rows">
          {leagues.map((l) => {
            const rows = comp.leagueStandings(db, l);
            const leader = rows[0];
            const results = comp.leagueResults(db, l);
            const daysLeft = Math.ceil((l.endAt - now) / DAY);
            return (
              <li key={l.id}>
                <button type="button" onClick={() => go('console.league', { clubId: club.id, id: l.id })} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-start hover:bg-raised/40 sm:grid-cols-[minmax(0,1fr)_140px_140px_auto]" data-testid={`league-row-${l.id}`}>
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold text-ink">{l.name}</span>
                    <span className="block text-[12.5px] text-ink-3">
                      {t(`league.type.${l.type}`)} · {dateShort(l.startAt, t.lang)} – {dateShort(l.endAt, t.lang)}
                      {l.status === 'active' && daysLeft >= 0 ? ` · ${t('league.days_left', { n: daysLeft })}` : ''}
                    </span>
                  </span>
                  <span className="hidden text-[12.5px] text-ink-2 sm:block">
                    {t('league.tab.tournaments')}: <span className="font-medium text-ink">{results.length}</span> · {t('rankings.player').toLowerCase()}: <span className="font-medium text-ink">{rows.length}</span>
                  </span>
                  <span className="hidden min-w-0 items-center gap-2 text-[12.5px] text-ink-2 sm:flex">
                    {leader && (
                      <>
                        <Avatar user={leader} size={22} />
                        <span className="truncate">{leader.name}</span>
                      </>
                    )}
                  </span>
                  <Badge tone={l.status === 'active' ? 'success' : l.status === 'draft' ? 'warning' : 'neutral'}>{t(`league.status.${l.status}`)}</Badge>
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>
    </section>
  );
}

export function LeagueDetail({ club, leagueId }: { club: Club; leagueId: string }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const [editing, setEditing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const league = db.leagues.find((l) => l.id === leagueId && l.clubId === club.id);
  const canEdit = can(db, me.id, 'tournaments.edit', club.id);
  const tournaments = useMemo(() => clubTournaments(db, club.id).filter((x) => x.status !== 'DRAFT' && x.status !== 'CANCELLED').sort(scheduleOrder), [db, club.id]);
  if (!league) return <EmptyState icon={<LuTrophy />} title={t('league.not_found')} action={<Button onClick={() => go('console.leagues', { clubId: club.id })}>{t('console.nav.leagues')}</Button>} />;
  const rows = comp.leagueStandings(db, league);
  const results = comp.leagueResults(db, league);
  const frozen = league.status === 'completed' || league.status === 'archived';
  const counted = new Set(results.map((r) => r.tournamentId));
  return (
    <>
      <PageHeader
        title={league.name}
        subtitle={`${t(`league.type.${league.type}`)} · ${dateShort(league.startAt, t.lang)} – ${dateShort(league.endAt, t.lang)} · ${t('league.rules_version', { v: league.scoring.version })}`}
        back={
          <button type="button" onClick={() => go('console.leagues', { clubId: club.id })} className="mb-2 inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
            <LuArrowLeft className="size-4 flip-rtl" aria-hidden />
            {t('console.nav.leagues')}
          </button>
        }
        actions={
          <>
            <Badge tone={league.status === 'active' ? 'success' : 'neutral'} className="h-8 px-3 text-[12.5px]">
              {t(`league.status.${league.status}`)}
            </Badge>
            {canEdit && !frozen && (
              <Button icon={<LuPencil className="size-4" aria-hidden />} onClick={() => setEditing(true)} data-testid="league-edit">
                {t('common.edit')}
              </Button>
            )}
            {canEdit && league.status === 'active' && (
              <Button variant="primary" icon={<LuFlag className="size-4" aria-hidden />} onClick={() => setCompleting(true)} data-testid="league-complete">
                {t('league.complete')}
              </Button>
            )}
            {canEdit && league.status === 'completed' && (
              <Button icon={<LuArchive className="size-4" aria-hidden />} onClick={() => act(() => comp.archiveLeague(db, me.id, league.id), { key: 'league.archived' })} data-testid="league-archive">
                {t('league.archive')}
              </Button>
            )}
          </>
        }
      />
      {league.description && <p className="-mt-3 mb-4 max-w-[70ch] text-[13.5px] text-ink-2">{league.description}</p>}
      {frozen && <Notice tone="gold" icon={<LuTrophy />} className="mb-4">{t('league.frozen_note', { date: dateShort(league.completedAt ?? 0, t.lang) })}{league.championId ? ` ${t('league.champion')}: ${db.users[league.championId]?.name ?? '—'}.` : ''}</Notice>}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
        <Panel pad={false} className="overflow-hidden">
          <div className="border-b border-line/70 px-4 py-3">
            <PanelHeader title={t('league.tab.standings')} hint={t('league.standings_hint', { preset: t(`league.preset.${league.scoring.preset}`) })} className="mb-0" />
          </div>
          <StandingsTable rows={rows} meId={me.id} frozen={!!league.finalStandings} />
        </Panel>
        <Panel pad={false} className="overflow-hidden">
          <div className="border-b border-line/70 px-4 py-3">
            <PanelHeader title={t('league.tab.tournaments')} hint={league.includeAll ? t('league.counts_all') : t('league.counts_assigned', { n: league.tournamentIds.length })} className="mb-0" />
          </div>
          {tournaments.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-ink-3">{t('league.no_tournaments')}</p>
          ) : (
            <ul className="rows max-h-[520px] overflow-y-auto">
              {tournaments.map((x) => {
                const assigned = league.tournamentIds.includes(x.id);
                const counts = counted.has(x.id);
                const inWindow = x.completedAt !== null && x.completedAt >= league.startAt && x.completedAt <= league.endAt;
                return (
                  <li key={x.id} className="flex items-center gap-3 px-4 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{x.name}</span>
                      <span className="block text-[11.5px] text-ink-3">
                        {x.completedAt ? dateShort(x.completedAt, t.lang) : dayLabel(t, x.startAt, Date.now())} · {t(`variant.${x.game ?? 'nlhe'}`)}
                      </span>
                    </span>
                    <StatusPill status={x.status} />
                    {counts && <Badge tone="accent">{t('league.counted')}</Badge>}
                    {canEdit && !frozen && (
                      <Checkbox checked={assigned || (league.includeAll && inWindow)} onChange={(on) => act(() => comp.assignTournament(db, me.id, league.id, x.id, on))} label={<span className="sr-only">{x.name}</span>} id={`assign-${x.id}`} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
      <LeagueDialog open={editing} onClose={() => setEditing(false)} club={club} league={league} />
      <ConfirmDialog
        open={completing}
        onClose={() => setCompleting(false)}
        onConfirm={() => act(() => comp.completeLeague(db, me.id, league.id), { key: 'league.completed' })}
        title={t('league.complete_title')}
        body={t('league.complete_body', { leader: rows[0]?.name ?? '—' })}
        confirmLabel={t('league.complete')}
      />
    </>
  );
}

function LeagueDialog({ open, onClose, club, league }: { open: boolean; onClose: () => void; club: Club; league?: League }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const [draft, setDraft] = useState<comp.LeagueDraft>(() => (league ? draftOfLeague(league) : emptyDraft(Date.now())));
  const [tried, setTried] = useState(false);
  const patch = (p: Partial<comp.LeagueDraft>) => setDraft((d) => ({ ...d, ...p }));
  const problems = comp.validateLeague(draft);
  const members = db.memberships.filter((m) => m.clubId === club.id && m.status === 'active' && !db.users[m.userId]!.isBot).map((m) => db.users[m.userId]!);
  const setType = (type: LeagueType) => {
    const days = comp.LEAGUE_TYPE_DAYS[type];
    patch({ type, ...(days ? { endAt: draft.startAt + days * DAY } : {}) });
  };
  const save = () => {
    setTried(true);
    if (problems.length) return;
    const ok = act(() => (league ? comp.updateLeague(db, me.id, league.id, draft) : comp.createLeague(db, me.id, club.id, draft)), { key: league ? 'league.saved' : 'league.created', params: { name: draft.name.trim() } });
    if (ok) {
      onClose();
      if (!league) go('console.league', { clubId: club.id, id: ok.id });
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={league ? t('league.edit_title') : t('league.new')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={save} data-testid="league-save">
            {league ? t('common.save') : t('league.create')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('league.name')} htmlFor="lg-name" error={tried && problems.includes('name') ? t('league.problem.name') : null}>
          <TextInput id="lg-name" value={draft.name} onChange={(name) => patch({ name })} maxLength={60} placeholder={t('league.name_placeholder')} data-testid="league-name" />
        </Field>
        <Field label={t('wizard.description')} htmlFor="lg-desc" optional={t('wizard.optional')}>
          <TextArea id="lg-desc" value={draft.description} onChange={(description) => patch({ description })} rows={2} />
        </Field>
        <Field label={t('league.type_label')} htmlFor="lg-type">
          <Segmented<LeagueType> value={draft.type} onChange={setType} label={t('league.type_label')} size="sm" options={(['weekly', 'monthly', 'quarterly', 'annual', 'custom', 'series'] as const).map((v) => ({ value: v, label: t(`league.type.${v}`) }))} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('league.start')} htmlFor="lg-start" error={tried && problems.includes('dates') ? t('league.problem.dates') : null}>
            <TextInput id="lg-start" type="datetime-local" value={toLocalInput(draft.startAt)} onChange={(v) => { const ts = fromLocalInput(v); if (ts) patch({ startAt: ts }); }} />
          </Field>
          <Field label={t('league.end')} htmlFor="lg-end">
            <TextInput id="lg-end" type="datetime-local" value={toLocalInput(draft.endAt)} onChange={(v) => { const ts = fromLocalInput(v); if (ts) patch({ endAt: ts }); }} />
          </Field>
        </div>
        <fieldset className="rounded-inner border border-line p-3">
          <legend className="px-1 text-[12.5px] font-medium text-ink-2">{t('league.scoring')}</legend>
          <Select<LeagueScoringPreset> value={draft.scoring.preset} onChange={(preset) => patch({ scoring: { ...draft.scoring, preset } })} className="max-w-sm" data-testid="league-preset" options={(['position', 'performance', 'wins_and_tables'] as const).map((p) => ({ value: p, label: t(`league.preset.${p}`) }))} />
          <p className="mt-1.5 text-[12px] text-ink-3">{comp.SCORING_PRESETS[draft.scoring.preset].describe}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label={t('league.best_n')} htmlFor="lg-bestn" hint={t('league.best_n_hint')}>
              <NumberInput id="lg-bestn" value={draft.scoring.bestN} onChange={(bestN) => patch({ scoring: { ...draft.scoring, bestN } })} min={0} max={50} />
            </Field>
            <Field label={t('league.participation')} htmlFor="lg-part">
              <NumberInput id="lg-part" value={draft.scoring.participation} onChange={(participation) => patch({ scoring: { ...draft.scoring, participation } })} min={0} max={100} />
            </Field>
            <Field label={t('league.participation_cap')} htmlFor="lg-cap">
              <NumberInput id="lg-cap" value={draft.scoring.participationCap} onChange={(participationCap) => patch({ scoring: { ...draft.scoring, participationCap } })} min={0} max={100} />
            </Field>
          </div>
          {draft.scoring.preset !== 'performance' && <Switch checked={draft.scoring.fieldAdjusted} onChange={(fieldAdjusted) => patch({ scoring: { ...draft.scoring, fieldAdjusted } })} label={t('league.field_adjusted')} description={t('league.field_adjusted_hint')} id="lg-field" />}
          {league && <p className="mt-2 text-[12px] text-ink-3">{t('league.scoring_version_note')}</p>}
        </fieldset>
        <Switch checked={draft.includeAll} onChange={(includeAll) => patch({ includeAll })} label={t('league.counts_all')} description={t('league.counts_all_hint')} id="lg-all" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('league.eligible')} htmlFor="lg-elig">
            <Segmented<League['eligibility']> value={draft.eligibility} onChange={(eligibility) => patch({ eligibility })} label={t('league.eligible')} size="sm" options={[{ value: 'all_members', label: t('league.eligible_all') }, { value: 'selected', label: t('league.eligible_some') }]} />
          </Field>
          <Field label={t('wizard.visibility')} htmlFor="lg-vis">
            <Segmented<League['visibility']> value={draft.visibility} onChange={(visibility) => patch({ visibility })} label={t('wizard.visibility')} size="sm" options={[{ value: 'members', label: t('league.visibility.members') }, { value: 'public', label: t('league.visibility.public') }]} />
          </Field>
        </div>
        {draft.eligibility === 'selected' && (
          <div className={cx('max-h-48 space-y-1 overflow-y-auto rounded-inner border p-2', tried && problems.includes('members') ? 'border-danger' : 'border-line')}>
            {members.map((u) => (
              <Checkbox key={u.id} id={`lg-m-${u.id}`} checked={draft.memberIds.includes(u.id)} onChange={(on) => patch({ memberIds: on ? [...draft.memberIds, u.id] : draft.memberIds.filter((x) => x !== u.id) })} label={u.name} />
            ))}
            {members.length === 0 && <p className="text-[12.5px] text-ink-3">{t('league.no_members')}</p>}
          </div>
        )}
        {tried && problems.length > 0 && (
          <Notice tone="danger">
            {problems.map((p) => t(`league.problem.${p}`)).join(' ')}
          </Notice>
        )}
        <p className="text-[12px] text-ink-3">{t('league.dates_note', { tz: club.timezone, now: dateTime(Date.now(), t.lang) })}</p>
      </div>
    </Dialog>
  );
}

