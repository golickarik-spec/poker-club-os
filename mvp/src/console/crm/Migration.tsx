/**
 * Migration assistant (v0.4): paste or upload a CSV of existing members, check the mapping and
 * the problems row by row, then keep the clean rows as imported records. No accounts are made:
 * each record waits for the real person and is attached on approval by email, or by hand.
 */
import { useRef, useState } from 'react';
import { LuCheck, LuDownload, LuFileUp, LuTrash2, LuUndo2, LuUpload } from 'react-icons/lu';
import { act } from '../../app/context.ts';
import { dateShort } from '../../app/format.ts';
import { useDb, useMe, useT } from '../../app/hooks.ts';
import * as mig from '../../platform/migration.ts';
import type { Club } from '../../platform/types.ts';
import { Badge, Button, cx, Notice, PageHeader, Panel, PanelHeader } from '../../ui/core.tsx';
import { Select, TextArea } from '../../ui/forms.tsx';
import { ConfirmDialog } from '../../ui/overlay.tsx';
import { TableShell, Td, Th } from '../shared.tsx';
import { useReport } from './shared.tsx';

export function Migration({ club }: { club: Club }) {
  const t = useT();
  const db = useDb();
  const me = useMe()!;
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('import.csv');
  const [mapping, setMapping] = useState<mig.ImportField[] | null>(null);
  const [preview, setPreview] = useState<mig.ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ imported: number; batchId: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const records = useReport(() => mig.listImports(db, me.id, club.id), [club.id, me.id]);

  const analyse = (source = text, map: mig.ImportField[] | null = mapping) => {
    setError(null);
    setDone(null);
    try {
      const p = mig.previewImport(db, me.id, club.id, source, map ?? undefined);
      setPreview(p);
      setMapping(p.mapping);
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const onFile = (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    file.text().then((s) => {
      setText(s);
      setMapping(null);
      analyse(s, null);
    });
  };
  const remap = (i: number, field: mig.ImportField) => {
    if (!mapping) return;
    const next = mapping.map((m, j) => (j === i ? field : m === field && field !== 'ignore' ? 'ignore' : m));
    setMapping(next);
    analyse(text, next);
  };
  const commit = () => {
    if (!preview) return;
    const result = act(() => mig.commitImport(db, me.id, club.id, preview, fileName), { key: 'migration.imported_toast' });
    if (result) {
      setDone(result);
      setPreview(null);
      setText('');
      setMapping(null);
    }
  };
  const sample = `data:text/csv;charset=utf-8,${encodeURIComponent(mig.SAMPLE_CSV)}`;
  const unclaimed = records.filter((r) => r.status === 'unclaimed');

  return (
    <div data-testid="crm-migration">
      <PageHeader
        title={t('migration.title')}
        subtitle={t('migration.subtitle')}
        actions={
          <a href={sample} download="members-sample.csv" className="inline-flex h-8 items-center gap-2 rounded-control border border-line-strong/70 bg-raised px-3 text-[13px] font-medium text-ink hover:bg-raised-2">
            <LuDownload className="size-3.5" aria-hidden />
            {t('migration.sample')}
          </a>
        }
      />
      <Notice tone="info" className="mb-4">
        {t('migration.principle')}
      </Notice>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader title={t('migration.source')} hint={t('migration.source_hint')} />
          <div data-testid="migration-text-wrap"><TextArea value={text} onChange={setText} rows={10} placeholder={mig.SAMPLE_CSV} className="font-mono text-[12px]" id="migration-text" /></div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" icon={<LuCheck className="size-4" aria-hidden />} onClick={() => analyse()} disabled={text.trim() === ''} data-testid="migration-analyse">
              {t('migration.analyse')}
            </Button>
            <Button icon={<LuFileUp className="size-4" aria-hidden />} onClick={() => fileInput.current?.click()}>
              {t('migration.upload')}
            </Button>
            <input ref={fileInput} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => (onFile(e.target.files?.[0]), (e.target.value = ''))} data-testid="migration-file" />
          </div>
          {error && (
            <p className="mt-3 text-[13px] text-danger" role="alert">
              {error}
            </p>
          )}
          {done && (
            <Notice tone="success" className="mt-3" action={<Button size="sm" variant="ghost" icon={<LuUndo2 className="size-3.5" aria-hidden />} onClick={() => act(() => mig.deleteBatch(db, me.id, club.id, done.batchId), { key: 'migration.undone' }) !== undefined && setDone(null)}>{t('migration.undo')}</Button>}>
              {t('migration.done', { n: done.imported })}
            </Notice>
          )}
        </Panel>
        <Panel pad={false} className="overflow-hidden">
          <PanelHeader title={t('migration.preview')} hint={preview ? t('migration.preview_counts', { ok: preview.importable, skipped: preview.skipped }) : t('migration.preview_hint')} className="px-4 pt-4 sm:px-5" />
          {preview ? (
            <>
              <TableShell minWidth={640}>
                <thead>
                  <tr>
                    <Th>#</Th>
                    <Th>{t('migration.col.status')}</Th>
                    {preview.header.map((h, i) => (
                      <Th key={i}>
                        <span className="block truncate text-ink-2" title={h}>
                          {h || '—'}
                        </span>
                        <Select value={mapping?.[i] ?? 'ignore'} onChange={(f) => remap(i, f as mig.ImportField)} className="mt-1 h-7 w-auto text-[12px]" aria-label={t('migration.map_column', { col: h })} options={mig.IMPORT_FIELDS.map((f) => ({ value: f, label: t(`migration.field.${f}`) }))} />
                      </Th>
                    ))}
                  </tr>
                </thead>
                <tbody data-testid="migration-rows">
                  {preview.rows.slice(0, 200).map((r) => (
                    <tr key={r.line} className={cx('border-t border-line', r.problems.length > 0 && 'opacity-70')} data-testid={`migration-row-${r.line}`}>
                      <Td className="text-ink-3 tabular-nums">{r.line}</Td>
                      <Td>
                        {r.problems.length === 0 ? (
                          <Badge tone="success">{t('migration.ok')}</Badge>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {r.problems.map((p) => (
                              <Badge key={p} tone="warning">
                                {t(`migration.problem.${p}`)}
                              </Badge>
                            ))}
                          </span>
                        )}
                      </Td>
                      {preview.header.map((_, i) => {
                        const f = mapping?.[i] ?? 'ignore';
                        const v = f === 'name' ? r.name : f === 'email' ? (r.email ?? '') : f === 'memberNo' ? (r.memberNo === null ? '' : String(r.memberNo)) : f === 'joinedAt' ? (r.joinedAt === null ? '' : dateShort(r.joinedAt, t.lang)) : f === 'tags' ? r.tags.join(', ') : f === 'note' ? (r.note ?? '') : f === 'phone' ? (r.phone ?? '') : '';
                        return (
                          <Td key={i} className={cx('max-w-[220px] truncate', f === 'ignore' && 'text-ink-3 line-through')}>
                            {v || '—'}
                          </Td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </TableShell>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 sm:px-5">
                <p className="text-[12.5px] text-ink-3">{t('migration.skip_note')}</p>
                <Button variant="primary" icon={<LuUpload className="size-4" aria-hidden />} onClick={commit} disabled={preview.importable === 0} data-testid="migration-commit">
                  {t('migration.commit', { n: preview.importable })}
                </Button>
              </div>
            </>
          ) : (
            <p className="px-4 pb-6 text-[13px] text-ink-3 sm:px-5">{t('migration.empty')}</p>
          )}
        </Panel>
      </div>

      <Panel pad={false} className="mt-4 overflow-hidden">
        <PanelHeader title={t('migration.records')} hint={t('migration.records_hint', { waiting: unclaimed.length, attached: records.length - unclaimed.length })} className="px-4 pt-4 sm:px-5" />
        {records.length === 0 ? (
          <p className="px-4 pb-6 text-[13px] text-ink-3 sm:px-5">{t('migration.no_records')}</p>
        ) : (
          <TableShell minWidth={640}>
            <thead>
              <tr>
                <Th>{t('crm.col.player')}</Th>
                <Th>{t('migration.field.email')}</Th>
                <Th end>{t('migration.field.memberNo')}</Th>
                <Th>{t('migration.field.joinedAt')}</Th>
                <Th>{t('migration.field.tags')}</Th>
                <Th>{t('migration.col.status')}</Th>
                <Th end>
                  <span className="sr-only">{t('crm.col.actions')}</span>
                </Th>
              </tr>
            </thead>
            <tbody data-testid="migration-records">
              {records.map((r) => (
                <tr key={r.id} className="border-t border-line" data-testid={`import-${r.id}`}>
                  <Td>
                    <span className="block font-medium text-ink">{r.name}</span>
                    <span className="block text-[12px] text-ink-3">{t('migration.from_file', { file: r.file, date: dateShort(r.importedAt, t.lang) })}</span>
                  </Td>
                  <Td className="text-ink-2">
                    <span dir="ltr">{r.email ?? '—'}</span>
                  </Td>
                  <Td end className="tabular-nums">
                    {r.memberNo ?? '—'}
                  </Td>
                  <Td className="text-ink-2">{r.joinedAt === null ? '—' : dateShort(r.joinedAt, t.lang)}</Td>
                  <Td className="text-[12.5px] text-ink-2">{r.tags.join(', ') || '—'}</Td>
                  <Td>{r.status === 'claimed' ? <Badge tone="success">{t('migration.status.claimed', { name: db.users[r.claimedBy ?? '']?.name ?? '' })}</Badge> : <Badge tone="neutral">{t('migration.status.unclaimed')}</Badge>}</Td>
                  <Td end>
                    {r.status === 'unclaimed' && (
                      <button type="button" aria-label={t('common.delete')} title={t('common.delete')} className="inline-flex size-8 items-center justify-center rounded-control text-ink-3 hover:bg-raised hover:text-danger" onClick={() => setRemoving(r.id)}>
                        <LuTrash2 className="size-4" aria-hidden />
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Panel>
      <ConfirmDialog open={removing !== null} onClose={() => setRemoving(null)} onConfirm={() => removing && act(() => mig.deleteImport(db, me.id, club.id, removing), { key: 'migration.removed' })} title={t('migration.remove_title')} body={t('migration.remove_body')} confirmLabel={t('common.delete')} danger />
    </div>
  );
}
