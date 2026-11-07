/** Application singletons: database, tournament runtime, session, toasts. */
import { hasMessage, translate, type Params } from '../i18n/index.ts';
import { Runtime } from '../platform/runtime.ts';
import { Store } from '../platform/store.ts';
import { DomainError } from '../platform/types.ts';
import { Session } from './session.ts';

export const store = new Store({ persist: true });
export const runtime = new Runtime(store, { persist: true });
export const session = new Session(true);

// If the saved session points at something that no longer exists (data was reseeded), start over.
if (session.state.userId && !store.db.users[session.state.userId]) session.reset();

// ----- toasts -----
export interface Toast {
  id: number;
  tone: 'success' | 'error' | 'info';
  text: string;
}
type Listener = () => void;
let toastSeq = 0;
export const toasts = {
  items: [] as Toast[],
  version: 0,
  listeners: new Set<Listener>(),
  subscribe(l: Listener): () => void {
    toasts.listeners.add(l);
    return () => toasts.listeners.delete(l);
  },
  getVersion: (): number => toasts.version,
  push(tone: Toast['tone'], text: string): void {
    const id = ++toastSeq;
    toasts.items = [...toasts.items.slice(-2), { id, tone, text }];
    toasts.emit();
    setTimeout(() => toasts.dismiss(id), tone === 'error' ? 6000 : 3600);
  },
  dismiss(id: number): void {
    const next = toasts.items.filter((t) => t.id !== id);
    if (next.length !== toasts.items.length) {
      toasts.items = next;
      toasts.emit();
    }
  },
  emit(): void {
    toasts.version += 1;
    for (const l of toasts.listeners) l();
  },
};

/** Human-readable text for an error, translated when the code is known. */
export function errorText(err: unknown): string {
  const lang = session.state.lang;
  if (err instanceof DomainError) {
    const key = `err.${err.code}`;
    return hasMessage(key) ? translate(lang, key) : err.message;
  }
  return translate(lang, 'err.unexpected');
}

/**
 * Run a state-changing action. Domain errors (validation, permissions) become
 * an error toast and `undefined` is returned; anything else is a bug and is
 * rethrown for the error boundary.
 */
export const actions = { count: 0 };

export function act<T>(fn: () => T, success?: { key: string; params?: Params }): T | undefined {
  try {
    const result = fn();
    // Lets screens that cache a report know a person just changed something and they should recompute now.
    actions.count += 1;
    store.touch();
    runtime.touch();
    if (success) toasts.push('success', translate(session.state.lang, success.key, success.params));
    return result;
  } catch (err) {
    if (err instanceof DomainError) {
      toasts.push('error', errorText(err));
      return undefined;
    }
    throw err;
  }
}

export function resetDemo(): void {
  runtime.driver?.dispose();
  runtime.driver = null;
  store.reset();
  runtime.reset();
  session.reset();
  toasts.push('info', translate(session.state.lang, 'demo.reset_done'));
}

runtime.start();

// Persist on the way out, and keep state across live updates of the hosted page.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    store.save();
    runtime.save();
  });
}
