'use client';

// ══════════════════════════════════════════════════════════════
//  §EVIDENCE — image evidence input (§8)
//
//  One image-processing pipeline fed by THREE input methods:
//    A. File picker        («اختيار صورة»)
//    B. Clipboard paste    («لصق صورة» reads the clipboard directly;
//                          falls back to arming Ctrl+V capture)
//    C. Drag & drop        (the dashed dropzone)
//
//  Flow: validate → optional canvas downscale → upload to the
//  pending tree (/api/evidence/upload) → immediate LOCAL preview
//  from an object URL. The parent record save promotes the object
//  to its final path — nothing uploads per keystroke/render.
//
//  §25: the document-level paste hook stays INERT unless the zone
//  is armed (user clicked/focused it) and NEVER intercepts paste
//  aimed at a real form field.
// ══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ClipboardPaste, ImagePlus, Loader2, Replace, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { translateUIText } from '@/lib/i18n/ui-text';
import type { EvidenceModuleKey } from '@/lib/evidence-modules';
import { EVIDENCE_IMAGE_MIME_ALLOWLIST } from '@/lib/evidence-items';
import { uploadEvidenceImage } from '@/lib/evidence-upload';
import type { EvidenceItemImage } from '@/types';

function imageFileFromDataTransfer(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return dt.files && dt.files.length > 0 && dt.files[0].type.startsWith('image/')
    ? dt.files[0]
    : null;
}

/** Direct clipboard read (Chromium) — null when unsupported/denied. */
async function readClipboardImage(): Promise<File | null> {
  try {
    if (!navigator.clipboard?.read) return null;
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) {
        const blob = await item.getType(type);
        const ext = type.split('/')[1] || 'png';
        return new File([blob], `pasted-${Date.now()}.${ext}`, { type });
      }
    }
    return null;
  } catch {
    return null;
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
  );
}

export function EvidenceImageInput({
  moduleKey,
  value,
  onChange,
  disabled = false,
}: {
  moduleKey: EvidenceModuleKey;
  value: EvidenceItemImage | null;
  onChange: (image: EvidenceItemImage | null) => void;
  disabled?: boolean;
}) {
  const { locale } = useLanguage();
  const [uploading, setUploading] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pasteArmed, setPasteArmed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const armedRef = useRef(false);
  armedRef.current = pasteArmed;

  const clearPreview = useCallback(() => {
    setLocalPreview((url) => {
      if (url) URL.revokeObjectURL(url);
      return null;
    });
  }, []);

  useEffect(() => clearPreview, [clearPreview]);

  const handleFile = useCallback(
    async (file: File) => {
      if (disabled || uploading) return;
      setPasteArmed(false);
      setUploading(true);
      const previewUrl = URL.createObjectURL(file);
      try {
        const staged = await uploadEvidenceImage(file, moduleKey);
        clearPreview();
        setLocalPreview(previewUrl);
        onChange({
          storagePath: staged.storagePath,
          fileName: staged.fileName,
          mimeType: staged.mimeType,
          size: staged.size,
          width: staged.width,
          height: staged.height,
        });
      } catch (error) {
        URL.revokeObjectURL(previewUrl);
        toast.error(error instanceof Error ? error.message : 'فشل رفع الصورة');
      } finally {
        setUploading(false);
      }
    },
    [clearPreview, disabled, moduleKey, onChange, uploading],
  );

  // §25 — armed-only document paste hook; never steals paste from
  // real form fields (those keep their normal Ctrl+V behavior).
  useEffect(() => {
    if (!pasteArmed) return;
    const onPaste = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const file = imageFileFromDataTransfer(e.clipboardData);
      if (file) {
        e.preventDefault();
        void handleFile(file);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [pasteArmed, handleFile]);

  const armPaste = useCallback(async () => {
    if (disabled || uploading) return;
    const file = await readClipboardImage();
    if (file) {
      void handleFile(file);
      return;
    }
    // Clipboard read unavailable — arm Ctrl+V capture and focus the zone.
    setPasteArmed(true);
    zoneRef.current?.focus();
  }, [disabled, handleFile, uploading]);

  const remove = useCallback(() => {
    clearPreview();
    onChange(null);
  }, [clearPreview, onChange]);

  if (value && localPreview) {
    return (
      <div className="space-y-1.5">
        <div className="relative h-28 w-full max-w-xs overflow-hidden rounded-lg border border-slate-700/40 bg-slate-800/40">
          <img src={localPreview} alt={value.fileName || 'evidence'} className="h-full w-full object-cover" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button" size="sm" variant="outline" className="h-7 px-2 text-xs gap-1"
            onClick={() => fileInputRef.current?.click()} disabled={disabled}
          >
            <Replace className="size-3.5" /><T>استبدال الصورة</T>
          </Button>
          <Button
            type="button" size="sm" variant="outline" className="h-7 px-2 text-xs gap-1 text-red-400/90 hover:text-red-300 border-red-500/30 hover:bg-red-500/10"
            onClick={remove} disabled={disabled}
            title={translateUIText('إزالة الصورة', locale)}
          >
            <Trash2 className="size-3.5" />
          </Button>
          <span className="text-[10px] text-slate-500">{Math.round(value.size / 1024)} KB{value.width ? ` · ${value.width}×${value.height}` : ''}</span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={EVIDENCE_IMAGE_MIME_ALLOWLIST.join(',')}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void handleFile(file);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div
        ref={zoneRef}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={translateUIText(pasteArmed ? 'اضغط Ctrl+V للّصق' : 'منطقة صورة الدليل', locale)}
        onClick={() => setPasteArmed(true)}
        onFocus={() => setPasteArmed(true)}
        onBlur={() => setPasteArmed(false)}
        onPaste={(e) => {
          const file = imageFileFromDataTransfer(e.clipboardData);
          if (file) {
            e.preventDefault();
            void handleFile(file);
          }
        }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = imageFileFromDataTransfer(e.dataTransfer);
          if (file) void handleFile(file);
        }}
        className={`flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-3 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          dragging
            ? 'border-brand-400 bg-brand-500/10'
            : pasteArmed
              ? 'border-brand-500/50 bg-brand-500/5'
              : 'border-slate-600/60 bg-slate-800/20 hover:bg-slate-800/40'
        }`}
      >
        {uploading ? (
          <Loader2 className="size-5 animate-spin text-brand-400" />
        ) : (
          <ImagePlus className="size-5 text-slate-500" />
        )}
        <p className="text-[11px] text-slate-500">
          {uploading
            ? <T>جاري التحميل...</T>
            : pasteArmed
              ? <T>اضغط Ctrl+V للّصق</T>
              : <T>أو اسحب الصورة هنا / انقر ثم Ctrl+V</T>}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button" size="sm" variant="outline" className="h-7 px-2 text-xs gap-1"
          onClick={armPaste} disabled={disabled || uploading}
        >
          <ClipboardPaste className="size-3.5" /><T>لصق صورة</T>
        </Button>
        <Button
          type="button" size="sm" variant="outline" className="h-7 px-2 text-xs gap-1"
          onClick={() => fileInputRef.current?.click()} disabled={disabled || uploading}
        >
          <ImagePlus className="size-3.5" /><T>اختيار صورة</T>
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={EVIDENCE_IMAGE_MIME_ALLOWLIST.join(',')}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void handleFile(file);
        }}
      />
    </div>
  );
}
