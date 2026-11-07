import { useState } from 'react';
import { dateTime } from '../app/format.ts';
import { useDb, useT } from '../app/hooks.ts';
import { SYSTEM } from '../platform/api.ts';
import type { Club } from '../platform/types.ts';
import { EmptyState, PageHeader, Panel } from '../ui/core.tsx';
import { Segmented } from '../ui/forms.tsx';
import { auditText, TableShell, Td, Th } from './shared.tsx';

type Filter = 'all' | 'tournament' | 'member' | 'club';

export function Audit({ club }: { club: Club }) {
  const t = useT();
  const db = useDb();
  const [filter, setFilter] = useState<Filter>('all');
  const entries = db.audit
    .filter((a) => a.clubId === club.id)
    .filter((a) => {
      if (filter === 'all') return true;
      const area = a.action.split('.')[0];
      if (filter === 'tournament') return area === 'tournament' || area === 'registration';
      if (filter === 'member') return area === 'member';
      return area === 'club' || area === 'announcement' || area === 'support';
    })
    .slice(-200)
    .reverse();
  return (
    <>
      <PageHeader title={t('audit.title')} subtitle={t('audit.subtitle')} />
      <div className="mb-4">
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          label={t('audit.filter')}
          options={[
            { value: 'all', label: t('common.all') },
            { value: 'tournament', label: t('audit.filter.tournament') },
            { value: 'member', label: t('audit.filter.member') },
            { value: 'club', label: t('audit.filter.club') },
          ]}
        />
      </div>
      {entries.length === 0 ? (
        <EmptyState title={t('audit.empty')} />
      ) : (
        <Panel pad={false}>
          <TableShell minWidth={560}>
            <thead>
              <tr>
                <Th>{t('audit.col.when')}</Th>
                <Th>{t('audit.col.who')}</Th>
                <Th>{t('audit.col.what')}</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((a) => (
                <tr key={a.id} className="border-b border-line last:border-0" data-testid="audit-row">
                  <Td className="whitespace-nowrap text-ink-3 tabular-nums">{dateTime(a.at, t.lang)}</Td>
                  <Td className="whitespace-nowrap text-ink-2">{a.actorId === SYSTEM ? t('audit.system') : (db.users[a.actorId]?.name ?? '—')}</Td>
                  <Td className="text-ink">{auditText(t, a)}</Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Panel>
      )}
    </>
  );
}
