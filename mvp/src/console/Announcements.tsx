import { useRef, useState } from 'react';
import { LuCalendarClock, LuImage, LuMegaphone, LuPin, LuSend, LuTrash2, LuX } from 'react-icons/lu';
import { act, toasts } from '../app/context.ts';
import { dateTime, fromLocalInput, num, toLocalInput } from '../app/format.ts';
import { useDb, useMe, useNow, useT } from '../app/hooks.ts';
import * as api from '../platform/api.ts';
import * as crm from '../platform/crm.ts';
import { isUpcoming } from '../platform/lifecycle.ts';
import { can } from '../platform/permissions.ts';
import type { Announcement, AnnouncementAudience, AnnouncementKind, Club } from '../platform/types.ts';
import { Badge, Button, DemoTag, EmptyState, IconButton, Notice, PageHeader, Panel, PanelHeader } from '../ui/core.tsx';
import { Field, Segmented, Select, Switch, TextArea, TextInput } from '../ui/forms.tsx';
import { readImage } from '../ui/image.ts';
import { ConfirmDialog } from '../ui/overlay.tsx';
import { useReport } from './crm/shared.tsx';

const KINDS: AnnouncementKind[] = ['news', 'tournament', 'reminder', 'schedule', 'community', 'format', 'maintenance'];
type AudienceType = AnnouncementAudience['type'];

/**
 * Write an announcement, choose who it is for, send it now or later, and see
 * what happened to each one. Every figure in the list comes from the delivery
 * record made when it was sent.
 */
export function Announcements({ club, segmentParam }: { club: Club; segmentParam?: string }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const now = useNow(30_000);
  const fileInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<AnnouncementKind>('news');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [audienceType, setAudienceType] = useState<AudienceType>(segmentParam ? 'segment' : 'members');
  const [segmentId, setSegmentId] = useState(segmentParam ?? '');
  const [tournamentId, setTournamentId] = useState('');
  const [notify, setNotify] = useState(true);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState(() => now + 60 * 60_000);
  const [deleting, setDeleting] = useState<Announcement | null>(null);

  const canSeeSegments = can(db, me.id, 'members.view', club.id);
  const data = useReport(
    () => ({
      log: api.clubAnnouncementLog(db, me.id, club.id),
      segments: canSeeSegments ? crm.listSegments(db, me.id, club.id) : [],
    }),
    [club.id, me.id, canSeeSegments],
  );
  const tournaments = Object.values(db.tournaments).filter((x) => x.clubId === club.id && (isUpcoming(x.status) || x.status === 'RUNNING' || x.status === 'PAUSED'));
  const audience: AnnouncementAudience = audienceType === 'segment' ? { type: 'segment', segmentId: segmentId || data.segments[0]?.id } : audienceType === 'tournament' ? { type: 'tournament', tournamentId: tournamentId || tournaments[0]?.id } : { type: audienceType };
  const audienceReady = (audience.type !== 'segment' || !!audience.segmentId) && (audience.type !== 'tournament' || !!audience.tournamentId);
  const reach = useReport(() => (audienceReady ? api.audiencePreview(db, me.id, club.id, audience) : { eligible: 0, reachable: 0 }), [club.id, me.id, audience, audienceReady]);
  const segmentName = (id: string | undefined): string => {
    const s = data.segments.find((x) => x.id === id);
    return s ? (s.system ? t(`crm.segment.system.${s.system}`) : s.name) : '—';
  };
  const audienceText = (a: AnnouncementAudience): string => (a.type === 'segment' ? t('announcements.audience.segment_named', { name: segmentName(a.segmentId) }) : a.type === 'tournament' ? t('announcements.audience.tournament_named', { name: db.tournaments[a.tournamentId ?? '']?.name ?? '—' }) : t(`announcements.audience.${a.type}`));

  const upload = (file: File | undefined) => {
    if (!file) return;
    readImage(file, 900, 0.72).then(
      (dataUrl) => setImage(dataUrl),
      () => toasts.push('error', t('branding.image_failed')),
    );
  };

  const publish = () => {
    const ok = act(() => api.publishAnnouncement(db, me.id, club.id, { kind, title, body, pinned, audience, image, notify, scheduledAt: when === 'later' ? scheduledAt : null }), {
      key: when === 'later' ? 'announcements.scheduled' : 'announcements.sent',
    });
    if (ok) {
      setTitle('');
      setBody('');
      setPinned(false);
      setImage(null);
      setWhen('now');
    }
  };

  return (
    <div data-testid="crm-announcements">
      <PageHeader title={t('announcements.title')} subtitle={t('announcements.subtitle')} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
        <Panel className="self-start">
          <PanelHeader title={t('announcements.new')} />
          <form
            className="space-y-3.5"
            onSubmit={(e) => {
              e.preventDefault();
              publish();
            }}
          >
            <Field label={t('announcements.kind')} htmlFor="an-kind">
              <Select id="an-kind" value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: t(`announcement.kind.${k}`) }))} />
            </Field>
            <Field label={t('announcements.field.title')} htmlFor="an-title">
              <TextInput id="an-title" value={title} onChange={setTitle} maxLength={90} data-testid="an-title" />
            </Field>
            <Field label={t('announcements.field.body')} htmlFor="an-body" hint={`${body.length}/800`}>
              <TextArea id="an-body" value={body} onChange={(v) => setBody(v.slice(0, 800))} rows={4} />
            </Field>

            <div>
              <p className="mb-1.5 text-[13px] font-medium text-ink">{t('announcements.image')}</p>
              {image ? (
                <div className="relative">
                  <img src={image} alt="" className="max-h-40 w-full rounded-inner object-cover" />
                  <button type="button" onClick={() => setImage(null)} aria-label={t('announcements.image_remove')} title={t('announcements.image_remove')} className="absolute end-2 top-2 inline-flex size-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black">
                    <LuX className="size-4" aria-hidden />
                  </button>
                </div>
              ) : (
                <Button size="sm" icon={<LuImage className="size-4" aria-hidden />} onClick={() => fileInput.current?.click()}>
                  {t('announcements.image_add')}
                </Button>
              )}
              <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => (upload(e.target.files?.[0]), (e.target.value = ''))} />
            </div>

            <Field label={t('announcements.audience')} htmlFor="an-audience" hint={t(`announcements.audience_hint.${audienceType}`)}>
              <Select<AudienceType>
                id="an-audience"
                value={audienceType}
                onChange={setAudienceType}
                data-testid="an-audience"
                options={[
                  { value: 'members', label: t('announcements.audience.members') },
                  { value: 'followers', label: t('announcements.audience.followers') },
                  { value: 'everyone', label: t('announcements.audience.everyone') },
                  { value: 'segment', label: t('announcements.audience.segment'), disabled: data.segments.length === 0 },
                  { value: 'tournament', label: t('announcements.audience.tournament'), disabled: tournaments.length === 0 },
                ]}
              />
            </Field>
            {audienceType === 'segment' && (
              <Select value={audience.segmentId ?? ''} onChange={setSegmentId} aria-label={t('announcements.audience.segment')} data-testid="an-segment" options={data.segments.map((s) => ({ value: s.id, label: `${s.system ? t(`crm.segment.system.${s.system}`) : s.name} (${s.count})` }))} />
            )}
            {audienceType === 'tournament' && <Select value={audience.tournamentId ?? ''} onChange={setTournamentId} aria-label={t('announcements.audience.tournament')} options={tournaments.map((x) => ({ value: x.id, label: x.name }))} />}
            <p className="rounded-inner bg-raised px-3 py-2 text-[12.5px] leading-snug text-ink-2" data-testid="an-reach">
              {t('announcements.reach', { eligible: num(reach.eligible), reachable: num(reach.reachable) })}
              {reach.eligible > reach.reachable && <span className="block text-ink-3">{t('announcements.reach_opt_out', { n: num(reach.eligible - reach.reachable) })}</span>}
            </p>

            <Switch checked={notify} onChange={setNotify} label={t('announcements.notify')} description={t('announcements.notify_hint')} />
            <Switch checked={pinned} onChange={setPinned} label={t('announcements.pin')} id="an-pin" />

            <div>
              <Segmented value={when} onChange={setWhen} label={t('announcements.when')} full options={[{ value: 'now', label: t('announcements.when.now') }, { value: 'later', label: t('announcements.when.later') }]} />
              {when === 'later' && (
                <TextInput
                  type="datetime-local"
                  value={toLocalInput(scheduledAt)}
                  min={toLocalInput(now)}
                  onChange={(v) => {
                    const ts = fromLocalInput(v);
                    if (ts) setScheduledAt(ts);
                  }}
                  className="mt-2"
                  aria-label={t('announcements.when.later')}
                  data-testid="an-schedule-at"
                />
              )}
            </div>

            <Button type="submit" variant="primary" full icon={when === 'later' ? <LuCalendarClock className="size-4" aria-hidden /> : <LuSend className="size-4 flip-rtl" aria-hidden />} disabled={title.trim().length < 3 || body.trim().length < 3 || !audienceReady} data-testid="an-publish">
              {when === 'later' ? t('announcements.schedule') : t('announcements.publish_now')}
            </Button>
            <p className="text-[12px] leading-snug text-ink-3">{t('announcements.consent_note')}</p>
          </form>
        </Panel>

        <div className="min-w-0">
          {data.log.length === 0 ? (
            <EmptyState icon={<LuMegaphone />} title={t('announcements.empty.title')} body={t('announcements.empty.body')} />
          ) : (
            <ul className="space-y-3" data-testid="an-list">
              {data.log.map(({ announcement: a, delivery }) => (
                <li key={a.id} className="rounded-panel border border-line bg-surface p-4" data-testid={`an-${a.status}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={a.kind === 'maintenance' ? 'warning' : a.kind === 'schedule' || a.kind === 'reminder' ? 'info' : 'accent'}>{t(`announcement.kind.${a.kind}`)}</Badge>
                        <Badge>{audienceText(a.audience)}</Badge>
                        {a.status === 'scheduled' && (
                          <Badge tone="warning">
                            <LuCalendarClock className="size-3" aria-hidden />
                            {t('announcements.scheduled_for', { when: dateTime(a.scheduledAt ?? a.at, t.lang) })}
                          </Badge>
                        )}
                        {a.pinned && (
                          <Badge>
                            <LuPin className="size-3" aria-hidden />
                            {t('club.pinned')}
                          </Badge>
                        )}
                      </div>
                      <h3 className="mt-2 text-[15px] font-semibold text-ink" dir="auto">
                        {a.title}
                      </h3>
                    </div>
                    <IconButton label={a.status === 'scheduled' ? t('announcements.cancel_scheduled') : t('announcements.delete')} size="sm" onClick={() => setDeleting(a)}>
                      <LuTrash2 className="size-4" aria-hidden />
                    </IconButton>
                  </div>
                  {a.image && <img src={a.image} alt="" className="mt-2 max-h-44 rounded-inner object-cover" />}
                  <p className="mt-1.5 max-w-[70ch] text-[13.5px] leading-relaxed whitespace-pre-line text-ink-2" dir="auto">
                    {a.body}
                  </p>
                  {delivery ? (
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3 text-[13px] sm:grid-cols-5" data-testid="an-stats">
                      {(
                        [
                          ['recipients', delivery.eligible],
                          ['delivered', delivery.delivered],
                          ['opted_out', delivery.optedOut],
                          ['read', delivery.read + delivery.simulatedRead],
                          ['errors', delivery.errors],
                        ] as const
                      ).map(([key, value]) => (
                        <div key={key}>
                          <dt className="text-[11.5px] text-ink-3">{t(`announcements.stat.${key}`)}</dt>
                          <dd className="font-semibold text-ink tabular-nums" data-stat={key}>
                            {num(value)}
                          </dd>
                        </div>
                      ))}
                      <div className="col-span-2 flex flex-wrap items-center gap-2 text-[12px] text-ink-3 sm:col-span-5">
                        <DemoTag label={t('announcements.simulated')} />
                        {t('announcements.simulated_note', { delivered: num(delivery.simulatedDelivered), read: num(delivery.simulatedRead) })}
                      </div>
                    </dl>
                  ) : a.status === 'published' ? (
                    <p className="mt-3 border-t border-line pt-3 text-[12.5px] text-ink-3">{t('announcements.no_notifications')}</p>
                  ) : null}
                  <p className="mt-2 text-[12px] text-ink-3">
                    {db.users[a.authorId]?.name ?? '—'} · {a.status === 'scheduled' ? t('announcements.not_sent_yet') : dateTime(a.at, t.lang)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Notice tone="neutral" className="mt-4">
            {t('announcements.stats_note')}
          </Notice>
        </div>
      </div>
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && act(() => api.deleteAnnouncement(db, me.id, deleting.id), { key: 'announcements.deleted' })}
        title={t('announcements.delete_title')}
        body={deleting?.title}
        confirmLabel={t('common.delete')}
        danger
      />
    </div>
  );
}
