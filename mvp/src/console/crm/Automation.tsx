import { useState } from 'react';
import { LuAlarmClock, LuCircleAlert, LuCircleCheck, LuHandshake, LuMegaphone, LuMoonStar, LuPlay, LuUserPlus } from 'react-icons/lu';
import { act } from '../../app/context.ts';
import { dateTime, relativeTime } from '../../app/format.ts';
import { useDb, useMe, useNow, useT } from '../../app/hooks.ts';
import * as automation from '../../platform/automation.ts';
import type { RuleView } from '../../platform/automation.ts';
import { can } from '../../platform/permissions.ts';
import type { AutomationKey, AutomationRun, Club } from '../../platform/types.ts';
import { Badge, Button, cx, Notice, PageHeader, Panel, PanelHeader } from '../../ui/core.tsx';
import { Field, NumberInput, Switch, TextArea } from '../../ui/forms.tsx';
import { TableShell, Td, Th } from '../shared.tsx';
import { useReport } from './shared.tsx';

const ICONS: Record<AutomationKey, typeof LuAlarmClock> = { welcome: LuHandshake, reminder: LuAlarmClock, new_tournament: LuMegaphone, membership_request: LuUserPlus, inactive: LuMoonStar };

function RuleCard({ club, rule, editable }: { club: Club; rule: RuleView; editable: boolean }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(30_000);
  const [message, setMessage] = useState(rule.message);
  const [minutes, setMinutes] = useState(rule.minutesBefore);
  const [days, setDays] = useState(rule.inactiveDays);
  const preview = useReport(() => automation.previewRule(db, me.id, club.id, rule.key), [club.id, me.id, rule.key]);
  const Icon = ICONS[rule.key];
  const dirty = (rule.key === 'welcome' && message !== rule.message) || (rule.key === 'reminder' && minutes !== rule.minutesBefore) || (rule.key === 'inactive' && days !== rule.inactiveDays);
  const save = () => act(() => automation.updateRule(db, me.id, club.id, rule.key, rule.key === 'welcome' ? { message } : rule.key === 'reminder' ? { minutesBefore: minutes } : { inactiveDays: days }), { key: 'crm.toast.rule_saved' });

  return (
    <Panel className={cx('flex flex-col', !rule.enabled && 'opacity-80')} data-testid={`rule-${rule.key}`}>
      <div className="flex items-start gap-3">
        <span className={cx('flex size-9 shrink-0 items-center justify-center rounded-full', rule.enabled ? 'bg-accent/15 text-accent' : 'bg-raised text-ink-3')}>
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <Switch
            checked={rule.enabled}
            disabled={!editable}
            onChange={(enabled) => act(() => automation.updateRule(db, me.id, club.id, rule.key, { enabled }), { key: enabled ? 'crm.toast.rule_on' : 'crm.toast.rule_off' })}
            label={t(`crm.automation.${rule.key}.title`)}
            description={t(`crm.automation.${rule.key}.body`)}
            id={`rule-switch-${rule.key}`}
          />
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {rule.key === 'welcome' && (
          <Field label={t('crm.automation.welcome.message')} htmlFor="rule-welcome-text" hint={`${message.length}/600`}>
            <TextArea id="rule-welcome-text" value={message} onChange={(v) => setMessage(v.slice(0, 600))} rows={3} />
          </Field>
        )}
        {rule.key === 'reminder' && (
          <Field label={t('crm.automation.reminder.minutes')} htmlFor="rule-reminder-min">
            <NumberInput id="rule-reminder-min" value={minutes} onChange={setMinutes} min={1} max={180} stepper className="max-w-[200px]" suffix={t('crm.automation.minutes_suffix')} />
          </Field>
        )}
        {rule.key === 'inactive' && (
          <Field label={t('crm.automation.inactive.days')} htmlFor="rule-inactive-days" hint={t('crm.automation.inactive.days_hint')}>
            <NumberInput id="rule-inactive-days" value={days} onChange={setDays} min={1} max={730} stepper className="max-w-[200px]" suffix={t('crm.rule.days_suffix')} />
          </Field>
        )}
        {editable && dirty && (
          <Button size="sm" variant="primary" onClick={save} data-testid={`rule-save-${rule.key}`}>
            {t('common.save')}
          </Button>
        )}
      </div>

      <dl className="mt-4 grid gap-3 border-t border-line pt-3 text-[13px] sm:grid-cols-2">
        <div>
          <dt className="text-[12px] text-ink-3">{t(`crm.automation.${rule.key}.audience`)}</dt>
          <dd className="mt-0.5 text-ink" data-testid={`rule-audience-${rule.key}`}>
            {rule.key === 'reminder' && !preview.tournament ? t('crm.automation.reminder.none') : t.n('crm.automation.people', preview.audience)}
            {preview.tournament && <span className="block text-[12px] text-ink-3">{t('crm.automation.reminder.next', { name: preview.tournament.name, when: dateTime(preview.tournament.startAt, t.lang) })}</span>}
            {preview.sample.length > 0 && <span className="block truncate text-[12px] text-ink-3">{preview.sample.join(', ')}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-[12px] text-ink-3">{t('crm.automation.last_run')}</dt>
          <dd className="mt-0.5 text-ink">
            {rule.lastRun ? (
              <>
                {relativeTime(rule.lastRun.at, now, t.lang)}
                <span className="block text-[12px] text-ink-3">{t.n('crm.automation.runs', rule.runs)}</span>
              </>
            ) : (
              t('crm.automation.never')
            )}
          </dd>
        </div>
      </dl>
      {rule.key === 'inactive' && editable && (
        <Button size="sm" className="mt-3 self-start" icon={<LuPlay className="size-3.5" aria-hidden />} disabled={!rule.enabled} onClick={() => act(() => automation.runInactiveNow(db, me.id, club.id), { key: 'crm.toast.rule_ran' })} data-testid="rule-run-inactive">
          {t('crm.automation.run_now')}
        </Button>
      )}
    </Panel>
  );
}

function runDetail(t: ReturnType<typeof useT>, run: AutomationRun): string {
  if (run.status === 'error') return run.detail;
  if (run.detail.startsWith('cleared:')) return t('crm.automation.detail.cleared', { n: run.detail.slice(8) });
  if (run.detail === 'blocked_by_player') return t('crm.automation.detail.blocked');
  if (run.detail === 'empty_message') return t('crm.automation.detail.empty');
  return '';
}

/** The club's five automations: switch them on or off, change their settings, and see every time they ran. */
export function Automation({ club }: { club: Club }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const editable = can(db, me.id, 'crm.configure', club.id);
  const data = useReport(() => ({ rules: automation.listRules(db, me.id, club.id), runs: automation.listRuns(db, me.id, club.id) }), [club.id, me.id]);
  return (
    <div data-testid="crm-automation">
      <PageHeader title={t('crm.automation.title')} subtitle={t('crm.automation.subtitle')} />
      {!editable && (
        <Notice tone="neutral" className="mb-4">
          {t('crm.automation.read_only')}
        </Notice>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {data.rules.map((rule) => (
          <RuleCard key={`${rule.key}:${rule.updatedAt}`} club={club} rule={rule} editable={editable} />
        ))}
      </div>

      <Panel pad={false} className="mt-5">
        <PanelHeader title={t('crm.automation.history')} hint={t('crm.automation.history_hint')} className="px-4 pt-4 sm:px-5" />
        {data.runs.length === 0 ? (
          <p className="px-4 pb-4 text-[13px] text-ink-3 sm:px-5">{t('crm.automation.no_runs')}</p>
        ) : (
          <TableShell minWidth={760}>
            <thead>
              <tr>
                <Th>{t('crm.automation.col.when')}</Th>
                <Th>{t('crm.automation.col.rule')}</Th>
                <Th>{t('crm.automation.col.trigger')}</Th>
                <Th end>{t('crm.automation.col.targets')}</Th>
                <Th end>{t('crm.automation.col.done')}</Th>
                <Th end>{t('crm.automation.col.skipped')}</Th>
                <Th>{t('crm.automation.col.result')}</Th>
              </tr>
            </thead>
            <tbody data-testid="automation-runs">
              {data.runs.slice(0, 40).map((run) => (
                <tr key={run.id} className="border-t border-line" data-rule={run.key}>
                  <Td className="whitespace-nowrap text-ink-2">{dateTime(run.at, t.lang)}</Td>
                  <Td className="whitespace-nowrap text-ink">{t(`crm.automation.${run.key}.title`)}</Td>
                  <Td className="max-w-[280px] truncate text-ink-2">{t(run.trigger.key, run.trigger.params)}</Td>
                  <Td end className="tabular-nums">
                    {run.targets}
                  </Td>
                  <Td end className="tabular-nums">
                    {run.delivered}
                  </Td>
                  <Td end className="tabular-nums">
                    {run.skipped}
                  </Td>
                  <Td>
                    <span className="flex items-center gap-2">
                      <Badge tone={run.status === 'ok' ? 'success' : run.status === 'error' ? 'danger' : 'neutral'}>
                        {run.status === 'ok' ? <LuCircleCheck className="size-3" aria-hidden /> : run.status === 'error' ? <LuCircleAlert className="size-3" aria-hidden /> : null}
                        {t(`crm.automation.status.${run.status}`)}
                      </Badge>
                      <span className="truncate text-[12px] text-ink-3">{runDetail(t, run)}</span>
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
        <p className="border-t border-line px-4 py-2.5 text-[12px] leading-snug text-ink-3 sm:px-5">{t('crm.automation.prototype_note')}</p>
      </Panel>
    </div>
  );
}
