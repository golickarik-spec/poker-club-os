/**
 * Growth from the member's side (v0.4): a personal invitation link with its QR code and a
 * plain account of what came of it, plus the club's own invitation QR for anyone who can
 * see the club. Neither grants anything: an invited person still requests membership and
 * is approved by staff exactly as before.
 */
import { useMemo, useState } from 'react';
import { LuUserPlus } from 'react-icons/lu';
import { act } from '../app/context.ts';
import { dateShort } from '../app/format.ts';
import { useDb, useMe, useT } from '../app/hooks.ts';
import * as api from '../platform/api.ts';
import * as crm from '../platform/crm.ts';
import type { Club, InviteLink } from '../platform/types.ts';
import { QrCard } from '../shared/qr.tsx';
import { Badge, Button, cx } from '../ui/core.tsx';
import { Field, TextInput } from '../ui/forms.tsx';
import { Dialog } from '../ui/overlay.tsx';

const STAGE_TONE = { opened: 'neutral', requested: 'warning', approved: 'success', played: 'success', returning: 'accent', rejected: 'danger' } as const;

export function InviteFriendDialog({ club, open, onClose }: { club: Club; open: boolean; onClose: () => void }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const [campaign, setCampaign] = useState('');
  const [link, setLink] = useState<InviteLink | null>(null);
  const mine = useMemo(() => crm.myReferrals(db, me.id, club.id), [db, me.id, club.id]);
  const create = () => {
    const made = act(() => crm.personalLink(db, me.id, club.id, campaign || null));
    if (made) setLink(made);
  };
  const current = link ?? crm.myPersonalLink(db, me.id, club.id, campaign || null);
  const funnel: { key: keyof crm.ReferralSummary; testid: string }[] = [
    { key: 'opens', testid: 'opens' },
    { key: 'requested', testid: 'requested' },
    { key: 'approved', testid: 'approved' },
    { key: 'played', testid: 'played' },
    { key: 'returning', testid: 'returning' },
  ];
  return (
    <Dialog open={open} onClose={onClose} title={t('referral.invite_title')} description={t('referral.invite_hint', { club: club.name })} size="lg">
      <div className="space-y-5">
        <Field label={t('referral.campaign')} hint={t('referral.campaign_hint')} htmlFor="referral-campaign" optional={t('wizard.optional')}>
          <div className="flex flex-col gap-2 sm:flex-row">
            <TextInput id="referral-campaign" value={campaign} onChange={setCampaign} placeholder={t('referral.campaign_placeholder')} className="min-w-0 flex-1" />
            <Button variant="primary" icon={<LuUserPlus className="size-4" aria-hidden />} onClick={create} data-testid="referral-create">
              {current ? t('referral.show_link') : t('referral.create_link')}
            </Button>
          </div>
        </Field>
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_248px]">
          <div className="min-w-0">
            <h3 className="mb-2 text-[13px] font-medium text-ink">{t('referral.my_results')}</h3>
            <ol className="grid grid-cols-5 gap-1.5" data-testid="referral-funnel">
              {funnel.map((f) => (
                <li key={f.key} className="min-w-0 rounded-inner bg-raised px-1 py-2 text-center">
                  <span className="block text-[18px] font-semibold tabular-nums text-ink" data-testid={`referral-${f.testid}`}>
                    {mine.summary[f.key]}
                  </span>
                  <span className="block truncate text-[11px] leading-tight text-ink-3">{t(`referral.stage.${f.key}`)}</span>
                </li>
              ))}
            </ol>
            {mine.people.length > 0 && (
              <ul className="rows mt-3 max-h-48 overflow-y-auto rounded-inner border border-line/70" data-testid="referral-people">
                {mine.people.map((p) => (
                  <li key={p.userId} className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]">
                    <span className={cx('min-w-0 truncate', p.name ? 'text-ink' : 'italic text-ink-3')}>{p.name || t('referral.pending_person')}</span>
                    <span className="flex shrink-0 items-center gap-2 text-[12px] text-ink-3">
                      {dateShort(p.openedAt, t.lang)}
                      <Badge tone={STAGE_TONE[p.status]}>{t(`referral.status.${p.status}`)}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {mine.summary.approved > 0 && <p className="mt-2 text-[12.5px] text-ink-2">{t('referral.thanks', { n: mine.summary.approved })}</p>}
          </div>
          <div className="flex items-start justify-center">
            {current ? (
              <QrCard url={crm.linkUrl(current.token)} caption={current.campaign ? t('referral.qr_caption_campaign', { campaign: current.campaign }) : t('referral.qr_caption')} fileName={`invite-${club.code}`} size={160} />
            ) : (
              <div className="flex size-[160px] items-center justify-center rounded-inner border border-dashed border-line-strong/70 p-3 text-center text-[12.5px] text-ink-3">{t('referral.qr_placeholder')}</div>
            )}
          </div>
        </div>
        <p className="text-[12.5px] leading-relaxed text-ink-3">{t('referral.no_bypass')}</p>
      </div>
    </Dialog>
  );
}

export function ClubQrDialog({ club, open, onClose }: { club: Club; open: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <Dialog open={open} onClose={onClose} title={t('club.qr_title', { club: club.name })} description={t('club.qr_hint')} size="sm">
      <QrCard url={api.inviteLink(club)} caption={t('club.qr_caption', { code: club.code })} fileName={`club-${club.code}`} />
    </Dialog>
  );
}
