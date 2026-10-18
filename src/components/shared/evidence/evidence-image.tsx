'use client';

// ══════════════════════════════════════════════════════════════
//  §EVIDENCE — saved image loader + lightbox (§9/§14)
//
//  Loads an evidence image through the AUTHORIZED serve route via
//  the canonical authFetch (Bearer) and renders it from an object
//  URL — <img src> can never carry the auth header, and signed
//  bucket URLs would leak the bytes to anyone holding the link.
//
//  States: loading (skeleton) → image (click opens the lightbox)
//          failure → «تعذر تحميل الدليل» + retry. No broken-image
//          icon without context, no navigation away from Qnalys.
// ══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ZoomIn, ZoomOut } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { authFetch } from '@/lib/api-fetch';
import { evidenceImageUrl } from '@/lib/evidence-items';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { translateUIText as tui } from '@/lib/i18n/ui-text';
import type { EvidenceItemImage } from '@/types';

export function EvidenceImage({
  image,
  className = 'h-28',
}: {
  image: EvidenceItemImage;
  /** Tailbox height/width classes for the thumbnail. */
  className?: string;
}) {
  const { locale } = useLanguage();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    let revoked = false;
    let url: string | null = null;
    setLoading(true);
    setFailed(false);
    authFetch(evidenceImageUrl(image.storagePath))
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (revoked) return;
        url = URL.createObjectURL(blob);
        setObjectUrl(url);
      })
      .catch(() => {
        if (!revoked) setFailed(true);
      })
      .finally(() => {
        if (!revoked) setLoading(false);
      });
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [image.storagePath, retryTick]);

  const retry = useCallback(() => setRetryTick((n) => n + 1), []);

  if (loading) {
    return <Skeleton className={`${className} w-full rounded-lg`} />;
  }

  if (failed || !objectUrl) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
        <span className="text-xs text-red-300"><T>تعذر تحميل الدليل</T></span>
        <button
          type="button"
          onClick={retry}
          className="inline-flex items-center gap-1 text-xs text-red-300 hover:text-red-200 underline underline-offset-2"
        >
          <RefreshCw className="size-3" />{tui('إعادة المحاولة', locale)}
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setLightboxOpen(true); setZoomed(false); }}
        className={`group relative block w-full overflow-hidden rounded-lg border border-slate-700/40 bg-slate-800/40 ${className}`}
        title={tui('عرض الصورة', locale)}
        aria-label={tui('عرض الصورة', locale)}
      >
        <img
          src={objectUrl}
          alt={image.fileName || 'evidence'}
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          loading="lazy"
        />
        <span className="absolute bottom-1 end-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] text-slate-300 opacity-0 transition-opacity group-hover:opacity-100">
          {tui('عرض الصورة', locale)}
        </span>
      </button>

      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="text-sm break-all">{image.fileName || 'evidence.webp'}</DialogTitle>
            <DialogDescription>
              {image.width && image.height ? `${image.width}×${image.height} · ` : ''}
              {Math.round(image.size / 1024)} KB
            </DialogDescription>
          </DialogHeader>
          <div
            className={`flex justify-center rounded-lg border border-slate-700/40 bg-slate-900/60 ${zoomed ? 'overflow-auto max-h-[70vh]' : ''}`}
            onClick={() => setZoomed((z) => !z)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setZoomed((z) => !z); }}
            aria-label={tui('عرض الصورة', locale)}
          >
            <img
              src={objectUrl}
              alt={image.fileName || 'evidence'}
              className={zoomed ? 'max-w-none cursor-zoom-out' : 'max-h-[70vh] w-auto object-contain cursor-zoom-in'}
            />
          </div>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setZoomed((z) => !z)}
              className="inline-flex items-center gap-1.5 h-8 rounded-md border border-slate-600 px-3 text-xs text-slate-300 hover:bg-slate-700/50 transition-colors"
            >
              {zoomed ? <ZoomOut className="size-3.5" /> : <ZoomIn className="size-3.5" />}
              {zoomed ? tui('تصغير', locale) : tui('تكبير', locale)}
            </button>
            <a
              href={objectUrl}
              download={image.fileName || 'evidence.webp'}
              className="inline-flex items-center gap-1.5 h-8 rounded-md border border-slate-600 px-3 text-xs text-slate-300 hover:bg-slate-700/50 transition-colors"
            >
              {tui('تنزيل', locale)}
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
