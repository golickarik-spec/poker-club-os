import { useEffect, useMemo, useRef, useState } from 'react';
import { chips } from '../app/format.ts';
import { useT } from '../app/hooks.ts';
import type { LegalActions, PlayerAction } from '../engine/holdem.ts';
import { cx } from '../ui/core.tsx';
import { NumberInput, Slider } from '../ui/forms.tsx';
import { betStep } from './text.tsx';

interface Props {
  legal: LegalActions;
  bb: number;
  /** Turn deadline info for the countdown. */
  startedAt: number;
  durationMs: number;
  confirmLarge: boolean;
  onAct: (action: PlayerAction) => void;
  compact: boolean;
}

const ACTION_BUTTON =
  'flex h-[52px] min-w-0 flex-1 flex-col items-center justify-center rounded-inner px-2 text-[15px] font-semibold leading-tight transition-[filter,transform] active:scale-[0.98] sm:h-14 sm:min-w-[132px] sm:flex-none sm:px-5';

export function ActionBar({ legal, bb, startedAt, durationMs, confirmLarge, onAct, compact }: Props) {
  const t = useT();
  const canRaise = legal.canBet || legal.canRaise;
  const step = betStep(bb);
  const [amount, setAmount] = useState(legal.minTo);
  const [sizing, setSizing] = useState(false);
  const [pending, setPending] = useState<PlayerAction | null>(null);
  const [left, setLeft] = useState(durationMs);
  const amountRef = useRef(amount);
  amountRef.current = amount;

  // A new decision: reset the controls.
  useEffect(() => {
    setAmount(legal.minTo);
    setSizing(false);
    setPending(null);
  }, [legal.seat, legal.minTo, legal.maxTo, legal.callAmount, legal.currentBet]);

  useEffect(() => {
    const tick = () => setLeft(Math.max(0, startedAt + durationMs - Date.now()));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [startedAt, durationMs]);

  const clampTo = (value: number): number => {
    if (!Number.isFinite(value)) return legal.minTo;
    let v = Math.round(value / step) * step;
    if (v >= legal.maxTo - step / 2) v = legal.maxTo;
    return Math.min(legal.maxTo, Math.max(legal.minTo, v));
  };

  const presets = useMemo(() => {
    const potAfterCall = legal.pot + legal.callAmount;
    const sized = (fraction: number) => clampTo(legal.currentBet + fraction * potAfterCall);
    const list: { id: string; label: string; to: number }[] = [
      { id: 'min', label: t('table.size.min'), to: legal.minTo },
      { id: 'half', label: '½', to: sized(0.5) },
      { id: 'two_thirds', label: '⅔', to: sized(2 / 3) },
      { id: 'pot', label: t('table.size.pot'), to: sized(1) },
      { id: 'allin', label: t('table.size.allin'), to: legal.maxTo },
    ];
    // Pot-limit: the pot is the largest legal size, so "all in" would duplicate it (or be illegal).
    if (legal.maxTo <= sized(1)) return list.filter((p) => p.id !== 'allin');
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legal.pot, legal.callAmount, legal.currentBet, legal.minTo, legal.maxTo, step, t]);

  const submit = (action: PlayerAction, force = false) => {
    if (!force && confirmLarge) {
      const committing =
        action.type === 'call' ? legal.callAmount >= legal.stack * 0.6 && legal.callAmount >= bb * 10 : (action.type === 'bet' || action.type === 'raise') && (action.amount ?? 0) >= legal.maxTo * 0.6 && legal.maxTo >= bb * 10;
      if (committing) {
        setPending(action);
        return;
      }
    }
    setPending(null);
    onAct(action);
  };

  const raise = () => {
    if (compact && !sizing) {
      setSizing(true);
      return;
    }
    submit({ type: legal.currentBet === 0 ? 'bet' : 'raise', amount: clampTo(amountRef.current) });
  };

  // Keyboard shortcuts for desktop play.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (pending) {
        if (key === 'escape') setPending(null);
        if (key === 'enter') submit(pending, true);
        return;
      }
      if (key === 'f' && !legal.canCheck) submit({ type: 'fold' });
      else if (key === 'c') submit({ type: legal.canCheck ? 'check' : 'call' });
      else if (key === 'r' && canRaise) raise();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const seconds = Math.ceil(left / 1000);
  const urgent = left < Math.min(8000, durationMs * 0.3);
  const raiseTo = clampTo(amount);
  const isAllIn = raiseTo >= legal.streetBet + legal.stack;
  const raiseLabel = isAllIn ? t('table.act.allin') : legal.currentBet === 0 ? t('table.act.bet') : t('table.act.raise_to');
  const callIsAllIn = legal.canCall && legal.callAmount >= legal.stack;

  if (pending) {
    const amountText = pending.type === 'call' ? chips(legal.callAmount) : chips(pending.amount ?? 0);
    const share = Math.round(((pending.type === 'call' ? legal.callAmount : (pending.amount ?? 0) - legal.streetBet) / Math.max(1, legal.stack)) * 100);
    return (
      <div className="flex flex-wrap items-center justify-center gap-3" role="alertdialog" aria-label={t('table.confirm.title')}>
        <p className="min-w-0 text-center text-sm text-ink">
          {t('table.confirm.body', { action: pending.type === 'call' ? t('table.act.call') : raiseLabel, amount: amountText, share })}
          <span className={cx('ms-2 tabular-nums', urgent ? 'text-danger' : 'text-ink-3')}>{seconds}s</span>
        </p>
        <div className="flex gap-2">
          <button type="button" className={cx(ACTION_BUTTON, 'h-12 bg-raised text-ink hover:brightness-125 sm:h-12')} onClick={() => setPending(null)}>
            {t('common.back')}
          </button>
          <button type="button" data-testid="act-confirm" className={cx(ACTION_BUTTON, 'h-12 bg-danger text-white hover:brightness-110 sm:h-12')} onClick={() => submit(pending, true)}>
            {t('table.confirm.yes')}
          </button>
        </div>
      </div>
    );
  }

  // Fixed-limit (or a stack too short to choose): one size, no slider.
  const singleSize = legal.fixed || legal.minTo >= legal.maxTo;
  const sizingPanel = canRaise && !singleSize && (
    <div className={cx('flex min-w-0 flex-col gap-2', compact ? 'w-full' : 'w-[360px]')}>
      <div className="flex gap-1.5">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            data-testid={`size-${p.id}`}
            onClick={() => setAmount(p.to)}
            className={cx(
              'h-9 min-w-0 flex-1 rounded-control border px-1 text-[12.5px] font-medium tabular-nums transition-colors',
              raiseTo === p.to ? 'border-accent bg-accent/15 text-ink' : 'border-line-strong/70 bg-raised text-ink-2 hover:text-ink',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <Slider value={raiseTo} onChange={(v) => setAmount(clampTo(v))} min={legal.minTo} max={legal.maxTo} step={step} label={t('table.size.slider')} id="bet-slider" />
        </div>
        <NumberInput value={amount} onChange={setAmount} min={legal.minTo} max={legal.maxTo} step={step} aria-label={t('table.size.amount')} id="bet-amount" className="w-[104px] shrink-0" />
      </div>
    </div>
  );

  return (
    <div className={cx('flex w-full items-end justify-center gap-3', compact && 'flex-col items-stretch gap-2')}>
      {compact ? sizing && <div className="animate-rise">{sizingPanel}</div> : sizingPanel}
      <div className="flex min-w-0 items-stretch gap-2">
        {!legal.canCheck && (
          <button type="button" data-testid="act-fold" className={cx(ACTION_BUTTON, 'bg-[#3a2228] text-[#ffb3b8] hover:brightness-125')} onClick={() => submit({ type: 'fold' })}>
            {t('table.act.fold')}
            {!compact && <kbd className="text-[10px] font-normal opacity-50">F</kbd>}
          </button>
        )}
        {legal.canCheck ? (
          <button type="button" data-testid="act-check" className={cx(ACTION_BUTTON, 'bg-[#1f3a56] text-white hover:brightness-125')} onClick={() => submit({ type: 'check' })}>
            {t('table.act.check')}
            {!compact && <kbd className="text-[10px] font-normal opacity-50">C</kbd>}
          </button>
        ) : (
          <button type="button" data-testid="act-call" className={cx(ACTION_BUTTON, 'bg-[#1f4f7d] text-white hover:brightness-125')} onClick={() => submit({ type: 'call' })}>
            <span>{callIsAllIn ? t('table.act.call_allin') : t('table.act.call')}</span>
            <span className="text-[13px] font-medium tabular-nums opacity-85">{chips(legal.callAmount)}</span>
          </button>
        )}
        {canRaise && (
          <button type="button" data-testid="act-raise" className={cx(ACTION_BUTTON, isAllIn && (!compact || sizing) ? 'bg-danger text-white' : 'bg-accent text-accent-ink', 'hover:brightness-110')} onClick={raise}>
            {compact && !sizing ? (
              <span>{legal.currentBet === 0 ? t('table.act.bet') : t('table.act.raise')}</span>
            ) : (
              <>
                <span>{raiseLabel}</span>
                <span className="text-[13px] font-medium tabular-nums opacity-85">{chips(raiseTo)}</span>
              </>
            )}
          </button>
        )}
        <div
          className={cx('flex w-12 shrink-0 flex-col items-center justify-center rounded-inner border text-[15px] font-semibold tabular-nums', urgent ? 'border-danger/50 text-danger' : 'border-line-strong/60 text-ink-2')}
          role="timer"
          aria-label={t('table.time_left')}
        >
          {seconds}
          <span className="text-[9px] font-normal opacity-70">{t('table.sec')}</span>
        </div>
      </div>
    </div>
  );
}
