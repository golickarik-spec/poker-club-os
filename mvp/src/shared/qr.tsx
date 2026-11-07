/** A QR code for a club or invitation address, with copy and download. */
import { useMemo } from 'react';
import { LuCopy, LuDownload } from 'react-icons/lu';
import { toasts } from '../app/context.ts';
import { useT } from '../app/hooks.ts';
import { Button, cx } from '../ui/core.tsx';
import { qrSvg } from '../ui/qr.ts';

export function QrCard({ url, caption, size = 180, className, fileName = 'invitation' }: { url: string; caption?: string; size?: number; className?: string; fileName?: string }) {
  const t = useT();
  const svg = useMemo(() => qrSvg(url, 4), [url]);
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const copy = () => navigator.clipboard?.writeText(url).then(() => toasts.push('success', t('qr.copied')), () => toasts.push('info', url));
  return (
    <div className={cx('flex w-full min-w-0 max-w-[260px] flex-col items-center gap-3', className)} data-testid="qr-card">
      <img src={dataUrl} alt={t('qr.alt')} width={size} height={size} className="rounded-inner bg-white p-1" style={{ width: size, height: size }} />
      {caption && <p className="max-w-[32ch] text-center text-[12.5px] text-ink-2">{caption}</p>}
      <p className="w-full truncate rounded-control bg-bg text-center px-2.5 py-1.5 font-mono text-[12px] text-ink-2" dir="ltr" data-testid="qr-url">
        {url}
      </p>
      <div className="flex gap-2">
        <Button size="sm" icon={<LuCopy className="size-3.5" aria-hidden />} onClick={copy} data-testid="qr-copy">
          {t('qr.copy')}
        </Button>
        <a href={dataUrl} download={`${fileName}.svg`} className="inline-flex h-8 items-center gap-2 rounded-control border border-line-strong/70 bg-raised px-3 text-[13px] font-medium text-ink hover:bg-raised-2">
          <LuDownload className="size-3.5" aria-hidden />
          {t('qr.download')}
        </a>
      </div>
    </div>
  );
}
