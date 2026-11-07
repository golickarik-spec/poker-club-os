/**
 * Integrity review queue (v0.4). Cases are derived from the demo's SIMULATED tournament history
 * by `platform/integrity.ts` and persisted; a person reviews each one. Used by the platform
 * console (every club) and by a club console (its own cases) through `clubId`.
 */
import { useState } from 'react';
import { LuEye, LuRefreshCw, LuShieldCheck } from 'react-icons/lu';
import { act } from '../app/context.ts';
import { dateTime } from '../app/format.ts';
import { go, useDb, useMe, useT } from '../app/hooks.ts';
import * as integrity from '../platform/integrity.ts';
import type { IntegrityCase, IntegrityStatus } from '../platform/types.ts';
import { Badge, BotTag, Button, cx, DemoTag, Notice, PageHeader, Panel, PanelHeader, type Tone } from '../ui/core.tsx';
import { TextArea } from '../ui/forms.tsx';
import { Avatar } from '../ui/identity.tsx';
import { Dialog } from '../ui/overlay.tsx';

const STATUS_TONE: Record<IntegrityStatus, Tone> = { new: 'warning', reviewing: 'info', cleared: 'success', escalated: 'danger' };

export function Integrity({ clubId = null }: { clubId?: string | null }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const cases = integrity.listCases(db, me.id, clubId);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const open = cases.find((c) => c.id === openId) ?? null;
  const setStatus = (c: IntegrityCase, status: IntegrityStatus) => {
    if (act(() => integrity.setCaseStatus(db, me.id, c.id, status, note), { key: 'integrity.status_saved' }) !== undefined) setNote('');
  };
  const rescan = () => act(() => integrity.runScan(db, me.id, clubId), { key: 'integrity.scanned' });

  return (
    <div data-testid="integrity">
      <PageHeader
        title={t('integrity.title')}
        subtitle={t('integrity.subtitle')}
        actions={
          <Button icon={<LuRefreshCw className="size-4" aria-hidden />} onClick={rescan} data-testid="integrity-scan">
            {t('integrity.scan')}
          </Button>
        }
      />
      <Notice tone="warning" icon={<LuShieldCheck />} className="mb-5">
        <p className="font-medium">{t('integrity.preview_title')}</p>
        <p className="mt-0.5 text-ink-2">{t('integrity.preview_body')}</p>
      </Notice>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel pad={false}>
          {cases.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-ink-3">{t('integrity.empty')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {cases.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setOpenId(c.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-start hover:bg-raised/50 sm:px-5" data-testid="integrity-case">
                    <span className="w-[70px] shrink-0 text-[12.5px] text-ink-3 tabular-nums" dir="ltr">
                      {c.id}
                    </span>
                    <span className="flex shrink-0 -space-x-2 rtl:space-x-reverse">
                      {c.accounts.map((id) => (
                        <Avatar key={id} user={db.users[id] ?? { name: '?', hue: 0 }} size={30} ring />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1 basis-[200px]">
                      <span className="block truncate text-[14px] font-medium text-ink">{c.accounts.map((id) => db.users[id]?.name ?? id).join(', ')}</span>
                      <span className="block truncate text-[12.5px] text-ink-3">
                        {clubId ? '' : `${db.clubs[c.clubId]?.name} · `}
                        {c.signals.map((s) => t(`integrity.signal.${s.type}`)).join(' + ')} · {t('integrity.shared_n', { n: c.tournamentIds.length })}
                      </span>
                    </span>
                    <span className="shrink-0 text-end">
                      <span className="block text-[15px] font-semibold text-ink tabular-nums">{c.score}</span>
                      <span className="block text-[11px] text-ink-3">{t('integrity.score')}</span>
                    </span>
                    <Badge tone={STATUS_TONE[c.status]} dot>
                      {t(`integrity.status.${c.status}`)}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel className="self-start">
          <PanelHeader title={t('integrity.principles')} />
          <ul className="list-disc space-y-2 ps-4 text-[13px] leading-relaxed text-ink-2 marker:text-ink-3">
            <li>{t('integrity.principle.no_auto')}</li>
            <li>{t('integrity.principle.evidence')}</li>
            <li>{t('integrity.principle.privacy')}</li>
            <li>{t('integrity.principle.audit')}</li>
          </ul>
          <h3 className="mt-4 mb-1.5 text-[13px] font-medium text-ink">{t('integrity.signals_title')}</h3>
          <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-ink-2">
            <li>{t('integrity.signal.bust_pattern.about')}</li>
            <li>{t('integrity.signal.co_finish.about')}</li>
            <li>{t('integrity.signal.win_rate.about')}</li>
          </ul>
        </Panel>
      </div>

      <Dialog
        open={open !== null}
        onClose={() => setOpenId(null)}
        title={open ? `${open.id} · ${db.clubs[open.clubId]?.name ?? ''}` : ''}
        description={t('integrity.case_hint')}
        size="lg"
        footer={
          open && (
            <>
              <Button variant="ghost" onClick={() => setStatus(open, 'cleared')} data-testid="integrity-clear">
                {t('integrity.action.clear')}
              </Button>
              <Button onClick={() => setStatus(open, 'reviewing')} icon={<LuEye className="size-4" aria-hidden />} data-testid="integrity-review">
                {t('integrity.action.review')}
              </Button>
              <Button variant="danger" onClick={() => setStatus(open, 'escalated')}>
                {t('integrity.action.escalate')}
              </Button>
            </>
          )
        }
      >
        {open && (
          <div className="space-y-4">
            <ul className="flex flex-wrap gap-2">
              {open.accounts.map((id) => {
                const u = db.users[id];
                return (
                  <li key={id} className="flex items-center gap-2 rounded-full border border-line py-1 ps-1 pe-3 text-[13px] text-ink">
                    <Avatar user={u ?? { name: '?', hue: 0 }} size={24} />
                    {u?.name ?? id}
                    {u?.isBot && <BotTag label={t('common.bot')} />}
                  </li>
                );
              })}
              <li className="flex items-center">
                <DemoTag label={t('integrity.simulated')} />
              </li>
            </ul>
            <div>
              <h3 className="mb-2 text-[13px] font-medium text-ink-2">{t('integrity.evidence', { hands: open.tournamentIds.length })}</h3>
              <ul className="space-y-3">
                {open.signals.map((s) => (
                  <li key={s.type} className="rounded-inner border border-line p-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[14px] font-medium text-ink">{t(`integrity.signal.${s.type}`)}</p>
                      <span className="text-[12.5px] text-ink-2 tabular-nums">{t('integrity.strength', { pct: Math.round(s.strength * 100) })}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised-2">
                      <div className={cx('h-full rounded-full', s.strength > 0.7 ? 'bg-danger' : s.strength > 0.5 ? 'bg-warning' : 'bg-info')} style={{ width: `${s.strength * 100}%` }} />
                    </div>
                    <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{t(`integrity.signal.${s.type}.detail`, s.detail)}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-1.5 text-[13px] font-medium text-ink-2">{t('integrity.tournaments')}</h3>
              <ul className="flex flex-wrap gap-1.5">
                {open.tournamentIds.slice(0, 12).map((id) => (
                  <li key={id}>
                    <button type="button" onClick={() => go('results', { id })} className="rounded-chip bg-raised px-2 py-0.5 text-[12px] text-ink-2 hover:text-ink">
                      {db.results[id]?.name ?? id}
                    </button>
                  </li>
                ))}
                {open.tournamentIds.length > 12 && <li className="text-[12px] text-ink-3">+{open.tournamentIds.length - 12}</li>}
              </ul>
            </div>
            {open.notes.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-[13px] font-medium text-ink-2">{t('integrity.history')}</h3>
                <ul className="space-y-1 text-[12.5px] text-ink-2">
                  {open.notes.map((n, i) => (
                    <li key={i}>
                      <span className="text-ink-3">{dateTime(n.at, t.lang)}</span> · {db.users[n.by]?.name ?? n.by} · {t(`integrity.status.${n.status}`)}
                      {n.text ? ` — ${n.text}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <TextArea value={note} onChange={setNote} rows={2} placeholder={t('integrity.note_placeholder')} id="integrity-note" />
            <p className="rounded-inner bg-raised px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-3">{t('integrity.case_note')}</p>
          </div>
        )}
      </Dialog>
    </div>
  );
}
