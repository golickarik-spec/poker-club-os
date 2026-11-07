import { useMemo, useState } from 'react';
import { LuFilter, LuListChecks, LuMegaphone, LuPencil, LuPlus, LuTrash2, LuUsers } from 'react-icons/lu';
import { act } from '../../app/context.ts';
import { go, useDb, useMe, useT, type T } from '../../app/hooks.ts';
import * as crm from '../../platform/crm.ts';
import type { SegmentSummary } from '../../platform/crm.ts';
import { can } from '../../platform/permissions.ts';
import { ACQUISITION_SOURCES, LIFECYCLE_STAGES, TAG_COLORS, type Club, type CrmTag, type SegmentField, type SegmentOp, type SegmentRule, type TagColor } from '../../platform/types.ts';
import { Badge, Button, cx, EmptyState, Notice, PageHeader, Panel, PanelHeader } from '../../ui/core.tsx';
import { Field, NumberInput, Segmented, Select, TextInput } from '../../ui/forms.tsx';
import { ConfirmDialog, Dialog, Tabs } from '../../ui/overlay.tsx';
import { PlayerCell, StatusBadge, TAG_HEX, TagChip, useReport } from './shared.tsx';

const FIELDS: SegmentField[] = ['status', 'tag', 'lifecycle', 'active', 'follower', 'played_recent', 'played_total', 'wins', 'approved_days', 'last_played_days', 'game_family', 'league', 'referred', 'language', 'assigned', 'source'];
const NUMERIC = new Set<SegmentField>(['played_recent', 'played_total', 'wins', 'approved_days', 'last_played_days']);

function defaultRule(field: SegmentField, tags: CrmTag[]): SegmentRule {
  if (NUMERIC.has(field)) return field === 'played_recent' ? { field, op: 'gte', value: 1, days: 30 } : { field, op: field === 'approved_days' ? 'lte' : 'gte', value: field === 'last_played_days' || field === 'approved_days' ? 30 : 1 };
  const value = field === 'status' ? 'active' : field === 'tag' ? (tags[0]?.id ?? '') : field === 'lifecycle' ? 'returning' : field === 'language' ? 'en' : field === 'source' ? 'instagram' : field === 'assigned' ? 'none' : field === 'game_family' ? 'holdem' : 'yes';
  return { field, op: 'is', value };
}

/** One line of plain language for a rule, e.g. "Tag is Weekend Player". */
export function ruleText(t: T, rule: SegmentRule, tags: CrmTag[], staffName: (id: string) => string): string {
  const field = t(`crm.rule.field.${rule.field}`);
  let value = String(rule.value);
  if (rule.field === 'status') value = t(`crm.status.${value === 'none' ? 'not_member' : value}`);
  else if (rule.field === 'tag') value = tags.find((x) => x.id === rule.value)?.name ?? '—';
  else if (rule.field === 'lifecycle') value = t(`crm.lifecycle.${value}`);
  else if (rule.field === 'active' || rule.field === 'follower') value = t(value === 'yes' ? 'common.yes' : 'common.no');
  else if (rule.field === 'language') value = t(`crm.language.${value}`);
  else if (rule.field === 'source') value = t(`crm.source.${value}`);
  else if (rule.field === 'assigned') value = value === 'none' ? t('crm.assigned.nobody') : staffName(value);
  else if (rule.field === 'game_family') value = t(`family.${value}`);
  else if (rule.field === 'league' || rule.field === 'referred') value = t(value === 'yes' ? 'common.yes' : 'common.no');
  const tail = rule.field === 'played_recent' ? ` ${t('crm.rule.in_days', { n: rule.days ?? 30 })}` : '';
  return `${field} ${t(`crm.rule.op.${rule.op}`)} ${value}${tail}`;
}

function RuleRow({ rule, onChange, onRemove, tags, staff, t }: { rule: SegmentRule; onChange: (r: SegmentRule) => void; onRemove: () => void; tags: CrmTag[]; staff: { userId: string; name: string }[]; t: T }) {
  const numeric = NUMERIC.has(rule.field);
  const options: { value: string; label: string }[] =
    rule.field === 'status'
      ? (['active', 'pending', 'suspended', 'rejected', 'banned', 'none'] as const).map((s) => ({ value: s, label: t(`crm.status.${s === 'none' ? 'not_member' : s}`) }))
      : rule.field === 'tag'
        ? tags.map((x) => ({ value: x.id, label: x.name }))
        : rule.field === 'lifecycle'
          ? LIFECYCLE_STAGES.map((s) => ({ value: s, label: t(`crm.lifecycle.${s}`) }))
          : rule.field === 'language'
            ? (['en', 'he'] as const).map((l) => ({ value: l, label: t(`crm.language.${l}`) }))
            : rule.field === 'source'
              ? ACQUISITION_SOURCES.map((s) => ({ value: s, label: t(`crm.source.${s}`) }))
              : rule.field === 'assigned'
                ? [{ value: 'none', label: t('crm.assigned.nobody') }, ...staff.map((s) => ({ value: s.userId, label: s.name }))]
                : rule.field === 'game_family'
                  ? (['holdem', 'omaha'] as const).map((f) => ({ value: f, label: t(`family.${f}`) }))
                  : [
                    { value: 'yes', label: t('common.yes') },
                    { value: 'no', label: t('common.no') },
                  ];
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-inner border border-line bg-raised/40 p-2" data-testid="segment-rule">
      <Select value={rule.field} onChange={(field) => onChange(defaultRule(field, tags))} className="h-9 w-auto min-w-[9rem] text-[13px]" aria-label={t('crm.rule.field')} data-testid="rule-field" options={FIELDS.map((f) => ({ value: f, label: t(`crm.rule.field.${f}`) }))} />
      <Select<SegmentOp> value={rule.op} onChange={(op) => onChange({ ...rule, op })} className="h-9 w-auto text-[13px]" aria-label={t('crm.rule.op')} options={(numeric ? (['gte', 'lte'] as SegmentOp[]) : (['is', 'is_not'] as SegmentOp[])).map((op) => ({ value: op, label: t(`crm.rule.op.${op}`) }))} />
      {numeric ? (
        <>
          <NumberInput value={Number(rule.value)} onChange={(value) => onChange({ ...rule, value })} min={0} max={9999} className="w-24" aria-label={t('crm.rule.value')} />
          {rule.field === 'played_recent' && (
            <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
              {t('crm.rule.within')}
              <NumberInput value={rule.days ?? 30} onChange={(days) => onChange({ ...rule, days })} min={1} max={365} className="w-24" suffix={t('crm.rule.days_suffix')} aria-label={t('crm.rule.days')} />
            </span>
          )}
        </>
      ) : (
        <Select value={String(rule.value)} onChange={(value) => onChange({ ...rule, value })} className="h-9 w-auto min-w-[9rem] flex-1 text-[13px]" aria-label={t('crm.rule.value')} data-testid="rule-value" options={options} />
      )}
      <button type="button" onClick={onRemove} aria-label={t('common.delete')} title={t('common.delete')} className="ms-auto inline-flex size-8 items-center justify-center rounded-control text-ink-3 hover:bg-raised hover:text-danger">
        <LuTrash2 className="size-4" aria-hidden />
      </button>
    </li>
  );
}

function SegmentBuilder({ club, editing, onClose, tags, staff }: { club: Club; editing: SegmentSummary | 'new'; onClose: () => void; tags: CrmTag[]; staff: { userId: string; name: string }[] }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const existing = editing === 'new' ? null : editing;
  const [name, setName] = useState(existing?.name ?? '');
  const [match, setMatch] = useState<'all' | 'any'>(existing?.match ?? 'all');
  const [rules, setRules] = useState<SegmentRule[]>(existing?.rules.length ? existing.rules : [defaultRule('status', tags)]);
  // Live preview: the same evaluation the saved segment will use.
  const preview = useMemo(() => {
    try {
      return crm.previewSegment(db, me.id, club.id, rules, match);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, me.id, club.id, JSON.stringify(rules), match]);
  const save = () => {
    const input = { name, match, rules };
    const done = existing ? act(() => crm.updateSegment(db, me.id, club.id, existing.id, input), { key: 'crm.toast.segment_saved' }) : act(() => crm.createSegment(db, me.id, club.id, input), { key: 'crm.toast.segment_saved' });
    if (done !== undefined) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={existing ? t('crm.segment.edit') : t('crm.segment.new')}
      description={t('crm.segment.builder_hint')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={save} disabled={name.trim().length < 2 || rules.length === 0 || preview === null} data-testid="segment-save">
            {t('crm.segment.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('crm.segment.name')} htmlFor="segment-name">
          <TextInput id="segment-name" value={name} onChange={setName} placeholder={t('crm.segment.name_placeholder')} data-autofocus data-testid="segment-name" />
        </Field>
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-medium text-ink">{t('crm.segment.conditions')}</p>
            <Segmented value={match} onChange={setMatch} label={t('crm.segment.match')} size="sm" options={[{ value: 'all', label: t('crm.segment.match_all') }, { value: 'any', label: t('crm.segment.match_any') }]} />
          </div>
          <ul className="space-y-2">
            {rules.map((rule, i) => (
              <RuleRow key={i} rule={rule} tags={tags} staff={staff} t={t} onChange={(r) => setRules(rules.map((x, j) => (j === i ? r : x)))} onRemove={() => setRules(rules.filter((_, j) => j !== i))} />
            ))}
          </ul>
          <Button size="sm" variant="ghost" className="mt-2" icon={<LuPlus className="size-4" aria-hidden />} onClick={() => setRules([...rules, defaultRule(rules.some((r) => r.field === 'tag') ? 'status' : 'tag', tags)])} disabled={rules.length >= 12} data-testid="segment-add-rule">
            {t('crm.segment.add_condition')}
          </Button>
        </div>
        <div className="rounded-inner border border-line p-3">
          {preview === null ? (
            <p className="text-[13px] text-danger">{t('crm.segment.invalid')}</p>
          ) : (
            <>
              <p className="text-[13px] text-ink-2">
                <span className="text-[20px] font-semibold text-ink tabular-nums" data-testid="segment-preview-count">
                  {preview.userIds.length}
                </span>{' '}
                {t.n('crm.segment.matching', preview.userIds.length)}
              </p>
              {preview.rows.length > 0 && (
                <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {preview.rows.slice(0, 6).map((r) => (
                    <li key={r.userId} className="flex items-center justify-between gap-2">
                      <PlayerCell row={r} club={club} t={t} link={false} compact />
                      <StatusBadge row={r} t={t} />
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[12px] text-ink-3">{t('crm.segment.dynamic_note')}</p>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function TagEditor({ club, tag, onClose }: { club: Club; tag: CrmTag | 'new'; onClose: () => void }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const existing = tag === 'new' ? null : tag;
  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState<TagColor>(existing?.color ?? 'blue');
  const save = () => {
    const done = existing ? act(() => crm.updateTag(db, me.id, club.id, existing.id, { name, color }), { key: 'crm.toast.tag_saved' }) : act(() => crm.createTag(db, me.id, club.id, { name, color }), { key: 'crm.toast.tag_saved' });
    if (done !== undefined) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={existing ? t('crm.tags.edit') : t('crm.tags.new')}
      size="sm"
      footer={
        <Button variant="primary" onClick={save} disabled={name.trim().length < 1} data-testid="tag-save">
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label={t('crm.tags.name')} htmlFor="tag-name" hint={t('crm.tags.name_hint')}>
          <TextInput id="tag-name" value={name} onChange={(v) => setName(v.slice(0, 28))} data-autofocus data-testid="tag-name" />
        </Field>
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink">{t('crm.tags.colour')}</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('crm.tags.colour')}>
            {TAG_COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={t(`crm.colour.${c}`)} title={t(`crm.colour.${c}`)} onClick={() => setColor(c)} className={cx('size-8 rounded-full border-2', color === c ? 'border-white' : 'border-transparent')} style={{ background: TAG_HEX[c] }} />
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-[12px] text-ink-3">{t('crm.tags.preview')}</p>
          <TagChip tag={{ name: name || t('crm.tags.name'), color }} />
        </div>
      </div>
    </Dialog>
  );
}

export function Segments({ club }: { club: Club }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const [tab, setTab] = useState<'segments' | 'tags'>('segments');
  const [building, setBuilding] = useState<SegmentSummary | 'new' | null>(null);
  const [tagEdit, setTagEdit] = useState<CrmTag | 'new' | null>(null);
  const [removeTag, setRemoveTag] = useState<(CrmTag & { members: number }) | null>(null);
  const [removeSegment, setRemoveSegment] = useState<SegmentSummary | null>(null);
  const configure = can(db, me.id, 'crm.configure', club.id);
  const publish = can(db, me.id, 'announcements.publish', club.id);
  const data = useReport(() => ({ segments: crm.listSegments(db, me.id, club.id), tags: crm.listTags(db, me.id, club.id), staff: crm.staffOf(db, me.id, club.id) }), [club.id, me.id]);
  const staffName = (id: string) => data.staff.find((s) => s.userId === id)?.name ?? '—';
  const label = (s: SegmentSummary) => (s.system ? t(`crm.segment.system.${s.system}`) : s.name);

  return (
    <div data-testid="crm-segments">
      <PageHeader
        title={t('crm.segments.title')}
        subtitle={t('crm.segments.subtitle')}
        actions={
          configure ? (
            tab === 'segments' ? (
              <Button variant="primary" icon={<LuPlus className="size-4" aria-hidden />} onClick={() => setBuilding('new')} data-testid="segment-new">
                {t('crm.segment.new')}
              </Button>
            ) : (
              <Button variant="primary" icon={<LuPlus className="size-4" aria-hidden />} onClick={() => setTagEdit('new')} data-testid="tag-new">
                {t('crm.tags.new')}
              </Button>
            )
          ) : undefined
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        label={t('crm.segments.title')}
        tabs={[
          { value: 'segments', label: t('crm.segments.tab.segments'), count: data.segments.length },
          { value: 'tags', label: t('crm.segments.tab.tags'), count: data.tags.length },
        ]}
      />

      {tab === 'segments' && (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.segments.map((s) => (
            <Panel key={s.id} className="flex flex-col" data-testid={`segment-${s.system ?? s.name}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate text-[15px] font-semibold text-ink" dir="auto">
                    {label(s)}
                  </h2>
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    <Badge tone={s.system ? 'neutral' : s.kind === 'static' ? 'neutral' : 'accent'}>{s.system ? t('crm.segment.kind.system') : s.kind === 'static' ? t('crm.segment.kind.static') : t('crm.segment.kind.dynamic')}</Badge>
                  </p>
                </div>
                <p className="shrink-0 text-end">
                  <span className="block text-[24px] leading-none font-semibold text-ink tabular-nums" data-testid="segment-count">
                    {s.count}
                  </span>
                  <span className="text-[11.5px] text-ink-3">{t.n('crm.segment.people', s.count)}</span>
                </p>
              </div>
              <ul className="mt-3 flex-1 space-y-1 text-[12.5px] leading-snug text-ink-2">
                {s.kind === 'static' ? (
                  <li>{t('crm.segment.static_note')}</li>
                ) : (
                  s.effectiveRules.map((r, i) => (
                    <li key={i} className="flex gap-1.5">
                      <LuFilter className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
                      <span>
                        {i > 0 && <span className="text-ink-3">{t(s.match === 'all' ? 'crm.segment.and' : 'crm.segment.or')} </span>}
                        {ruleText(t, r, data.tags, staffName)}
                      </span>
                    </li>
                  ))
                )}
              </ul>
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
                <Button size="sm" icon={<LuUsers className="size-3.5" aria-hidden />} onClick={() => go('console.crm.players', { clubId: club.id, segmentId: s.id })} data-testid="segment-view">
                  {t('crm.segment.view')}
                </Button>
                {publish && (
                  <Button size="sm" variant="ghost" icon={<LuMegaphone className="size-3.5" aria-hidden />} onClick={() => go('console.announcements', { clubId: club.id, segmentId: s.id })} disabled={s.count === 0} data-testid="segment-announce">
                    {t('crm.segment.announce')}
                  </Button>
                )}
                {configure && !s.system && (
                  <span className="ms-auto flex gap-1">
                    {s.kind === 'dynamic' && (
                      <button type="button" aria-label={t('common.edit')} title={t('common.edit')} className="inline-flex size-8 items-center justify-center rounded-control text-ink-3 hover:bg-raised hover:text-ink" onClick={() => setBuilding(s)}>
                        <LuPencil className="size-4" aria-hidden />
                      </button>
                    )}
                    <button type="button" aria-label={t('common.delete')} title={t('common.delete')} className="inline-flex size-8 items-center justify-center rounded-control text-ink-3 hover:bg-raised hover:text-danger" onClick={() => setRemoveSegment(s)}>
                      <LuTrash2 className="size-4" aria-hidden />
                    </button>
                  </span>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}

      {tab === 'tags' && (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <Panel pad={false}>
            {data.tags.length === 0 ? (
              <EmptyState icon={<LuListChecks />} title={t('crm.tags.empty')} className="m-4" />
            ) : (
              <ul className="divide-y divide-line" data-testid="tag-list">
                {data.tags.map((tag) => (
                  <li key={tag.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1">
                      <TagChip tag={tag} />
                    </span>
                    <button type="button" className="shrink-0 text-[13px] text-ink-2 tabular-nums hover:text-ink hover:underline" onClick={() => go('console.crm.players', { clubId: club.id })}>
                      {t.n('crm.segment.people_n', tag.members)}
                    </button>
                    {configure && (
                      <span className="flex shrink-0 gap-1">
                        <button type="button" aria-label={t('common.edit')} title={t('common.edit')} className="inline-flex size-8 items-center justify-center rounded-control text-ink-3 hover:bg-raised hover:text-ink" onClick={() => setTagEdit(tag)}>
                          <LuPencil className="size-4" aria-hidden />
                        </button>
                        <button type="button" aria-label={t('common.delete')} title={t('common.delete')} className="inline-flex size-8 items-center justify-center rounded-control text-ink-3 hover:bg-raised hover:text-danger" onClick={() => setRemoveTag(tag)}>
                          <LuTrash2 className="size-4" aria-hidden />
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <aside className="space-y-4">
            <Panel>
              <PanelHeader title={t('crm.tags.about')} />
              <p className="text-[13px] leading-relaxed text-ink-2">{t('crm.tags.about_body')}</p>
            </Panel>
            {!configure && <Notice tone="neutral">{t('crm.tags.read_only')}</Notice>}
          </aside>
        </div>
      )}

      {building && <SegmentBuilder club={club} editing={building} onClose={() => setBuilding(null)} tags={data.tags} staff={data.staff} />}
      {tagEdit && <TagEditor club={club} tag={tagEdit} onClose={() => setTagEdit(null)} />}
      <ConfirmDialog open={removeTag !== null} onClose={() => setRemoveTag(null)} onConfirm={() => removeTag && act(() => crm.deleteTag(db, me.id, club.id, removeTag.id), { key: 'crm.toast.tag_deleted' })} title={t('crm.tags.delete_title', { name: removeTag?.name ?? '' })} body={t('crm.tags.delete_body', { n: removeTag?.members ?? 0 })} confirmLabel={t('common.delete')} danger />
      <ConfirmDialog open={removeSegment !== null} onClose={() => setRemoveSegment(null)} onConfirm={() => removeSegment && act(() => crm.deleteSegment(db, me.id, club.id, removeSegment.id), { key: 'crm.toast.segment_deleted' })} title={t('crm.segment.delete_title', { name: removeSegment?.name ?? '' })} body={t('crm.segment.delete_body')} confirmLabel={t('common.delete')} danger />
    </div>
  );
}
