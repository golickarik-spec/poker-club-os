import { useState } from 'react';
import { LuCheck, LuMinus, LuShieldCheck, LuUserPlus } from 'react-icons/lu';
import { act } from '../app/context.ts';
import { useDb, useMe, useT } from '../app/hooks.ts';
import * as api from '../platform/api.ts';
import { activeRole, ALL_PERMISSIONS, can, canAssignRole, ROLE_PERMISSIONS, ROLE_RANK } from '../platform/permissions.ts';
import { ROLES, type Club, type Role } from '../platform/types.ts';
import { Badge, BotTag, Button, cx, Notice, PageHeader, Panel, PanelHeader } from '../ui/core.tsx';
import { Field, Select, TextInput } from '../ui/forms.tsx';
import { Avatar } from '../ui/identity.tsx';
import { Dialog } from '../ui/overlay.tsx';
import { UsageMeters } from '../shared/plans.tsx';
import { TableShell, Td, Th } from './shared.tsx';

export function Roles({ club }: { club: Club }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const mine = activeRole(db, me.id, club.id);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [newRole, setNewRole] = useState<Role>('support_agent');
  const [pick, setPick] = useState('');
  // Guarded reads: only this club's staff get the lists.
  const staff = api.listStaff(db, me.id, club.id);
  const canAssign = can(db, me.id, 'members.assign_roles', club.id);
  const assignable = (['manager', 'tournament_manager', 'support_agent'] as Role[]).filter((r) => ROLE_RANK[r] < (mine ? ROLE_RANK[mine] : 0));
  const q = search.trim().toLowerCase();
  const candidates = adding && q.length >= 2 ? api.listApprovedMembers(db, me.id, club.id).filter((m) => m.membership.role === 'player' && (m.user.name.toLowerCase().includes(q) || m.user.handle.toLowerCase().includes(q))).slice(0, 6) : [];
  const order = ['owner', 'manager', 'tournament_manager', 'support_agent'] as const;
  staff.sort((a, b) => order.indexOf(a.membership.role as (typeof order)[number]) - order.indexOf(b.membership.role as (typeof order)[number]));
  return (
    <>
      <PageHeader title={t('roles.title')} subtitle={t('roles.subtitle')} />
      <Notice tone="info" icon={<LuShieldCheck />} className="mb-5">
        {t('roles.enforced')}
      </Notice>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel pad={false}>
          <TableShell minWidth={680}>
            <thead>
              <tr>
                <Th>{t('roles.permission')}</Th>
                {ROLES.map((role) => (
                  <Th key={role} className="text-center">
                    <span className={cx(role === mine && 'text-accent')}>{t(`role.${role}`)}</span>
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_PERMISSIONS.map((perm) => (
                <tr key={perm} className="border-b border-line last:border-0">
                  <Td>
                    <span className="block text-ink">{t(`perm.${perm}`)}</span>
                  </Td>
                  {ROLES.map((role) => {
                    const has = ROLE_PERMISSIONS[role].includes(perm);
                    return (
                      <Td key={role} className={cx('text-center', role === mine && 'bg-accent/[0.06]')}>
                        {has ? <LuCheck className="mx-auto size-4 text-accent" aria-label={t('common.yes')} /> : <LuMinus className="mx-auto size-4 text-ink-3/50" aria-label={t('common.no')} />}
                      </Td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Panel>
        <Panel className="self-start">
          <PanelHeader
            title={t('roles.staff')}
            hint={t('roles.staff_hint')}
            action={
              canAssign ? (
                <Button size="sm" icon={<LuUserPlus className="size-4" aria-hidden />} onClick={() => setAdding(true)} data-testid="staff-add">
                  {t('roles.add_staff')}
                </Button>
              ) : undefined
            }
          />
          <ul className="space-y-2.5" data-testid="staff-list">
            {staff.map(({ user, membership }) => {
              const editable = canAssign && canAssignRole(db, me.id, club.id, user.id, 'player');
              return (
                <li key={user.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  <Avatar user={user} size={30} />
                  <span className="min-w-[8rem] flex-1">
                    <span className="flex items-center gap-1.5 text-[13.5px] font-medium text-ink">
                      <span className="truncate">{user.name}</span>
                      {user.isBot && <BotTag label={t('common.bot')} />}
                    </span>
                  </span>
                  {editable ? (
                    <Select<Role>
                      value={membership.role}
                      onChange={(role) => act(() => api.setMemberRole(db, me.id, club.id, user.id, role), { key: 'members.role_changed' })}
                      className="h-8 w-auto max-w-full text-[12.5px]"
                      aria-label={t('members.change_role', { name: user.name })}
                      options={ROLES.filter((r) => r !== 'owner').map((r) => ({ value: r, label: t(`role.${r}`), disabled: !canAssignRole(db, me.id, club.id, user.id, r) && r !== membership.role }))}
                    />
                  ) : (
                    <Badge tone={membership.role === 'owner' ? 'gold' : 'accent'}>{t(`role.${membership.role}`)}</Badge>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-4 border-t border-line pt-3">
            <UsageMeters club={club} compact />
          </div>
        </Panel>
      </div>
      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title={t('roles.add_staff')}
        description={t('roles.add_staff_hint')}
        footer={
          <Button
            variant="primary"
            disabled={!pick}
            data-testid="staff-add-confirm"
            onClick={() => {
              if (act(() => api.setMemberRole(db, me.id, club.id, pick, newRole), { key: 'members.role_changed' }) !== undefined) {
                setAdding(false);
                setPick('');
                setSearch('');
              }
            }}
          >
            {t('common.confirm')}
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label={t('roles.find_member')} htmlFor="staff-search">
            <TextInput id="staff-search" type="search" value={search} onChange={setSearch} placeholder={t('members.search')} data-autofocus />
          </Field>
          {candidates.length > 0 && (
            <ul className="divide-y divide-line rounded-inner border border-line">
              {candidates.map(({ user }) => (
                <li key={user.id}>
                  <button type="button" onClick={() => setPick(user.id)} aria-pressed={pick === user.id} className={cx('flex w-full items-center gap-2.5 px-3 py-2 text-start hover:bg-raised/60', pick === user.id && 'bg-accent/10')}>
                    <Avatar user={user} size={28} />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{user.name}</span>
                    {user.isBot && <BotTag label={t('common.bot')} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Field label={t('members.col.role')} htmlFor="staff-role">
            <Select<Role> id="staff-role" value={newRole} onChange={setNewRole} options={assignable.map((r) => ({ value: r, label: t(`role.${r}`) }))} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
