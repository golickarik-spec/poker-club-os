/**
 * In-memory database with change notification and best-effort persistence.
 *
 * `store.mutate(fn)` is the only way application code changes data; it bumps a
 * version number that React subscribes to. Persistence uses localStorage when
 * it is available and silently does without when it is not (private windows,
 * embedded previews), so the app never depends on it.
 */
import { createSeedDb, SCHEMA_VERSION } from './seed.ts';
import type { DB } from './types.ts';

const DB_KEY = `pcos.db.v${SCHEMA_VERSION}`;
/** Seeded schedules are relative to the moment of seeding; after this long the demo starts fresh. */
const STALE_AFTER_MS = 8 * 3_600_000;

export function readStorage<T>(key: string): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: unknown): boolean {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeStorage(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* ignore */
  }
}

type Listener = () => void;

export class Store {
  db: DB;
  version = 0;
  /** True when the database was restored from a previous visit rather than freshly seeded. */
  restored = false;
  private listeners = new Set<Listener>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persist: boolean;

  constructor(options: { persist?: boolean; now?: number } = {}) {
    this.persist = options.persist ?? false;
    const now = options.now ?? Date.now();
    const saved = this.persist ? readStorage<DB>(DB_KEY) : null;
    if (saved && saved.schema === SCHEMA_VERSION && now - saved.seededAt < STALE_AFTER_MS) {
      this.db = saved;
      this.restored = true;
    } else {
      this.db = createSeedDb(now);
    }
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  /** Apply a change. If `fn` throws, nothing is notified and the error propagates. */
  mutate<T>(fn: (db: DB) => T): T {
    const result = fn(this.db);
    this.touch();
    return result;
  }

  /** Notify subscribers after a direct change to `db`. */
  touch(): void {
    this.version += 1;
    for (const l of this.listeners) l();
    if (this.persist && !this.persistTimer) {
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null;
        this.save();
      }, 800);
    }
  }

  save(): void {
    if (!this.persist) return;
    if (!writeStorage(DB_KEY, this.db)) {
      // Most likely a quota problem caused by uploaded images: retry without them.
      const slim = structuredClone(this.db);
      for (const id in slim.clubs) {
        const b = slim.clubs[id]!.branding;
        if (b.logo.kind === 'image') b.logo = { kind: 'monogram', text: slim.clubs[id]!.name.slice(0, 2).toUpperCase() };
        if (b.cover.kind === 'image') b.cover = { kind: 'pattern', pattern: 'grid' };
      }
      writeStorage(DB_KEY, slim);
    }
  }

  /** Throw away everything and reseed the demo. */
  reset(now: number = Date.now()): void {
    removeStorage(DB_KEY);
    this.db = createSeedDb(now);
    this.restored = false;
    this.touch();
  }
}
