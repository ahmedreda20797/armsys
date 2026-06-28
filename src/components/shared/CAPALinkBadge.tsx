'use client';

import { useState, useEffect } from 'react';
import { authFetch } from '@/lib/api-fetch';
import { useAppStore } from '@/lib/store';
import { getStatusConfig, calculateProgress } from '@/lib/capa-helpers';
import { ExternalLink, ShieldAlert, Loader2 } from 'lucide-react';

interface CAPASummary {
  id: string;
  capaId: string;
  title: string;
  status: string;
  priority: string;
  progress: number;
}

// Simple in-memory cache to avoid redundant fetches
const cache = new Map<string, { data: CAPASummary; ts: number }>();
const CACHE_TTL = 30_000; // 30 seconds

async function fetchCAPASummary(capaId: string): Promise<CAPASummary | null> {
  const cached = cache.get(capaId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const res = await authFetch(`/api/capa-cases/${capaId}`);
    if (!res.ok) return null;
    const data = await res.json();
    const summary: CAPASummary = {
      id: data.id,
      capaId: data.capaId || '—',
      title: data.title || 'بدون عنوان',
      status: data.status || 'open',
      priority: data.priority || 'medium',
      progress: calculateProgress(data),
    };
    cache.set(capaId, { data: summary, ts: Date.now() });
    return summary;
  } catch {
    return null;
  }
}

/**
 * CAPALinkBadge — Shows a CAPA status badge with progress + navigation.
 * Used across Follow-Ups, Quality, Complaints, HR Deductions for bidirectional integration.
 */
export function CAPALinkBadge({ capaId, compact = false }: { capaId: string; compact?: boolean }) {
  const [summary, setSummary] = useState<CAPASummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchCAPASummary(capaId).then((data) => {
      if (!cancelled) {
        setSummary(data);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [capaId]);

  const navigate = useAppStore((s) => s.navigateTo);
  const sc = summary ? getStatusConfig(summary.status) : null;
  const SIcon = sc?.icon;

  const handleClick = () => {
    navigate('capa', capaId, { id: capaId });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-slate-500">
        <Loader2 className="size-3 animate-spin" />
        <span className="text-[10px]">جارٍ تحميل CAPA...</span>
      </div>
    );
  }

  if (!summary) {
    return (
      <button
        onClick={handleClick}
        className="flex items-center gap-1.5 text-cyan-400/70 hover:text-cyan-300 transition-colors"
      >
        <ShieldAlert className="size-3" />
        <span className="text-[10px]">عرض حالة CAPA</span>
      </button>
    );
  }

  if (compact) {
    return (
      <button
        onClick={handleClick}
        className="flex items-center gap-2 rounded-lg border border-cyan-500/15 bg-cyan-500/5 px-2.5 py-1.5 hover:bg-cyan-500/10 transition-colors group"
        title={`CAPA: ${summary.title}`}
      >
        <div className="flex items-center gap-1.5">
          {SIcon && <SIcon className={`size-3 ${sc!.color.split(' ')[1] || 'text-cyan-400'}`} />}
          <span className="text-[10px] text-slate-400" dir="ltr">{summary.capaId}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${sc!.color}`}>{sc!.label}</span>
        </div>
        <div className="flex items-center gap-1 min-w-[60px]">
          <div className="flex-1 h-1 rounded-full bg-slate-700/50 overflow-hidden">
            <div
              className={`h-full rounded-full ${
                summary.progress >= 85 ? 'bg-violet-500' : summary.progress >= 60 ? 'bg-sky-500' : summary.progress >= 35 ? 'bg-amber-500' : 'bg-red-500'
              }`}
              style={{ width: `${summary.progress}%` }}
            />
          </div>
          <span className="text-[9px] text-slate-500" dir="ltr">{summary.progress}%</span>
        </div>
        <ExternalLink className="size-3 text-slate-600 group-hover:text-cyan-400 transition-colors" />
      </button>
    );
  }

  // Full card version
  return (
    <div
      onClick={handleClick}
      className="rounded-lg border border-cyan-500/15 bg-cyan-500/5 px-3 py-2.5 cursor-pointer hover:bg-cyan-500/10 transition-all group"
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <ShieldAlert className="size-3.5 text-cyan-400" />
          <span className="text-cyan-400 text-[11px] font-medium">حالة CAPA مرتبطة</span>
        </div>
        <ExternalLink className="size-3 text-slate-600 group-hover:text-cyan-400 transition-colors" />
      </div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-slate-500 font-mono" dir="ltr">{summary.capaId}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${sc!.color}`}>
          {SIcon && <SIcon className="size-2.5 inline ml-0.5" />}{sc!.label}
        </span>
      </div>
      <p className="text-slate-300 text-xs leading-relaxed mb-2 line-clamp-2">{summary.title}</p>
      {/* Progress bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              summary.progress >= 85 ? 'bg-violet-500' : summary.progress >= 60 ? 'bg-sky-500' : summary.progress >= 35 ? 'bg-amber-500' : 'bg-red-500'
            }`}
            style={{ width: `${summary.progress}%` }}
          />
        </div>
        <span className={`text-[10px] font-medium min-w-[32px] text-left ${
          summary.progress >= 85 ? 'text-violet-400' : summary.progress >= 60 ? 'text-sky-400' : summary.progress >= 35 ? 'text-amber-400' : 'text-red-400'
        }`} dir="ltr">{summary.progress}%</span>
      </div>
    </div>
  );
}

/**
 * Hook to fetch CAPA summary data (for custom rendering)
 */
export function useCAPASummary(capaId: string | null | undefined) {
  const [summary, setSummary] = useState<CAPASummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!capaId) { setSummary(null); return; }
    setLoading(true);
    fetchCAPASummary(capaId).then((data) => {
      setSummary(data);
      setLoading(false);
    });
  }, [capaId]);

  return { summary, loading };
}