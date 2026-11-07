/** Templates and recurring schedules tab (v0.4) of the console's tournaments page. */
import { useState } from 'react';
import { LuCalendarClock, LuCalendarPlus, LuPause, LuPlay, LuPlus, LuTrash2 } from 'react-icons/lu';
import { act } from '../app/context.ts';
import { dateTimeIn } from '../app/format.ts';
import { go, useDb, useMe, useNow, useT } from '../app/hooks.ts';
import { can } from '../platform/permissions.ts';
import * as sch from '../platform/scheduling.ts';
import type { Club, RecurringSchedule } from '../platform/types.ts';
import { gameShort } from '../shared/tournament.tsx';
import { WEEKDAYS } from '../shared/weekdays.ts';
import { Badge, Button, cx, EmptyState, Notice, Panel, PanelHeader } from '../ui/core.tsx';
import { Field, NumberInput, Select, TextInput } from '../ui/forms.tsx';
import { ConfirmDialog, Dialog } from '../ui/overlay.tsx';

export function RecurringTab({ club }: { club: Club }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(60_000);
  const canCreate = can(db, me.id, 'tournaments.create', club.id);
  const templates = sch.listTemplates(db, club.id);
  const schedules = sch.listSchedules(db, club.id);
  const [editing, setEditing] = useState<RecurringSchedule | 'new' | null>(null);
  const [deleting, setDeleting] = useState<{ kind: 'template' | 'schedule'; id: string; name: string } | null>(null);
  const timeLabel = (s: RecurringSchedule) => `${s.weekdays.map((d) => WEEKDAYS[t.lang][d]).join(', ')} · ${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
  return (
    <div className="grid gap-4 xl:grid-cols-2" data-testid="recurring-tab">
      <Panel pad={false} className="overflow-hidden">
        <PanelHeader title={t('recurring.templates')} hint={t('recurring.templates_hint')} className="px-4 pt-4 sm:px-5" />
        {templates.length === 0 ? (
          <EmptyState icon={<LuCalendarPlus />} title={t('recurring.no_templates')} body={t('recurring.no_templates_body')} className="py-8" />
        ) : (
          <ul className="rows" data-testid="template-list">
            {templates.map((x) => (
              <li key={x.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5" data-testid={`template-${x.id}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">{x.name}</span>
                  <span className="block truncate text-[12px] text-ink-3">
                    {x.draft.name} · {gameShort(x.draft.game)} · {t(`preset.${x.draft.preset}`)} · {x.draft.structure.startingStack.toLocaleString('en-US')}
                  </span>
                </span>
                {canCreate && (
                  <>
                    <Button size="sm" onClick={() => go('console.wizard', { clubId: club.id, template: x.id })} data-testid={`template-use-${x.id}`}>
                      {t('recurring.use_template')}
                    </Button>
                    <button type="button" aria-label={t('common.delete')} title={t('common.delete')} className="inline-flex size-8 items-center justify-center rounded-control text-ink-3 hover:bg-raised hover:text-danger" onClick={() => setDeleting({ kind: 'template', id: x.id, name: x.name })}>
                      <LuTrash2 className="size-4" aria-hidden />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel pad={false} className="overflow-hidden">
        <PanelHeader
          title={t('recurring.schedules')}
          hint={t('recurring.schedules_hint', { tz: club.timezone })}
          className="px-4 pt-4 sm:px-5"
          action={
            canCreate ? (
              <Button size="sm" variant="primary" icon={<LuPlus className="size-3.5" aria-hidden />} onClick={() => setEditing('new')} disabled={templates.length === 0} data-testid="new-schedule">
                {t('recurring.new_schedule')}
              </Button>
            ) : undefined
          }
        />
        {schedules.length === 0 ? (
          <EmptyState icon={<LuCalendarClock />} title={t('recurring.no_schedules')} body={templates.length === 0 ? t('recurring.need_template') : t('recurring.no_schedules_body')} className="py-8" />
        ) : (
          <ul className="rows" data-testid="schedule-list">
            {schedules.map((s) => {
              const made = sch.scheduleTournaments(db, s.id);
              const upcoming = made.filter((x) => x.startAt > now);
              const next = sch.occurrences(s, now, s.leadDays + 7)[0];
              const tpl = db.templates.find((x) => x.id === s.templateId);
              return (
                <li key={s.id} className="px-4 py-3 sm:px-5" data-testid={`schedule-${s.id}`}>
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13.5px] font-medium text-ink">{s.name}</span>
                        <Badge tone={s.enabled ? 'success' : 'neutral'}>{t(s.enabled ? 'recurring.active' : 'recurring.paused')}</Badge>
                      </span>
                      <span className="block truncate text-[12px] text-ink-3">
                        {timeLabel(s)} · {tpl?.name ?? '—'} · {t('recurring.lead', { n: s.leadDays })}
                      </span>
                    </span>
                    {canCreate && (
                      <span className="flex gap-1">
                        <button type="button" aria-label={t(s.enabled ? 'recurring.pause' : 'recurring.resume')} title={t(s.enabled ? 'recurring.pause' : 'recurring.resume')} className="inline-flex size-8 items-center justify-center rounded-control text-ink-3 hover:bg-raised hover:text-ink" onClick={() => act(() => sch.setScheduleEnabled(db, me.id, club.id, s.id, !s.enabled), { key: s.enabled ? 'recurring.paused_toast' : 'recurring.resumed_toast' })} data-testid={`schedule-toggle-${s.id}`}>
                          {s.enabled ? <LuPause className="size-4" aria-hidden /> : <LuPlay className="size-4" aria-hidden />}
                        </button>
                        <button type="button" aria-label={t('common.edit')} title={t('common.edit')} className="inline-flex h-8 items-center rounded-control px-2 text-[12.5px] text-ink-2 hover:bg-raised hover:text-ink" onClick={() => setEditing(s)}>
                          {t('common.edit')}
                        </button>
                        <button type="button" aria-label={t('common.delete')} title={t('common.delete')} className="inline-flex size-8 items-center justify-center rounded-control text-ink-3 hover:bg-raised hover:text-danger" onClick={() => setDeleting({ kind: 'schedule', id: s.id, name: s.name })}>
                          <LuTrash2 className="size-4" aria-hidden />
                        </button>
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-[12.5px] text-ink-2">
                    {t('recurring.published_n', { n: made.length, upcoming: upcoming.length })}
                    {s.enabled && next ? ` · ${t('recurring.next', { when: dateTimeIn(next, t.lang, s.timezone) })}` : ''}
                  </p>
                  {upcoming.length > 0 && (
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {upcoming.slice(0, 4).map((x) => (
                        <li key={x.id}>
                          <button type="button" onClick={() => go('console.tournament', { clubId: club.id, id: x.id })} className="rounded-chip bg-raised px-2 py-0.5 text-[12px] text-ink-2 hover:text-ink">
                            {dateTimeIn(x.startAt, t.lang, s.timezone)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <Notice tone="neutral" className="m-4">
          {t('recurring.note')}
        </Notice>
      </Panel>
      {editing && <ScheduleDialog club={club} existing={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && act(() => (deleting.kind === 'template' ? sch.deleteTemplate(db, me.id, club.id, deleting.id) : sch.deleteSchedule(db, me.id, club.id, deleting.id)), { key: deleting.kind === 'template' ? 'recurring.template_deleted' : 'recurring.schedule_deleted' })}
        title={t('recurring.delete_title', { name: deleting?.name ?? '' })}
        body={t(deleting?.kind === 'template' ? 'recurring.delete_template_body' : 'recurring.delete_schedule_body')}
        confirmLabel={t('common.delete')}
        danger
      />
    </div>
  );
}

function ScheduleDialog({ club, existing, onClose }: { club: Club; existing: RecurringSchedule | null; onClose: () => void }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const templates = sch.listTemplates(db, club.id);
  const [name, setName] = useState(existing?.name ?? '');
  const [templateId, setTemplateId] = useState(existing?.templateId ?? templates[0]?.id ?? '');
  const [weekdays, setWeekdays] = useState<number[]>(existing?.weekdays ?? [4]);
  const [hour, setHour] = useState(existing?.hour ?? 20);
  const [minute, setMinute] = useState(existing?.minute ?? 0);
  const [leadDays, setLeadDays] = useState(existing?.leadDays ?? 7);
  const preview = sch.occurrences({ weekdays, hour, minute, timezone: club.timezone }, Date.now(), 14).slice(0, 4);
  const submit = () => {
    const input = { name, templateId, weekdays, hour, minute, leadDays };
    const ok = act(() => (existing ? sch.updateSchedule(db, me.id, club.id, existing.id, input) : sch.createSchedule(db, me.id, club.id, input)), { key: existing ? 'recurring.schedule_saved' : 'recurring.schedule_created' });
    if (ok) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={existing ? t('recurring.edit_schedule') : t('recurring.new_schedule')}
      description={t('recurring.dialog_hint', { tz: club.timezone })}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} data-testid="schedule-save">
            {existing ? t('common.save') : t('recurring.create')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('recurring.name')} htmlFor="rs-name">
          <TextInput id="rs-name" value={name} onChange={setName} placeholder={t('recurring.name_placeholder')} maxLength={60} data-testid="schedule-name" />
        </Field>
        <Field label={t('recurring.template')} htmlFor="rs-template">
          <Select id="rs-template" value={templateId} onChange={setTemplateId} options={templates.map((x) => ({ value: x.id, label: x.name }))} />
        </Field>
        <Field label={t('recurring.weekdays')}>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('recurring.weekdays')}>
            {WEEKDAYS[t.lang].map((label, d) => (
              <button key={d} type="button" aria-pressed={weekdays.includes(d)} onClick={() => setWeekdays(weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d].sort())} className={cx('h-9 min-w-[44px] rounded-control border px-2 text-[13px]', weekdays.includes(d) ? 'border-accent bg-accent/15 text-ink' : 'border-line text-ink-2 hover:border-line-strong')} data-testid={`schedule-day-${d}`}>
                {label}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('recurring.hour')} htmlFor="rs-hour">
            <NumberInput id="rs-hour" value={hour} onChange={setHour} min={0} max={23} />
          </Field>
          <Field label={t('recurring.minute')} htmlFor="rs-minute">
            <NumberInput id="rs-minute" value={minute} onChange={setMinute} min={0} max={59} step={5} />
          </Field>
          <Field label={t('recurring.lead_days')} htmlFor="rs-lead" hint={t('recurring.lead_hint')}>
            <NumberInput id="rs-lead" value={leadDays} onChange={setLeadDays} min={1} max={14} />
          </Field>
        </div>
        {preview.length > 0 && (
          <p className="text-[12.5px] text-ink-2" data-testid="schedule-preview">
            {t('recurring.preview')}: {preview.map((ts) => dateTimeIn(ts, t.lang, club.timezone)).join(' · ')}
          </p>
        )}
      </div>
    </Dialog>
  );
}
