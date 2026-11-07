import { useState } from 'react';
import { LuCopy, LuFileUp, LuLink, LuPlus, LuQrCode, LuTrash2, LuUnlink } from 'react-icons/lu';
import { act, toasts } from '../../app/context.ts';
import { dateShort } from '../../app/format.ts';
import { go, useDb, useMe, useT } from '../../app/hooks.ts';
import * as crm from '../../platform/crm.ts';
import type { LinkSummary } from '../../platform/crm.ts';
import { isUpcoming } from '../../platform/lifecycle.ts';
import { ACQUISITION_SOURCES, type AcquisitionSource, type Club, type CrmSettings as Settings } from '../../platform/types.ts';
import { Badge, Button, Notice, PageHeader, Panel, PanelHeader } from '../../ui/core.tsx';
import { Field, NumberInput, Segmented, Select, TextInput } from '../../ui/forms.tsx';
import { ConfirmDialog, Dialog } from '../../ui/overlay.tsx';
import { QrCard } from '../../shared/qr.tsx';
import { TableShell, Td, Th } from '../shared.tsx';
import { PlayerCell, StatusBadge, useReport } from './shared.tsx';

function LinkDialog({ club, onClose }: { club: Club; onClose: () => void }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const [kind, setKind] = useState<'club' | 'tournament'>('club');
  const [label, setLabel] = useState('');
  const [source, setSource] = useState<AcquisitionSource>('instagram');
  const [expires, setExpires] = useState(0);
  const [maxUses, setMaxUses] = useState(0);
  const tournaments = Object.values(db.tournaments).filter((x) => x.clubId === club.id && (isUpcoming(x.status) || x.status === 'RUNNING'));
  const [tournamentId, setTournamentId] = useState(tournaments[0]?.id ?? '');
  const create = () => {
    const link = act(() => crm.createLink(db, me.id, club.id, { kind, tournamentId: kind === 'tournament' ? tournamentId : undefined, source: kind === 'tournament' ? 'other' : source, label, expiresInDays: expires > 0 ? expires : null, maxUses: kind === 'tournament' && maxUses > 0 ? maxUses : null }), { key: 'crm.toast.link_created' });
    if (link) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('crm.links.new')}
      description={t('crm.links.new_hint')}
      footer={
        <Button variant="primary" onClick={create} disabled={label.trim().length < 2 || (kind === 'tournament' && !tournamentId)} data-testid="link-create">
          {t('crm.links.create')}
        </Button>
      }
    >
      <div className="space-y-4">
        <Segmented value={kind} onChange={setKind} label={t('crm.links.kind')} full options={[{ value: 'club', label: t('crm.links.kind.club') }, { value: 'tournament', label: t('crm.links.kind.tournament') }]} />
        <Field label={t('crm.links.label')} htmlFor="link-label" hint={t('crm.links.label_hint')}>
          <TextInput id="link-label" value={label} onChange={(v) => setLabel(v.slice(0, 40))} data-autofocus data-testid="link-label" />
        </Field>
        {kind === 'club' ? (
          <Field label={t('crm.links.source')} htmlFor="link-source" hint={t('crm.links.source_hint')}>
            <Select id="link-source" value={source} onChange={setSource} options={ACQUISITION_SOURCES.filter((s) => s !== 'unknown' && s !== 'direct').map((s) => ({ value: s, label: t(`crm.source.${s}`) }))} />
          </Field>
        ) : (
          <Field label={t('crm.links.tournament')} htmlFor="link-tournament" hint={t('crm.links.tournament_hint')}>
            <Select id="link-tournament" value={tournamentId} onChange={setTournamentId} options={tournaments.map((x) => ({ value: x.id, label: x.name }))} />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('crm.links.expires')} htmlFor="link-expires" hint={t('crm.links.zero_none')}>
            <NumberInput id="link-expires" value={expires} onChange={setExpires} min={0} max={365} suffix={t('crm.rule.days_suffix')} />
          </Field>
          {kind === 'tournament' && (
            <Field label={t('crm.links.max_uses')} htmlFor="link-max" hint={t('crm.links.max_uses_hint')}>
              <NumberInput id="link-max" value={maxUses} onChange={setMaxUses} min={0} max={10000} />
            </Field>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** What "active" and "inactive" mean for this club, its invitation links, and how long it keeps activity records. */
export function CrmSettings({ club }: { club: Club }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const data = useReport(() => ({ settings: crm.getCrmSettings(db, me.id, club.id), links: crm.listLinks(db, me.id, club.id), former: crm.queryPlayers(db, me.id, club.id, { statuses: ['none', 'rejected'], sort: 'least_active' }).rows }), [club.id, me.id]);
  const [draft, setDraft] = useState<Settings>(data.settings);
  const [adding, setAdding] = useState(false);
  const [revoking, setRevoking] = useState<LinkSummary | null>(null);
  const [qr, setQr] = useState<{ label: string; url: string; file: string } | null>(null);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const copy = (link: LinkSummary) => {
    const url = crm.linkUrl(link.token);
    navigator.clipboard?.writeText(url).then(
      () => toasts.push('success', t('crm.links.copied')),
      () => toasts.push('info', url),
    );
  };
  const q = search.trim().toLowerCase();
  const former = q.length >= 2 ? data.former.filter((r) => r.name.toLowerCase().includes(q) || r.handle.toLowerCase().includes(q)).slice(0, 6) : [];
  const forgetRow = data.former.find((r) => r.userId === forgetting);

  return (
    <div data-testid="crm-settings">
      <PageHeader title={t('crm.settings.title')} subtitle={t('crm.settings.subtitle')} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Panel>
            <PanelHeader title={t('crm.settings.definitions')} hint={t('crm.settings.definitions_hint')} />
            <div className="space-y-4">
              <Field label={t('crm.settings.active_days')} htmlFor="set-active" hint={t('crm.settings.active_days_hint')}>
                <NumberInput id="set-active" value={draft.activeDays} onChange={(activeDays) => setDraft({ ...draft, activeDays })} min={1} max={365} stepper className="max-w-[220px]" suffix={t('crm.rule.days_suffix')} data-testid="set-active-days" />
              </Field>
              <Field label={t('crm.settings.inactive_days')} htmlFor="set-inactive" hint={t('crm.settings.inactive_days_hint')}>
                <NumberInput id="set-inactive" value={draft.inactiveDays} onChange={(inactiveDays) => setDraft({ ...draft, inactiveDays })} min={1} max={730} stepper className="max-w-[220px]" suffix={t('crm.rule.days_suffix')} />
              </Field>
              <Field label={t('crm.settings.new_member_days')} htmlFor="set-new" hint={t('crm.settings.new_member_days_hint')}>
                <NumberInput id="set-new" value={draft.newMemberDays} onChange={(newMemberDays) => setDraft({ ...draft, newMemberDays })} min={1} max={365} stepper className="max-w-[220px]" suffix={t('crm.rule.days_suffix')} />
              </Field>
              <Button variant="primary" disabled={!dirty} onClick={() => act(() => crm.updateCrmSettings(db, me.id, club.id, draft), { key: 'crm.toast.settings_saved' })} data-testid="crm-settings-save">
                {t('common.save')}
              </Button>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title={t('crm.settings.retention')} hint={t('crm.settings.retention_hint')} />
            <Field label={t('crm.settings.retention_months')} htmlFor="set-retention" hint={t('crm.settings.retention_months_hint')}>
              <NumberInput id="set-retention" value={draft.retentionMonths} onChange={(retentionMonths) => setDraft({ ...draft, retentionMonths })} min={0} max={120} stepper className="max-w-[220px]" suffix={t('crm.settings.months_suffix')} />
            </Field>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" disabled={!dirty} onClick={() => act(() => crm.updateCrmSettings(db, me.id, club.id, draft), { key: 'crm.toast.settings_saved' })}>
                {t('common.save')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={data.settings.retentionMonths === 0}
                onClick={() => {
                  const removed = act(() => crm.applyRetention(db, me.id, club.id));
                  if (removed !== undefined) toasts.push('info', t('crm.settings.retention_done', { n: removed }));
                }}
              >
                {t('crm.settings.retention_apply')}
              </Button>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title={t('crm.settings.forget')} hint={t('crm.settings.forget_hint')} />
            <TextInput type="search" value={search} onChange={setSearch} placeholder={t('crm.settings.forget_search')} aria-label={t('crm.settings.forget_search')} />
            {former.length > 0 && (
              <ul className="mt-2 divide-y divide-line">
                {former.map((r) => (
                  <li key={r.userId} className="flex items-center gap-2 py-2">
                    <span className="min-w-0 flex-1">
                      <PlayerCell row={r} club={club} t={t} link={false} compact />
                    </span>
                    <StatusBadge row={r} t={t} />
                    <Button size="sm" variant="danger" icon={<LuTrash2 className="size-3.5" aria-hidden />} onClick={() => setForgetting(r.userId)}>
                      {t('crm.settings.forget_action')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[12px] leading-snug text-ink-3">{t('crm.settings.forget_note')}</p>
          </Panel>
        </div>

        <Panel pad={false} className="self-start">
          <PanelHeader
            title={
              <>
                <LuLink className="size-4 text-ink-3" aria-hidden />
                {t('crm.links.title')}
              </>
            }
            hint={t('crm.links.hint')}
            action={
              <Button size="sm" variant="primary" icon={<LuPlus className="size-4" aria-hidden />} onClick={() => setAdding(true)} data-testid="link-new">
                {t('crm.links.new')}
              </Button>
            }
            className="px-4 pt-4 sm:px-5"
          />
          <TableShell minWidth={700}>
            <thead>
              <tr>
                <Th>{t('crm.links.label')}</Th>
                <Th>{t('crm.links.source')}</Th>
                <Th end>{t('crm.links.uses')}</Th>
                <Th>{t('crm.links.state')}</Th>
                <Th end>
                  <span className="sr-only">{t('crm.col.actions')}</span>
                </Th>
              </tr>
            </thead>
            <tbody data-testid="link-list">
              <tr className="border-t border-line">
                <Td>
                  <span className="block font-medium text-ink">{t('crm.links.permanent')}</span>
                  <span className="block text-[12px] text-ink-3" dir="ltr">
                    {crm.linkUrl(club.inviteToken)}
                  </span>
                </Td>
                <Td className="text-ink-2">{t('crm.source.unknown')}</Td>
                <Td end className="text-ink-3">
                  —
                </Td>
                <Td>
                  <Badge tone="success">{t('crm.links.state.active')}</Badge>
                </Td>
                <Td end>
                  <button type="button" aria-label={t('crm.links.qr')} title={t('crm.links.qr')} className="inline-flex size-8 items-center justify-center rounded-control text-ink-3 hover:bg-raised hover:text-ink" onClick={() => setQr({ label: t('crm.links.permanent'), url: crm.linkUrl(club.inviteToken), file: `club-${club.code}` })} data-testid="link-qr-permanent">
                    <LuQrCode className="size-4" aria-hidden />
                  </button>
                </Td>
              </tr>
              {data.links.map((link) => (
                <tr key={link.id} className="border-t border-line" data-testid={`link-${link.token}`}>
                  <Td className="max-w-[280px]">
                    <span className="block truncate font-medium text-ink" dir="auto">
                      {link.label}
                    </span>
                    <span className="block truncate text-[12px] text-ink-3" dir="ltr">
                      {crm.linkUrl(link.token)}
                    </span>
                    {link.kind === 'tournament' && <span className="block truncate text-[12px] text-ink-3">{t('crm.links.for_tournament', { name: db.tournaments[link.tournamentId ?? '']?.name ?? '—' })}</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-2">{link.kind === 'tournament' ? t('crm.links.kind.tournament') : t(`crm.source.${link.source}`)}</Td>
                  <Td end className="tabular-nums">
                    {link.kind === 'tournament' ? (
                      <span dir="ltr">
                        {link.uses}
                        {link.maxUses !== null ? ` / ${link.maxUses}` : ''}
                      </span>
                    ) : (
                      link.opens
                    )}
                  </Td>
                  <Td>
                    <Badge tone={link.problem === null ? 'success' : link.problem === 'revoked' ? 'danger' : 'neutral'}>{t(`crm.links.state.${link.problem ?? 'active'}`)}</Badge>
                    {link.problem === null && link.expiresAt !== null && <span className="ms-2 text-[12px] text-ink-3">{t('crm.links.until', { date: dateShort(link.expiresAt, t.lang) })}</span>}
                  </Td>
                  <Td end>
                    <span className="flex justify-end gap-1">
                      <button type="button" aria-label={t('crm.links.copy')} title={t('crm.links.copy')} className="inline-flex size-8 items-center justify-center rounded-control text-ink-3 hover:bg-raised hover:text-ink" onClick={() => copy(link)}>
                        <LuCopy className="size-4" aria-hidden />
                      </button>
                      {link.problem === null && (
                        <button type="button" aria-label={t('crm.links.qr')} title={t('crm.links.qr')} className="inline-flex size-8 items-center justify-center rounded-control text-ink-3 hover:bg-raised hover:text-ink" onClick={() => setQr({ label: link.label, url: crm.linkUrl(link.token), file: `invite-${link.token}` })} data-testid={`link-qr-${link.token}`}>
                          <LuQrCode className="size-4" aria-hidden />
                        </button>
                      )}
                      {link.revokedAt === null && (
                        <button type="button" aria-label={t('crm.links.revoke')} title={t('crm.links.revoke')} className="inline-flex size-8 items-center justify-center rounded-control text-ink-3 hover:bg-raised hover:text-danger" onClick={() => setRevoking(link)} data-testid={`link-revoke-${link.token}`}>
                          <LuUnlink className="size-4" aria-hidden />
                        </button>
                      )}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
          <Notice tone="neutral" className="m-4">
            {t('crm.links.note')}
          </Notice>
        </Panel>
      </div>

      <Panel className="mt-4" data-testid="migration-card">
        <PanelHeader title={t('migration.title')} hint={t('migration.card_hint')} action={<Button size="sm" variant="primary" icon={<LuFileUp className="size-3.5" aria-hidden />} onClick={() => go('console.crm.import', { clubId: club.id })} data-testid="open-migration">{t('migration.open')}</Button>} />
      </Panel>

      {adding && <LinkDialog club={club} onClose={() => setAdding(false)} />}
      <Dialog open={qr !== null} onClose={() => setQr(null)} title={qr?.label ?? ''} description={t('crm.links.qr_hint')} size="sm">
        {qr && <QrCard url={qr.url} fileName={qr.file} />}
      </Dialog>
      <ConfirmDialog open={revoking !== null} onClose={() => setRevoking(null)} onConfirm={() => revoking && act(() => crm.revokeLink(db, me.id, club.id, revoking.id), { key: 'crm.toast.link_revoked' })} title={t('crm.links.revoke_title', { label: revoking?.label ?? '' })} body={t('crm.links.revoke_body')} confirmLabel={t('crm.links.revoke')} danger />
      <ConfirmDialog
        open={forgetting !== null}
        onClose={() => setForgetting(null)}
        onConfirm={() => forgetting && act(() => crm.forgetPlayer(db, me.id, club.id, forgetting), { key: 'crm.toast.forgotten' })}
        title={t('crm.settings.forget_title', { name: forgetRow?.name ?? '' })}
        body={t('crm.settings.forget_body')}
        confirmLabel={t('crm.settings.forget_action')}
        danger
      />
    </div>
  );
}
