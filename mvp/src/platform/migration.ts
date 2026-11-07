/**
 * Migration assistant (v0.4): bring a club's existing member list in from a CSV without
 * inventing accounts. Each row becomes an *imported record* the club keeps; when a real person
 * later requests membership with the same email (or claims the record by invitation), the
 * record is attached to them — member number, tags and the original joining date come along.
 * Nothing here signs anyone up, and imported people never appear as players.
 */
import { audit, clock, fail, newId } from './core.ts';
import { requirePermission } from './permissions.ts';
import type { DB, ImportedRecord, TagColor } from './types.ts';

export type ImportField = 'name' | 'email' | 'memberNo' | 'joinedAt' | 'tags' | 'note' | 'phone' | 'ignore';
export const IMPORT_FIELDS: readonly ImportField[] = ['name', 'email', 'memberNo', 'joinedAt', 'tags', 'note', 'phone', 'ignore'];

const SYNONYMS: Record<Exclude<ImportField, 'ignore'>, string[]> = {
  name: ['name', 'full name', 'fullname', 'player', 'member', 'שם', 'שם מלא', 'שחקן'],
  email: ['email', 'e-mail', 'mail', 'אימייל', 'דוא"ל', 'דואל', 'מייל'],
  memberNo: ['member no', 'member number', 'memberno', 'number', '#', 'id', 'מספר', 'מספר חבר'],
  joinedAt: ['joined', 'joined at', 'join date', 'since', 'member since', 'date', 'הצטרף', 'תאריך הצטרפות', 'מאז'],
  tags: ['tags', 'tag', 'labels', 'group', 'groups', 'תגיות', 'תגית', 'קבוצה'],
  note: ['note', 'notes', 'comment', 'comments', 'הערה', 'הערות'],
  phone: ['phone', 'mobile', 'tel', 'telephone', 'טלפון', 'נייד'],
};

/** RFC-4180-ish CSV: quoted fields, doubled quotes, commas or semicolons or tabs. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].map((d) => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0]!.d;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

export function guessMapping(header: string[]): ImportField[] {
  const used = new Set<ImportField>();
  return header.map((h) => {
    const key = h.trim().toLowerCase();
    for (const field of Object.keys(SYNONYMS) as (keyof typeof SYNONYMS)[]) {
      if (used.has(field)) continue;
      if (SYNONYMS[field].some((s) => key === s || key.startsWith(`${s} `) || key.includes(s))) {
        used.add(field);
        return field;
      }
    }
    return 'ignore';
  });
}

export interface ImportRow {
  line: number;
  name: string;
  email: string | null;
  memberNo: number | null;
  joinedAt: number | null;
  tags: string[];
  note: string | null;
  phone: string | null;
  problems: ('no_name' | 'bad_email' | 'duplicate_in_file' | 'already_member' | 'already_imported' | 'member_no_taken')[];
}

export interface ImportPreview {
  header: string[];
  mapping: ImportField[];
  rows: ImportRow[];
  importable: number;
  skipped: number;
}

const parseDate = (s: string): number | null => {
  const v = s.trim();
  if (!v) return null;
  const m = v.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const year = Number(y!.length === 2 ? `20${y}` : y);
    const ts = Date.UTC(year, Number(mo) - 1, Number(d));
    return Number.isFinite(ts) ? ts : null;
  }
  const ts = Date.parse(v);
  return Number.isFinite(ts) ? ts : null;
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function previewImport(db: DB, actorId: string, clubId: string, text: string, mappingOverride?: ImportField[]): ImportPreview {
  requirePermission(db, actorId, 'crm.configure', clubId);
  const table = parseCsv(text);
  if (table.length === 0) fail('empty_file', 'The file has no rows.');
  const header = table[0]!;
  const mapping = mappingOverride && mappingOverride.length === header.length ? mappingOverride : guessMapping(header);
  if (!mapping.includes('name')) fail('no_name_column', 'Could not find a name column. Map one in the table.');
  const existingEmails = new Map<string, string>();
  for (const m of db.memberships) {
    if (m.clubId !== clubId) continue;
    const u = db.users[m.userId];
    if (u?.email) existingEmails.set(u.email.toLowerCase(), u.id);
  }
  const imported = new Set(db.crm.imports.filter((r) => r.clubId === clubId && r.status === 'unclaimed').map((r) => (r.email ?? '').toLowerCase()).filter(Boolean));
  const takenNumbers = new Set<number>();
  for (const key in db.crm.profiles) {
    const p = db.crm.profiles[key]!;
    if (p.clubId === clubId && p.memberNo !== null) takenNumbers.add(p.memberNo);
  }
  for (const r of db.crm.imports) if (r.clubId === clubId && r.memberNo !== null) takenNumbers.add(r.memberNo);
  const seen = new Set<string>();
  const rows: ImportRow[] = table.slice(1, 2001).map((cells, i) => {
    const get = (f: ImportField): string => cells[mapping.indexOf(f)] ?? '';
    const email = get('email').toLowerCase() || null;
    const noRaw = get('memberNo').replace(/[^0-9]/g, '');
    const row: ImportRow = {
      line: i + 2,
      name: get('name').slice(0, 60),
      email,
      memberNo: noRaw ? Number(noRaw) : null,
      joinedAt: parseDate(get('joinedAt')),
      tags: get('tags').split(/[;,|]/).map((x) => x.trim()).filter(Boolean).slice(0, 6),
      note: get('note').slice(0, 500) || null,
      phone: get('phone').slice(0, 30) || null,
      problems: [],
    };
    if (!row.name) row.problems.push('no_name');
    if (email && !EMAIL.test(email)) row.problems.push('bad_email');
    const dedupeKey = email ?? `name:${row.name.toLowerCase()}`;
    if (seen.has(dedupeKey)) row.problems.push('duplicate_in_file');
    seen.add(dedupeKey);
    if (email && existingEmails.has(email)) row.problems.push('already_member');
    if (email && imported.has(email)) row.problems.push('already_imported');
    if (row.memberNo !== null && takenNumbers.has(row.memberNo)) row.problems.push('member_no_taken');
    return row;
  });
  const importable = rows.filter((r) => r.problems.length === 0).length;
  return { header, mapping, rows, importable, skipped: rows.length - importable };
}

/** Stores the clean rows as imported records. Rows with problems are skipped, never "fixed up". */
export function commitImport(db: DB, actorId: string, clubId: string, preview: ImportPreview, fileName = 'import.csv'): { imported: number; batchId: string } {
  requirePermission(db, actorId, 'crm.configure', clubId);
  const now = clock.now();
  const batchId = newId(db, 'imp');
  let imported = 0;
  for (const r of preview.rows) {
    if (r.problems.length > 0) continue;
    db.crm.imports.push({ id: newId(db, 'ir'), clubId, batchId, name: r.name, email: r.email, memberNo: r.memberNo, joinedAt: r.joinedAt, tags: r.tags, note: r.note, phone: r.phone, status: 'unclaimed', claimedBy: null, claimedAt: null, importedAt: now, importedBy: actorId, file: fileName });
    imported++;
  }
  audit(db, actorId, clubId, 'crm.imported', { count: imported, file: fileName });
  return { imported, batchId };
}

export function listImports(db: DB, actorId: string, clubId: string): ImportedRecord[] {
  requirePermission(db, actorId, 'members.view', clubId);
  return db.crm.imports.filter((r) => r.clubId === clubId).sort((a, b) => b.importedAt - a.importedAt || a.name.localeCompare(b.name));
}

export function deleteImport(db: DB, actorId: string, clubId: string, id: string): void {
  requirePermission(db, actorId, 'crm.configure', clubId);
  const i = db.crm.imports.findIndex((r) => r.id === id && r.clubId === clubId);
  if (i < 0) fail('not_found', 'Imported record not found.');
  if (db.crm.imports[i]!.status === 'claimed') fail('already_claimed', 'This record is attached to a member and stays as history.');
  db.crm.imports.splice(i, 1);
  audit(db, actorId, clubId, 'crm.import_removed', { count: 1 });
}

/** Deletes every unclaimed record of a batch (an undo for a wrong file). */
export function deleteBatch(db: DB, actorId: string, clubId: string, batchId: string): number {
  requirePermission(db, actorId, 'crm.configure', clubId);
  const before = db.crm.imports.length;
  db.crm.imports = db.crm.imports.filter((r) => !(r.clubId === clubId && r.batchId === batchId && r.status === 'unclaimed'));
  const n = before - db.crm.imports.length;
  audit(db, actorId, clubId, 'crm.import_removed', { count: n });
  return n;
}

const TAG_COLORS: TagColor[] = ['teal', 'blue', 'violet', 'orange', 'gold', 'green', 'slate', 'red'];

/**
 * Attaches an unclaimed record to a person who was just approved, matched by email. Returns
 * the record when one matched. Called from approval; staff can also attach one explicitly.
 */
export function claimImport(db: DB, clubId: string, userId: string, recordId?: string): ImportedRecord | null {
  const user = db.users[userId];
  if (!user) return null;
  const record = recordId ? db.crm.imports.find((r) => r.id === recordId && r.clubId === clubId && r.status === 'unclaimed') : db.crm.imports.find((r) => r.clubId === clubId && r.status === 'unclaimed' && r.email && r.email === user.email?.toLowerCase());
  if (!record) return null;
  const key = `${clubId}:${userId}`;
  const profile = db.crm.profiles[key];
  if (!profile) return null;
  const club = db.clubs[clubId]!;
  const now = clock.now();
  // Member number: keep the club's old numbering when it is still free.
  if (record.memberNo !== null) {
    const taken = Object.values(db.crm.profiles).some((p) => p.clubId === clubId && p.userId !== userId && p.memberNo === record.memberNo);
    if (!taken) {
      profile.memberNo = record.memberNo;
      if (record.memberNo >= club.nextMemberNo) club.nextMemberNo = record.memberNo + 1;
    }
  }
  for (const name of record.tags) {
    let tag = db.crm.tags.find((t) => t.clubId === clubId && t.name.toLowerCase() === name.toLowerCase());
    if (!tag) {
      tag = { id: newId(db, 'tag'), clubId, name: name.slice(0, 30), color: TAG_COLORS[db.crm.tags.length % TAG_COLORS.length]!, createdAt: now };
      db.crm.tags.push(tag);
    }
    if (!profile.tagIds.includes(tag.id)) profile.tagIds.push(tag.id);
  }
  const lines = [`Imported record attached (${record.file}).`];
  if (record.joinedAt !== null) lines.push(`Original joining date: ${new Date(record.joinedAt).toISOString().slice(0, 10)}.`);
  if (record.note) lines.push(record.note);
  db.crm.notes.push({ id: newId(db, 'note'), clubId, userId, authorId: 'system', body: lines.join(' '), createdAt: now, updatedAt: now, updatedBy: 'system', history: [] });
  record.status = 'claimed';
  record.claimedBy = userId;
  record.claimedAt = now;
  return record;
}

export function attachImport(db: DB, actorId: string, clubId: string, userId: string, recordId: string): ImportedRecord {
  requirePermission(db, actorId, 'crm.edit', clubId);
  const m = db.memberships.find((x) => x.clubId === clubId && x.userId === userId && x.status === 'active');
  if (!m) fail('not_member', 'Only an approved member can be attached to an imported record.');
  const record = claimImport(db, clubId, userId, recordId);
  if (!record) return fail('not_found', 'Imported record not found or already attached.');
  audit(db, actorId, clubId, 'crm.import_attached', { user: db.users[userId]?.name ?? userId });
  return record;
}

/** Example file for the download link on the assistant page. */
export const SAMPLE_CSV = ['name,email,member no,joined,tags,notes', 'Dana Cohen,dana@example.com,12,2024-03-15,"VIP Member;Regular Player",Prefers evening games', 'Yossi Levi,yossi@example.com,27,15/08/2024,Weekend Player,', 'Noa Peretz,noa@example.com,,2025-01-02,,New since January'].join('\n');
