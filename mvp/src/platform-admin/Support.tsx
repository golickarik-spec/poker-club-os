import { useState } from 'react';
import { LuCheck, LuFlag, LuLifeBuoy } from 'react-icons/lu';
import { act } from '../app/context.ts';
import { dateTime } from '../app/format.ts';
import { useDb, useMe, useT } from '../app/hooks.ts';
import { listReports, reviewReport } from '../platform/messaging.ts';
import type { TicketStatus } from '../platform/types.ts';
import { TicketDialog, TicketList } from '../shared/support.tsx';
import { Badge, Button, EmptyState, Notice, PageHeader, Panel } from '../ui/core.tsx';
import { Select } from '../ui/forms.tsx';
import { Tabs } from '../ui/overlay.tsx';

type Tab = 'queue' | 'reports' | TicketStatus;

export function PlatformSupport() {
  const t = useT();
  const db = useDb();
  const [tab, setTab] = useState<Tab>('queue');
  const [clubId, setClubId] = useState('all');
  const me = useMe()!;
  const [openId, setOpenId] = useState<string | null>(null);
  const reports = listReports(db, me.id).filter((r) => clubId === 'all' || r.report.clubId === clubId);
  const all = db.tickets.filter((x) => clubId === 'all' || x.clubId === clubId).sort((a, b) => Number(b.priority === 'high') - Number(a.priority === 'high') || b.updatedAt - a.updatedAt);
  const queue = all.filter((x) => x.status === 'open' || x.status === 'in_progress');
  const list = tab === 'queue' ? queue : all.filter((x) => x.status === tab);
  return (
    <>
      <PageHeader title={t('psupport.title')} subtitle={t('psupport.subtitle')} />
      <div className="mb-1 flex flex-wrap items-end justify-between gap-3">
        <Tabs
          value={tab}
          onChange={setTab}
          label={t('psupport.title')}
          className="min-w-0 flex-1"
          tabs={[
            { value: 'queue', label: t('psupport.tab.queue'), count: queue.length },
            { value: 'waiting', label: t('ticket.status.waiting'), count: all.filter((x) => x.status === 'waiting').length },
            { value: 'resolved', label: t('ticket.status.resolved') },
            { value: 'reports', label: t('psupport.tab.reports'), count: reports.filter((r) => r.report.status === 'open').length },
          ]}
        />
        <Select value={clubId} onChange={setClubId} aria-label={t('common.club')} className="mb-1.5 h-9 w-auto min-w-[180px]" options={[{ value: 'all', label: t('tournaments.all_clubs') }, ...Object.values(db.clubs).map((c) => ({ value: c.id, label: c.name }))]} />
      </div>
      <div className="pt-3">
        {tab === 'reports' ? (
          reports.length === 0 ? (
            <EmptyState icon={<LuFlag />} title={t('psupport.reports.empty')} />
          ) : (
            <>
              <Panel pad={false}>
                <ul className="divide-y divide-line" data-testid="abuse-reports">
                  {reports.map(({ report, clubName, reporterName, aboutName }) => (
                    <li key={report.id} className="flex flex-wrap items-start gap-3 px-4 py-3 sm:px-5">
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium text-ink">
                          {t(report.side === 'player' ? 'psupport.reports.by_player' : 'psupport.reports.by_club', { reporter: reporterName, about: aboutName })}
                          <Badge tone={report.status === 'open' ? 'warning' : 'neutral'}>{t(`psupport.reports.status.${report.status}`)}</Badge>
                        </span>
                        <span className="mt-1 block text-[13px] leading-snug text-ink-2" dir="auto">
                          {report.reason}
                        </span>
                        <span className="mt-1 block text-[12px] text-ink-3">
                          {clubName} · {dateTime(report.at, t.lang)}
                        </span>
                      </span>
                      {report.status === 'open' && (
                        <Button size="sm" icon={<LuCheck className="size-3.5" aria-hidden />} onClick={() => act(() => reviewReport(db, me.id, report.id), { key: 'psupport.reports.reviewed' })}>
                          {t('psupport.reports.mark_reviewed')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>
              <Notice tone="neutral" className="mt-3">
                {t('psupport.reports.note')}
              </Notice>
            </>
          )
        ) : list.length === 0 ? (
          <EmptyState icon={<LuLifeBuoy />} title={t('psupport.empty.title')} body={t('psupport.empty.body')} />
        ) : (
          <Panel pad={false}>
            <TicketList tickets={list} onOpen={setOpenId} showClub />
          </Panel>
        )}
      </div>
      <TicketDialog ticketId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
