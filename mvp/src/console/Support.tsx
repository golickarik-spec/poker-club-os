import { useState, type ReactNode } from 'react';
import { LuBookOpen, LuBug, LuLifeBuoy, LuLightbulb, LuPlus } from 'react-icons/lu';
import { act } from '../app/context.ts';
import { useDb, useMe, useT } from '../app/hooks.ts';
import * as api from '../platform/api.ts';
import type { Club, TicketCategory, TicketPriority } from '../platform/types.ts';
import { TicketDialog, TicketList } from '../shared/support.tsx';
import { Button, EmptyState, PageHeader, Panel, PanelHeader } from '../ui/core.tsx';
import { Field, Segmented, Select, TextArea, TextInput } from '../ui/forms.tsx';
import { Dialog, Tabs } from '../ui/overlay.tsx';

const CATEGORIES: TicketCategory[] = ['technical', 'gameplay_bug', 'feature_request', 'account', 'billing'];
const DOCS = ['first_tournament', 'structures', 'roles', 'balancing', 'integrity'] as const;

export function Support({ club }: { club: Club }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState<TicketCategory | null>(null);
  const [doc, setDoc] = useState<(typeof DOCS)[number] | null>(null);
  const [category, setCategory] = useState<TicketCategory>('technical');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const tickets = db.tickets.filter((x) => x.clubId === club.id).sort((a, b) => b.updatedAt - a.updatedAt);
  const open = tickets.filter((x) => x.status !== 'resolved');
  const resolved = tickets.filter((x) => x.status === 'resolved');
  const list = tab === 'open' ? open : resolved;
  const plan = db.plans[club.planId];

  const start = (c: TicketCategory) => {
    setCategory(c);
    setPriority('normal');
    setSubject('');
    setBody('');
    setCreating(c);
  };
  const submit = () => {
    const ticket = act(() => api.createTicket(db, me.id, club.id, { category, priority, subject, body }), { key: 'support.created' });
    if (ticket) {
      setCreating(null);
      setOpenId(ticket.id);
    }
  };

  return (
    <>
      <PageHeader
        title={t('support.title')}
        subtitle={t('support.subtitle', { level: t(`plan.support.${plan.support}`) })}
        actions={
          <Button variant="primary" icon={<LuPlus className="size-4" aria-hidden />} onClick={() => start('technical')} data-testid="new-ticket">
            {t('support.new')}
          </Button>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <div className="mb-4 grid gap-2.5 sm:grid-cols-3">
            <QuickAction icon={<LuLifeBuoy />} title={t('support.quick.technical')} onClick={() => start('technical')} />
            <QuickAction icon={<LuBug />} title={t('support.quick.bug')} onClick={() => start('gameplay_bug')} />
            <QuickAction icon={<LuLightbulb />} title={t('support.quick.idea')} onClick={() => start('feature_request')} />
          </div>
          <Tabs
            value={tab}
            onChange={setTab}
            label={t('support.title')}
            tabs={[
              { value: 'open', label: t('support.tab.open'), count: open.length },
              { value: 'resolved', label: t('support.tab.resolved') },
            ]}
          />
          <div className="pt-4">
            {list.length === 0 ? (
              <EmptyState icon={<LuLifeBuoy />} title={t(`support.empty.${tab}`)} body={t('support.empty.body')} />
            ) : (
              <Panel pad={false}>
                <TicketList tickets={list} onOpen={setOpenId} />
              </Panel>
            )}
          </div>
        </div>
        <Panel className="self-start">
          <PanelHeader title={t('support.docs')} hint={t('support.docs_hint')} />
          <ul className="space-y-1">
            {DOCS.map((d) => (
              <li key={d}>
                <button type="button" onClick={() => setDoc(d)} className="flex w-full items-center gap-2.5 rounded-control px-2 py-2 text-start text-[13.5px] text-ink hover:bg-raised">
                  <LuBookOpen className="size-4 shrink-0 text-ink-3" aria-hidden />
                  {t(`support.doc.${d}.title`)}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Dialog
        open={creating !== null}
        onClose={() => setCreating(null)}
        title={t('support.new')}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={submit} disabled={subject.trim().length < 4 || body.trim().length < 10} data-testid="ticket-submit">
              {t('support.submit')}
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('support.field.category')} htmlFor="tk-cat">
              <Select id="tk-cat" value={category} onChange={setCategory} options={CATEGORIES.map((c) => ({ value: c, label: t(`ticket.category.${c}`) }))} />
            </Field>
            <Field label={t('support.field.priority')} htmlFor="tk-pri">
              <Segmented value={priority} onChange={setPriority} label={t('support.field.priority')} full options={(['low', 'normal', 'high'] as const).map((p) => ({ value: p, label: t(`ticket.priority.${p}`) }))} />
            </Field>
          </div>
          <Field label={t('support.field.subject')} htmlFor="tk-subject">
            <TextInput id="tk-subject" value={subject} onChange={setSubject} maxLength={100} data-autofocus data-testid="tk-subject" />
          </Field>
          <Field label={t('support.field.body')} htmlFor="tk-body" hint={category === 'gameplay_bug' ? t('support.field.body_hint_bug') : t('support.field.body_hint')}>
            <TextArea id="tk-body" value={body} onChange={setBody} rows={5} />
          </Field>
        </div>
      </Dialog>

      <Dialog open={doc !== null} onClose={() => setDoc(null)} title={doc ? t(`support.doc.${doc}.title`) : ''} size="md">
        {doc && <p className="text-[14px] leading-relaxed whitespace-pre-line text-ink-2">{t(`support.doc.${doc}.body`)}</p>}
      </Dialog>
      <TicketDialog ticketId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function QuickAction({ icon, title, onClick }: { icon: ReactNode; title: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-2.5 rounded-inner border border-line bg-surface px-3.5 py-3 text-start text-[13.5px] font-medium text-ink hover:border-line-strong">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent [&>svg]:size-4">{icon}</span>
      {title}
    </button>
  );
}
