import { useState, type ReactNode } from 'react';
import { act } from '../app/context.ts';
import { dateShort } from '../app/format.ts';
import { useDb, useMe, useSettings, useT } from '../app/hooks.ts';
import { setLanguage } from '../app/shells.tsx';
import { LANGUAGES } from '../i18n/index.ts';
import * as api from '../platform/api.ts';
import { NOTIFICATION_PREFS, type DeckTheme, type Lang, type TableThemeId, type UserSettings } from '../platform/types.ts';
import { parseCards } from '../engine/cards.ts';
import { CardBack, PlayingCard } from '../table/Card.tsx';
import { Button, cx, Notice, PageHeader, Panel } from '../ui/core.tsx';
import { Field, Segmented, Select, Slider, Switch, TextInput } from '../ui/forms.tsx';
import { Avatar } from '../ui/identity.tsx';

const THEMES: (TableThemeId | 'club')[] = ['club', 'midnight', 'emerald', 'royal', 'burgundy', 'graphite'];
const SAMPLE = parseCards('As Kh Qd Jc');

export function Settings() {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const settings = useSettings();
  const [name, setName] = useState(me.name);
  const [handle, setHandle] = useState(me.handle);
  const set = (patch: Partial<UserSettings>) => act(() => api.updateSettings(db, me.id, patch));
  const onBreak = api.onBreak(db, me.id);
  const dirty = name !== me.name || handle !== me.handle;

  return (
    <div className="max-w-[760px]">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <div className="space-y-4">
        <Section title={t('settings.profile')}>
          <div className="flex items-center gap-4">
            <Avatar user={me} size={60} />
            <div className="min-w-0 flex-1">
              <Field label={t('settings.avatar_colour')} htmlFor="set-hue">
                <Slider id="set-hue" value={me.hue} onChange={(hue) => act(() => api.updateProfile(db, me.id, { hue }))} min={0} max={359} label={t('settings.avatar_colour')} />
              </Field>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('settings.display_name')} htmlFor="set-name">
              <TextInput id="set-name" value={name} onChange={setName} />
            </Field>
            <Field label={t('settings.username')} htmlFor="set-handle" hint={t('settings.username_hint')}>
              <TextInput id="set-handle" value={handle} onChange={setHandle} dir="ltr" />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" disabled={!dirty} onClick={() => act(() => api.updateProfile(db, me.id, { name, handle }), { key: 'settings.saved' })} data-testid="save-profile">
              {t('common.save')}
            </Button>
          </div>
        </Section>

        <Section title={t('settings.language')} hint={t('settings.language_hint')}>
          <Segmented<Lang> value={settings.lang} onChange={setLanguage} label={t('settings.language')} options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))} />
        </Section>

        <Section title={t('settings.table')}>
          <Field label={t('settings.table_theme')} htmlFor="set-theme">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" role="radiogroup" aria-label={t('settings.table_theme')}>
              {THEMES.map((theme) => (
                <button
                  key={theme}
                  type="button"
                  role="radio"
                  aria-checked={settings.tableTheme === theme}
                  onClick={() => set({ tableTheme: theme })}
                  className={cx('rounded-inner border p-1.5 text-center text-[11.5px] transition-colors', settings.tableTheme === theme ? 'border-accent text-ink' : 'border-line text-ink-2 hover:border-line-strong')}
                >
                  <span className={cx('pc-rail mb-1.5 block h-9 rounded-full p-[3px]', `felt-${theme === 'club' ? 'midnight' : theme}`)}>
                    <span className={cx('pc-felt block size-full rounded-full', theme === 'club' && 'opacity-60')} />
                  </span>
                  {t(`theme.${theme}`)}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t('settings.deck')} htmlFor="set-deck">
            <div className="flex flex-wrap items-center gap-4">
              <Segmented<DeckTheme>
                value={settings.deck}
                onChange={(deck) => set({ deck })}
                label={t('settings.deck')}
                options={[
                  { value: 'four_color', label: t('settings.deck.four_color') },
                  { value: 'classic', label: t('settings.deck.classic') },
                ]}
              />
              <span className={cx('flex gap-1.5', settings.deck === 'four_color' && 'deck-four')} dir="ltr" aria-hidden>
                {SAMPLE.map((c) => (
                  <PlayingCard key={c} card={c} width={34} />
                ))}
                <CardBack width={34} />
              </span>
            </div>
          </Field>
          <Switch checked={settings.showBigBlinds} onChange={(v) => set({ showBigBlinds: v })} label={t('settings.show_bb')} description={t('settings.show_bb_hint')} />
          <Switch checked={settings.confirmLargeBets} onChange={(v) => set({ confirmLargeBets: v })} label={t('settings.confirm_large')} description={t('settings.confirm_large_hint')} />
          <Field label={t('settings.turn_time')} htmlFor="set-turn" hint={t('settings.turn_time_hint')}>
            <Select
              id="set-turn"
              value={String(settings.turnSeconds)}
              onChange={(v) => set({ turnSeconds: Number(v) })}
              className="w-40"
              options={[15, 20, 25, 30, 45].map((n) => ({ value: String(n), label: t('settings.seconds_n', { n }) }))}
            />
          </Field>
        </Section>

        <Section title={t('settings.motion_sound')}>
          <Switch checked={settings.animations === 'reduced'} onChange={(v) => set({ animations: v ? 'reduced' : 'full' })} label={t('settings.reduce_motion')} description={t('settings.reduce_motion_hint')} />
          <Switch checked={settings.sound} onChange={(v) => set({ sound: v })} label={t('settings.sound')} description={t('settings.sound_hint')} />
        </Section>

        <Section title={t('settings.notifications')}>
          <p className="text-[12.5px] leading-relaxed text-ink-3">{t('settings.notif.note')}</p>
          {NOTIFICATION_PREFS.map((pref) => (
            <Switch
              key={pref}
              id={`notif-${pref}`}
              checked={settings.notifications[pref]}
              onChange={(v) => set({ notifications: { ...settings.notifications, [pref]: v } })}
              label={t(`settings.notif.${pref}`)}
              description={t(`settings.notif.${pref}_hint`)}
            />
          ))}
        </Section>

        <Section title={t('settings.channels')} hint={t('settings.channels_hint')}>
          <Notice tone="warning">{t('settings.channels_demo')}</Notice>
          {(['email', 'sms', 'whatsapp', 'push'] as const).map((c) => (
            <Switch key={c} id={`channel-${c}`} checked={!!settings.channels?.[c]} onChange={(v) => set({ channels: { ...(settings.channels ?? {}), [c]: v } })} label={t(`settings.channel.${c}`)} description={t('settings.channel_simulated')} />
          ))}
        </Section>

        <Section title={t('settings.responsible')} hint={t('settings.responsible_hint')}>
          <Field label={t('settings.session_reminder')} hint={t('settings.session_reminder_hint')}>
            <Segmented value={String(settings.responsible?.sessionReminderMin ?? 0)} onChange={(v) => set({ responsible: { ...(settings.responsible ?? { sessionReminderMin: 0, breakUntil: null, dailyMinutes: 0 }), sessionReminderMin: Number(v) } })} label={t('settings.session_reminder')} options={[{ value: '0', label: t('settings.off') }, { value: '30', label: '30′' }, { value: '60', label: '60′' }, { value: '90', label: '90′' }]} />
          </Field>
          {onBreak ? (
            <Notice tone="info" action={<Button size="sm" onClick={() => act(() => api.setBreak(db, me.id, 0), { key: 'settings.break_ended' })} data-testid="break-end">{t('settings.break_end')}</Button>}>
              {t('settings.break_active', { date: dateShort(settings.responsible!.breakUntil!, t.lang) })}
            </Notice>
          ) : (
            <Field label={t('settings.break')} hint={t('settings.break_hint')}>
              <div className="flex flex-wrap gap-2">
                {[1, 7, 30].map((d) => (
                  <Button key={d} size="sm" onClick={() => act(() => api.setBreak(db, me.id, d), { key: 'settings.break_started' })} data-testid={`break-${d}`}>
                    {t('settings.break_days', { n: d })}
                  </Button>
                ))}
              </div>
            </Field>
          )}
        </Section>

        <Section title={t('settings.privacy')}>
          <Notice tone="neutral">{t('settings.privacy_note')}</Notice>
          <Switch checked={settings.privacy.showProfile} onChange={(v) => set({ privacy: { ...settings.privacy, showProfile: v } })} label={t('settings.privacy.profile')} description={t('settings.privacy.profile_hint')} />
          <Switch checked={settings.privacy.showStats} onChange={(v) => set({ privacy: { ...settings.privacy, showStats: v } })} label={t('settings.privacy.stats')} description={t('settings.privacy.stats_hint')} />
        </Section>

        <Section title={t('settings.accessibility')}>
          <Switch checked={settings.highContrast} onChange={(v) => set({ highContrast: v })} label={t('settings.high_contrast')} description={t('settings.high_contrast_hint')} />
        </Section>

        <Section title={t('settings.security')}>
          <Notice tone="neutral">{t('settings.security_note')}</Notice>
          <ul className="space-y-2 text-[13.5px] text-ink-2">
            <li className="flex items-center justify-between gap-3 rounded-inner border border-line px-3.5 py-2.5">
              <span>{t('settings.security.password')}</span>
              <span className="text-[12px] text-ink-3">{t('common.not_in_prototype')}</span>
            </li>
            <li className="flex items-center justify-between gap-3 rounded-inner border border-line px-3.5 py-2.5">
              <span>{t('settings.security.two_factor')}</span>
              <span className="text-[12px] text-ink-3">{t('common.not_in_prototype')}</span>
            </li>
            <li className="flex items-center justify-between gap-3 rounded-inner border border-line px-3.5 py-2.5">
              <span>{t('settings.security.sessions')}</span>
              <span className="text-[12px] text-ink-3">{t('common.not_in_prototype')}</span>
            </li>
          </ul>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Panel>
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {hint && <p className="mt-0.5 text-[12.5px] text-ink-3">{hint}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </Panel>
  );
}
