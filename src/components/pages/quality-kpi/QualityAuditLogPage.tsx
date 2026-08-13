'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { History, Search, Download, RefreshCw } from 'lucide-react';
import { AuditTrailList } from '@/components/shared/audit';
import { useQualityAuditLog, type AuditLogParams } from '@/hooks/use-kpi-queries';
import type { QualityAuditLogEntry, QualityAuditEntityType } from '@/types/quality-kpi';

// ─── Constants ────────────────────────────────────────────────
const ENTITY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'كل الأنواع' },
  { value: 'observation', label: 'ملاحظة' },
  { value: 'month', label: 'شهر' },
  { value: 'category', label: 'فئة' },
  { value: 'template', label: 'قالب' },
  { value: 'settings', label: 'إعدادات' },
];

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'كل الإجراءات' },
  { value: 'create', label: 'إنشاء' },
  { value: 'update', label: 'تعديل' },
  { value: 'delete', label: 'حذف' },
  { value: 'approve', label: 'اعتماد' },
  { value: 'reject', label: 'رفض' },
  { value: 'close_month', label: 'إغلاق شهر' },
  { value: 'reopen_month', label: 'إعادة فتح شهر' },
];

const LIMIT_OPTIONS = [25, 50, 100, 200];

// ─── Page ─────────────────────────────────────────────────────
export default function QualityAuditLogPage() {
  const { canView } = usePermissions('qualityAuditLog');

  // Filters
  const [entityType, setEntityType] = useState<string>('all');
  const [action, setAction] = useState<string>('all');
  const [monthKey, setMonthKey] = useState('');
  const [actorId, setActorId] = useState('');
  const [limit, setLimit] = useState<number>(50);

  // Build query params — only include non-default values.
  const params: AuditLogParams = useMemo(() => {
    const p: AuditLogParams = { limit };
    if (entityType !== 'all') p.entityType = entityType;
    if (action !== 'all') p.action = action;
    if (monthKey) p.monthKey = monthKey;
    if (actorId) p.actorId = actorId;
    return p;
  }, [entityType, action, monthKey, actorId, limit]);

  const { data, isLoading, isFetching, refetch } = useQualityAuditLog(params);

  const entries: QualityAuditLogEntry[] = Array.isArray(data) ? data : [];

  function clearFilters() {
    setEntityType('all');
    setAction('all');
    setMonthKey('');
    setActorId('');
  }

  const hasFilters = entityType !== 'all' || action !== 'all' || !!monthKey || !!actorId;

  if (!canView) {
    return (
      <div dir="rtl" className="flex flex-col items-center justify-center py-24 text-slate-400">
        <p>ليس لديك صلاحية للوصول إلى هذه الصفحة</p>
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-4 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <History className="size-6 text-blue-400" />
            سجل المراجعة
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            سجل كامل بجميع التغييرات والعمليات في نظام جودة المؤشرات
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            title="تحديث"
          >
            <RefreshCw className={`size-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="border-slate-700/40 bg-slate-800/30">
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-4">
          <div className="space-y-1">
            <Label className="text-xs text-slate-400">نوع الكيان</Label>
            <Select value={entityType} onValueChange={setEntityType}>
              <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ENTITY_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-400">الإجراء</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACTION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-400">الشهر</Label>
            <Input
              type="month"
              value={monthKey}
              onChange={(e) => setMonthKey(e.target.value)}
              placeholder="YYYY-MM"
              className="bg-slate-800/50 border-slate-700"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-400">معرّف المنفّذ</Label>
            <Input
              value={actorId}
              onChange={(e) => setActorId(e.target.value)}
              placeholder="user-id"
              className="bg-slate-800/50 border-slate-700 font-mono text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-400">عدد النتائج</Label>
            <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
              <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LIMIT_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {hasFilters && (
            <div className="flex items-end">
              <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs text-slate-400">
                مسح الفلاتر
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg bg-slate-800/50" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <Card className="border-slate-700/40 bg-slate-800/30">
          <CardContent className="flex flex-col items-center justify-center py-14">
            <div className="size-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">
              <History className="size-6 text-slate-600" />
            </div>
            <p className="text-slate-400 text-sm font-medium">لا توجد سجلات</p>
            <p className="text-slate-600 text-xs mt-1">
              {hasFilters ? 'لم يتم العثور على سجلات مع الفلاتر المحددة' : 'لم يتم تسجيل أي عمليات بعد'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.03 } } }}
          className="space-y-2"
        >
          <AuditTrailList entries={entries} />
          <p className="text-xs text-slate-500 text-center py-2">
            عرض {entries.length} سجل{entries.length !== 1 ? '' : ''}
            {limit < Infinity && entries.length >= limit ? ' (محدود)' : ''}
          </p>
        </motion.div>
      )}
    </div>
  );
}
