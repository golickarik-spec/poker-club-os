import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { translate, translateCount, type Params } from '../i18n/index.ts';
import { DEFAULT_SETTINGS } from '../platform/seed.ts';
import type { DB, Lang, User, UserSettings } from '../platform/types.ts';
import { runtime, session, store, toasts, type Toast } from './context.ts';
import type { RouteName, SessionState } from './session.ts';

/** The database. Re-renders the caller whenever anything in it changes. */
export function useDb(): DB {
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  return store.db;
}

export function useSession(): SessionState {
  useSyncExternalStore(session.subscribe, session.getVersion, session.getVersion);
  return session.state;
}

export function useMe(): User | null {
  const db = useDb();
  const { userId } = useSession();
  return userId ? (db.users[userId] ?? null) : null;
}

export function useSettings(): UserSettings {
  const db = useDb();
  const { userId, lang } = useSession();
  const settings = userId ? db.settings[userId] : undefined;
  return settings ?? { ...DEFAULT_SETTINGS, lang };
}

export function useLang(): Lang {
  return useSession().lang;
}

export interface T {
  (key: string, params?: Params): string;
  n: (key: string, count: number, params?: Params) => string;
  lang: Lang;
}

export function useT(): T {
  const lang = useLang();
  const ref = useRef<T | null>(null);
  if (!ref.current || ref.current.lang !== lang) {
    const t = ((key: string, params?: Params) => translate(lang, key, params)) as T;
    t.n = (key, count, params) => translateCount(lang, key, count, params);
    t.lang = lang;
    ref.current = t;
  }
  return ref.current;
}

export function useToasts(): Toast[] {
  useSyncExternalStore(toasts.subscribe, toasts.getVersion, toasts.getVersion);
  return toasts.items;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/**
 * Read something from the tournament runtime. The selector runs on every
 * runtime tick, but the component only re-renders when its result changes
 * (shallow comparison), so a clock that ticks four times a second does not
 * repaint lists that show whole seconds.
 */
export function useRuntime<R>(selector: () => R): R {
  const cache = useRef<{ version: number; value: R } | null>(null);
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const getSnapshot = useCallback((): R => {
    const version = runtime.getVersion() * 1_000_003 + store.getVersion();
    const cached = cache.current;
    if (cached && cached.version === version) return cached.value;
    const value = selectorRef.current();
    if (cached && shallowEqual(cached.value, value)) {
      cache.current = { version, value: cached.value };
      return cached.value;
    }
    cache.current = { version, value };
    return value;
  }, []);
  const subscribe = useCallback((cb: () => void) => {
    const a = runtime.subscribe(cb);
    const b = store.subscribe(cb);
    return () => {
      a();
      b();
    };
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Current time, refreshed on an interval (for countdowns). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/** Size of an element, tracked with a ResizeObserver. */
export function useElementSize<E extends HTMLElement>(): [(el: E | null) => void, { width: number; height: number }] {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: E | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((prev) => (Math.abs(prev.width - r.width) < 0.5 && Math.abs(prev.height - r.height) < 0.5 ? prev : { width: r.width, height: r.height }));
    };
    measure();
    observer.current = new ResizeObserver(measure);
    observer.current.observe(el);
  }, []);
  return [ref, size];
}

export const go = (name: RouteName, params: Record<string, string> = {}, options?: { replace?: boolean }): void =>
  session.navigate(name, params, options);
