import { useState } from 'react';
import { LuCalendarPlus, LuCopy, LuEllipsis, LuPencil, LuSettings2, LuTrash2, LuTrophy } from 'react-icons/lu';
import { act } from '../app/context.ts';
import { chips, dateTime, durationLabel, relativeTime } from '../app/format.ts';
import { go, useDb, useMe, useNow, useT } from '../app/hooks.ts';
import { estimateDurationMinutes, PRESET_OPTIONS, presetStructure, type PresetId } from '../engine/structure.ts';
import * as api from '../platform/api.ts';
import { isEditable, isLive, isUpcoming } from '../platform/lifecycle.ts';
import { can } from '../platform/permissions.ts';
import { clubTournaments, scheduleOrder } from '../platform/selectors.ts';
import type { Club, Tournament } from '../platform/types.ts';
import { presetLabel, StatusPill, structureSummary, useLiveBrief } from '../shared/tournament.tsx';
import { Button, EmptyState, PageHeader, Panel } from '../ui/core.tsx';
import { ConfirmDialog, Menu, MenuItem, Tabs } from '../ui/overlay.tsx';
import { TableShell, Td, Th } from './shared.tsx';
import { RecurringTab } from './Recurring.tsx';
import * as sch from '../platform/scheduling.ts';

type Tab = 'current' | 'drafts' | 'archive' | 'presets' | 'recurring';

export function ConsoleTournaments({ club }: { club: Club }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(30_000);
  const [tab, setTab] = useState<Tab>('current');
  const [deleting, setDeleting] = useState<Tournament | null>(null);
  const all = clubTournaments(db, club.id).sort(scheduleOrder);
  const current = all.filter((x) => isLive(x.status) || isUpcoming(x.status));
  const drafts = all.filter((x) => x.status === 'DRAFT');
  const archive = all.filter((x) => x.status === 'COMPLETED' || x.status === 'CANCELLED');
  const canCreate = can(db, me.id, 'tournaments.create', club.id);
  const canEdit = can(db, me.id, 'tournaments.edit', club.id);
  const list = tab === 'current' ? current : tab === 'drafts' ? drafts : archive;

  const duplicate = (x: Tournament) => {
    const copy = act(() => api.duplicateTournament(db, me.id, x.id), { key: 'console.tournaments.duplicated' });
    if (copy) go('console.wizard', { clubId: club.id, id: copy.id });
  };

  return (
    <>
      <PageHeader
        title={t('console.tournaments.title')}
        subtitle={t('console.tournaments.subtitle')}
        actions={
          canCreate ? (
            <Button variant="primary" icon={<LuCalendarPlus className="size-4" aria-hidden />} onClick={() => go('console.wizard', { clubId: club.id })} data-testid="new-tournament">
              {t('console.tournaments.new')}
            </Button>
          ) : undefined
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        label={t('console.tournaments.title')}
        tabs={[
          { value: 'current', label: t('console.tournaments.tab.current'), count: current.length },
          { value: 'drafts', label: t('console.tournaments.tab.drafts'), count: drafts.length },
          { value: 'archive', label: t('console.tournaments.tab.archive') },
          { value: 'presets', label: t('console.tournaments.tab.presets') },
          { value: 'recurring', label: t('console.tournaments.tab.recurring'), count: sch.listSchedules(db, club.id).length || undefined },
        ]}
      />
      <div className="pt-4">
        {tab === 'recurring' ? (
          <RecurringTab club={club} />
        ) : tab === 'presets' ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {(['turbo', 'regular', 'deep', 'sng'] as const).map((preset) => (
              <PresetCard key={preset} preset={preset} onUse={canCreate ? () => go('console.wizard', { clubId: club.id, preset }) : undefined} />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<LuTrophy />}
            title={t(`console.tournaments.empty.${tab}.title`)}
            body={t(`console.tournaments.empty.${tab}.body`)}
            action={
              canCreate && tab !== 'archive' ? (
                <Button variant="primary" onClick={() => go('console.wizard', { clubId: club.id })}>
                  {t('console.tournaments.new')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Panel pad={false}>
            <TableShell minWidth={720}>
              <thead>
                <tr>
                  <Th>{t('console.tournaments.col.name')}</Th>
                  <Th>{t('common.status')}</Th>
                  <Th>{tab === 'archive' ? t('console.tournaments.col.finished') : t('console.tournaments.col.start')}</Th>
                  <Th end>{t('console.tournaments.col.players')}</Th>
                  <Th end>{t('lobby.entry')}</Th>
                  <Th end>
                    <span className="sr-only">{t('common.actions')}</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {list.map((x) => (
                  <Row
                    key={x.id}
                    x={x}
                    now={now}
                    onOpen={() => go('console.tournament', { clubId: club.id, id: x.id })}
                    onEdit={canEdit && isEditable(x.status) ? () => go('console.wizard', { clubId: club.id, id: x.id }) : undefined}
                    onDuplicate={canCreate ? () => duplicate(x) : undefined}
                    onDelete={canEdit && x.status === 'DRAFT' ? () => setDeleting(x) : undefined}
                  />
                ))}
              </tbody>
            </TableShell>
          </Panel>
        )}
      </div>
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && act(() => api.deleteDraft(db, me.id, deleting.id), { key: 'console.tournaments.draft_deleted' })}
        title={t('console.tournaments.delete_title')}
        body={t('console.tournaments.delete_body', { name: deleting?.name ?? '' })}
        confirmLabel={t('common.delete')}
        danger
      />
    </>
  );
}

function Row({ x, now, onOpen, onEdit, onDuplicate, onDelete }: { x: Tournament; now: number; onOpen: () => void; onEdit?: () => void; onDuplicate?: () => void; onDelete?: () => void }) {
  const t = useT();
  const brief = useLiveBrief(x.id);
  const finished = x.status === 'COMPLETED' || x.status === 'CANCELLED';
  return (
    <tr className="border-b border-line last:border-0 hover:bg-raised/40" data-testid={`trow-${x.id}`}>
      <Td>
        <button type="button" onClick={onOpen} className="block max-w-[320px] text-start">
          <span className="block truncate font-medium text-ink hover:underline">{x.name}</span>
          <span className="block truncate text-[12px] text-ink-3">
            {presetLabel(t, x)} · {structureSummary(t, x.structure)}
          </span>
        </button>
      </Td>
      <Td>
        <StatusPill status={x.status} lateReg={brief?.lateReg} />
      </Td>
      <Td className="whitespace-nowrap text-ink-2 tabular-nums">
        {finished ? (
          dateTime(x.completedAt ?? x.startAt, t.lang)
        ) : brief ? (
          t('console.row.live_short', { level: brief.level })
        ) : x.startMode === 'when_full' ? (
          t('tour.when_full')
        ) : x.startMode === 'manual' ? (
          t('lobby.start_manual')
        ) : (
          <>
            {dateTime(x.startAt, t.lang)} <span className="text-ink-3">· {relativeTime(x.startAt, now, t.lang)}</span>
          </>
        )}
      </Td>
      <Td end className="text-ink tabular-nums">
        {brief ? `${brief.left} / ${brief.entrants}` : `${api.registeredCount(x)} / ${x.maxPlayers}`}
        {api.requestedCount(x) > 0 && <span className="ms-1.5 text-warning">+{api.requestedCount(x)}</span>}
      </Td>
      <Td end className="text-ink-2 tabular-nums">
        {x.entryPoints > 0 ? chips(x.entryPoints) : '—'}
      </Td>
      <Td end>
        <span className="inline-flex items-center gap-1">
          <Button size="sm" onClick={onOpen} icon={<LuSettings2 className="size-3.5" aria-hidden />} data-testid="manage">
            {finished ? t('tour.results') : t('console.tournaments.manage')}
          </Button>
          {(onEdit || onDuplicate || onDelete) && (
            <Menu
              trigger={(p) => (
                <button type="button" {...p} aria-label={t('common.actions')} className="inline-flex size-8 items-center justify-center rounded-control text-ink-2 hover:bg-raised hover:text-ink">
                  <LuEllipsis className="size-4" aria-hidden />
                </button>
              )}
              width="w-48"
            >
              {(close) => (
                <>
                  {onEdit && (
                    <MenuItem icon={<LuPencil />} onClick={() => (close(), onEdit())}>
                      {t('common.edit')}
                    </MenuItem>
                  )}
                  {onDuplicate && (
                    <MenuItem icon={<LuCopy />} onClick={() => (close(), onDuplicate())}>
                      {t('console.tournaments.duplicate')}
                    </MenuItem>
                  )}
                  {onDelete && (
                    <MenuItem icon={<LuTrash2 />} tone="danger" onClick={() => (close(), onDelete())}>
                      {t('console.tournaments.delete_draft')}
                    </MenuItem>
                  )}
                </>
              )}
            </Menu>
          )}
        </span>
      </Td>
    </tr>
  );
}

export function PresetCard({ preset, onUse, selected }: { preset: Exclude<PresetId, 'custom'>; onUse?: () => void; selected?: boolean }) {
  const t = useT();
  const o = PRESET_OPTIONS[preset];
  const structure = presetStructure(preset);
  const players = preset === 'sng' ? 6 : 45;
  const minutes = estimateDurationMinutes(structure, players);
  const first = structure.entries[0];
  return (
    <div className={`flex flex-col rounded-panel border bg-surface p-4 ${selected ? 'border-accent ring-1 ring-accent' : 'border-line'}`}>
      <h3 className="text-[15px] font-semibold text-ink">{t(`preset.${preset}`)}</h3>
      <p className="mt-1 min-h-[2.6em] text-[13px] leading-snug text-ink-2">{t(`preset.${preset}.about`)}</p>
      <dl className="mt-3 space-y-1.5 text-[12.5px] tabular-nums">
        <PresetFact label={t('lobby.starting_stack')} value={chips(o.startingStack)} />
        <PresetFact label={t('lobby.fact.levels')} value={t('structure.minutes', { n: o.levelMinutes })} />
        <PresetFact label={t('wizard.first_level')} value={first && first.kind === 'level' ? `${first.sb}/${first.bb}` : '—'} />
        <PresetFact label={t('lobby.fact.table_size')} value={t('lobby.seats_n', { n: o.tableSize })} />
        <PresetFact label={t('wizard.estimate_for', { n: players })} value={minutes ? `~${durationLabel(minutes, t.lang)}` : '—'} />
      </dl>
      {onUse && (
        <Button className="mt-4" full onClick={onUse} data-testid={`preset-${preset}`}>
          {t('console.tournaments.use_preset')}
        </Button>
      )}
    </div>
  );
}

function PresetFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-end font-medium text-ink" dir="auto">
        {value}
      </dd>
    </div>
  );
}
