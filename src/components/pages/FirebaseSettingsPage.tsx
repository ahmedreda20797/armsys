'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Database,
  Cloud,
  CheckCircle2,
  XCircle,
  Loader2,
  Save,
  Plug,
  RefreshCw,
  Copy,
  Check,
  BookOpen,
  ShieldCheck,
  Info,
  Download,
} from 'lucide-react';

interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  databaseURL: string;
}

interface SyncResult {
  employees?: number;
  attendance?: number;
  requests?: number;
  rules?: number;
  quality?: number;
  travel?: number;
  biometric?: number;
  total?: number;
}

interface ConfigField {
  key: keyof FirebaseConfig;
  label: string;
  placeholder: string;
}

const emptyConfig: FirebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
  databaseURL: '',
};

const configFields: ConfigField[] = [
  { key: 'apiKey', label: 'مفتاح API', placeholder: 'AIzaSy...' },
  { key: 'authDomain', label: 'نطاق المصادقة', placeholder: 'my-project.firebaseapp.com' },
  { key: 'projectId', label: 'معرّف المشروع', placeholder: 'my-project-id' },
  { key: 'storageBucket', label: 'حاوية التخزين', placeholder: 'my-project.appspot.com' },
  { key: 'messagingSenderId', label: 'معرّف المرسل', placeholder: '123456789' },
  { key: 'appId', label: 'معرّف التطبيق', placeholder: '1:123456789:web:abc123' },
  { key: 'databaseURL', label: 'رابط قاعدة البيانات', placeholder: 'https://my-project-id-default-rtdb.firebaseio.com' },
];

const databaseRules = `{
  "rules": {
    ".read": true,
    ".write": true
  }
}`;

const guideSteps = [
  {
    step: 1,
    title: 'افتح وحدة تحكم Firebase',
    description: 'اذهب إلى console.firebase.google.com وسجّل الدخول بحساب Google',
  },
  {
    step: 2,
    title: 'أنشئ مشروعًا جديدًا',
    description: 'اضغط "إنشاء مشروع" وأدخل اسم المشروع. اختر المنطقة المناسبة ثم اضغط "إنشاء"',
  },
  {
    step: 3,
    title: 'أضف تطبيق ويب',
    description: 'من صفحة المشروع، اضغط على أيقونة الويب (</>) لإضافة تطبيق ويب جديد',
  },
  {
    step: 4,
    title: 'انسخ الإعدادات',
    description: 'بعد تسجيل التطبيق، ستظهر لك الإعدادات. انسخ كائن firebaseConfig بالكامل',
  },
  {
    step: 5,
    title: 'فعّل قاعدة البيانات',
    description: 'من القائمة الجانبية، اختر "Realtime Database" ثم اضغط "إنشاء قاعدة بيانات"',
  },
  {
    step: 6,
    title: 'اضبط قواعد الأمان',
    description: 'في تبويب "القواعد"، استبدل القواعد الحالية بالقواعد الموجودة في قسم المرجع أدناه للسماح بالقراءة والكتابة',
  },
  {
    step: 7,
    title: 'الصق الإعدادات هنا',
    description: 'عد إلى هذه الصفحة والصق كل قيمة في الحقل المناسب',
  },
  {
    step: 8,
    title: 'اختبر الاتصال',
    description: 'اضغط زر "اختبار الاتصال" للتأكد من أن جميع القيم صحيحة',
  },
  {
    step: 9,
    title: 'زامن البيانات',
    description: 'بعد نجاح الاتصال، اضغط "زامن إلى Firebase" لنقل بيانات النظام المحلية إلى السحابة',
  },
];

export default function FirebaseSettingsPage() {
  const [config, setConfig] = useState<FirebaseConfig>(emptyConfig);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'failure' | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'checking' | 'unknown'>('unknown');
  const [connectedProjectName, setConnectedProjectName] = useState<string | null>(null);
  const [rulesCopied, setRulesCopied] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const hasAutoChecked = useRef(false);

  // Load saved config from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('firebase_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        setConfig((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // Ignore parse errors
    } finally {
      setInitialLoading(false);
    }
  }, []);

  // Auto-check connection status on mount
  const checkConnectionStatus = useCallback(async () => {
    setConnectionStatus('checking');
    try {
      const res = await fetch('/api/firebase/config');
      if (res.ok) {
        const data = await res.json();
        if (data && data.projectId) {
          setConnectionStatus('connected');
          setConnectedProjectName(data.projectId);
          // Also populate form from server config
          setConfig((prev) => ({
            ...prev,
            apiKey: data.apiKey || prev.apiKey,
            authDomain: data.authDomain || prev.authDomain,
            projectId: data.projectId || prev.projectId,
            storageBucket: data.storageBucket || prev.storageBucket,
            messagingSenderId: data.messagingSenderId || prev.messagingSenderId,
            appId: data.appId || prev.appId,
            databaseURL: data.databaseURL || prev.databaseURL,
          }));
        } else {
          setConnectionStatus('disconnected');
        }
      } else {
        setConnectionStatus('disconnected');
      }
    } catch {
      setConnectionStatus('disconnected');
    }
  }, []);

  useEffect(() => {
    if (!hasAutoChecked.current) {
      hasAutoChecked.current = true;
      checkConnectionStatus();
    }
  }, [checkConnectionStatus]);

  const updateField = (key: keyof FirebaseConfig, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    // Reset test result when config changes
    if (testResult) setTestResult(null);
  };

  const isConfigComplete = () => {
    return config.apiKey && config.projectId && config.databaseURL;
  };

  const handleTestConnection = async () => {
    if (!isConfigComplete()) {
      toast.error('يرجى ملء الحقول المطلوبة على الأقل (مفتاح API، معرّف المشروع، رابط قاعدة البيانات)');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/firebase/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult('success');
        setConnectionStatus('connected');
        setConnectedProjectName(config.projectId);
        toast.success('تم الاتصال بنجاح! Firebase متاح وجاهز للاستخدام');
      } else {
        setTestResult('failure');
        setConnectionStatus('disconnected');
        toast.error(data.error || 'فشل الاتصال. يرجى التحقق من الإعدادات');
      }
    } catch {
      setTestResult('failure');
      setConnectionStatus('disconnected');
      toast.error('خطأ في الشبكة. يرجى المحاولة مرة أخرى');
    } finally {
      setTesting(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!isConfigComplete()) {
      toast.error('يرجى ملء الحقول المطلوبة على الأقل');
      return;
    }
    setSaving(true);
    try {
      // Save to localStorage
      localStorage.setItem('firebase_config', JSON.stringify(config));

      // Save to server
      const res = await fetch('/api/firebase/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        toast.success('تم حفظ الإعدادات بنجاح');
      } else {
        toast.error('تم الحفظ محليًا، لكن فشل الحفظ على الخادم');
      }
    } catch {
      // Still saved to localStorage
      toast.success('تم حفظ الإعدادات محليًا');
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/firebase/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (res.ok && data.success !== false) {
        setSyncResult(data);
        setLastSyncTime(new Date().toLocaleTimeString('ar-EG'));
        toast.success('تمت المزامنة بنجاح');
      } else {
        toast.error(data.error || 'فشلت المزامنة. يرجى التحقق من الاتصال');
      }
    } catch {
      toast.error('خطأ في الشبكة أثناء المزامنة');
    } finally {
      setSyncing(false);
    }
  };

  const handleCopyRules = async () => {
    try {
      await navigator.clipboard.writeText(databaseRules);
      setRulesCopied(true);
      toast.success('تم نسخ قواعد الأمان');
      setTimeout(() => setRulesCopied(false), 2000);
    } catch {
      toast.error('فشل النسخ. يرجى النسخ يدويًا');
    }
  };

  return (
    <div dir="rtl" className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Database className="size-6 text-violet-400" />
            إعدادات Firebase
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            تكوين اتصال Firebase لمزامنة البيانات السحابية
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/api/download" download="arm-erp-project.zip" className="inline-flex">
            <Button
              variant="outline"
              className="border-violet-600/30 text-violet-400 hover:bg-violet-500/20 hover:text-violet-300"
            >
              <Download className="size-4" />
              تحميل المشروع
            </Button>
          </a>
          <Button
            variant="outline"
            onClick={checkConnectionStatus}
            disabled={connectionStatus === 'checking'}
            className="border-slate-600 text-slate-300 hover:bg-slate-700"
          >
            <RefreshCw className={`size-4 ${connectionStatus === 'checking' ? 'animate-spin' : ''}`} />
            فحص الاتصال
          </Button>
        </div>
      </motion.div>

      {/* Section 2: Connection Status Card */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-white flex items-center gap-2">
              <Plug className="size-5 text-violet-400" />
              حالة الاتصال
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              {connectionStatus === 'checking' || initialLoading ? (
                <>
                  <Skeleton className="size-10 rounded-full bg-slate-700" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32 bg-slate-700" />
                    <Skeleton className="h-3 w-48 bg-slate-700" />
                  </div>
                </>
              ) : connectionStatus === 'connected' ? (
                <>
                  <div className="size-10 rounded-full bg-violet-500/20 flex items-center justify-center">
                    <CheckCircle2 className="size-6 text-violet-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-medium">متصل</span>
                      <Badge className="bg-violet-500/20 text-violet-400 border-violet-500/30 hover:bg-emerald-500/30">
                        نشط
                      </Badge>
                    </div>
                    {connectedProjectName && (
                      <p className="text-slate-400 text-sm mt-0.5">
                        المشروع: <span className="text-slate-300" dir="ltr">{connectedProjectName}</span>
                      </p>
                    )}
                  </div>
                </>
              ) : connectionStatus === 'disconnected' ? (
                <>
                  <div className="size-10 rounded-full bg-red-500/20 flex items-center justify-center">
                    <XCircle className="size-6 text-red-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-medium">غير متصل</span>
                      <Badge className="bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30">
                        غير نشط
                      </Badge>
                    </div>
                    <p className="text-slate-400 text-sm mt-0.5">
                      يرجى إدخال إعدادات Firebase والاتصال
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="size-10 rounded-full bg-slate-500/20 flex items-center justify-center">
                    <Cloud className="size-6 text-slate-400" />
                  </div>
                  <div>
                    <span className="text-slate-300 font-medium">لم يتم الفحص بعد</span>
                    <p className="text-slate-400 text-sm mt-0.5">
                      اضغط "فحص الاتصال" أو "اختبار الاتصال"
                    </p>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Section 1: Firebase Connection Configuration */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-white flex items-center gap-2">
              <Database className="size-5 text-violet-400" />
              تكوين الاتصال
            </CardTitle>
          </CardHeader>
          <CardContent>
            {initialLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-4 w-24 bg-slate-700" />
                    <Skeleton className="h-10 rounded-md bg-slate-700" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {configFields.map((field) => (
                    <div key={field.key} className="space-y-2">
                      <Label className="text-slate-300 text-sm">{field.label}</Label>
                      <Input
                        value={config[field.key]}
                        onChange={(e) => updateField(field.key, e.target.value)}
                        className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500 focus:border-emerald-500"
                        placeholder={field.placeholder}
                        dir="ltr"
                      />
                    </div>
                  ))}
                </div>

                {/* Action buttons */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
                  <Button
                    onClick={handleTestConnection}
                    disabled={testing || !isConfigComplete()}
                    className={
                      testResult === 'success'
                        ? 'bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white'
                        : testResult === 'failure'
                          ? 'bg-red-600 hover:bg-red-700 text-white'
                          : 'bg-slate-600 hover:bg-slate-500 text-white'
                    }
                  >
                    {testing ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        جاري الاختبار...
                      </>
                    ) : testResult === 'success' ? (
                      <>
                        <CheckCircle2 className="size-4" />
                        تم الاتصال بنجاح
                      </>
                    ) : testResult === 'failure' ? (
                      <>
                        <XCircle className="size-4" />
                        فشل الاتصال
                      </>
                    ) : (
                      <>
                        <Plug className="size-4" />
                        اختبار الاتصال
                      </>
                    )}
                  </Button>

                  <Button
                    onClick={handleSaveConfig}
                    disabled={saving || !isConfigComplete()}
                    className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        جاري الحفظ...
                      </>
                    ) : (
                      <>
                        <Save className="size-4" />
                        حفظ الإعدادات
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Section 3: Data Sync */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
      >
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-white flex items-center gap-2">
              <RefreshCw className="size-5 text-violet-400" />
              مزامنة البيانات
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-slate-300 text-sm">
                    نقل جميع بيانات النظام المحلية إلى Firebase Realtime Database
                  </p>
                  {lastSyncTime && (
                    <p className="text-slate-400 text-xs flex items-center gap-1">
                      آخر مزامنة: <span className="text-slate-300">{lastSyncTime}</span>
                    </p>
                  )}
                </div>
                <Button
                  onClick={handleSync}
                  disabled={syncing || connectionStatus !== 'connected'}
                  className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
                >
                  {syncing ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      جاري المزامنة...
                    </>
                  ) : (
                    <>
                      <Cloud className="size-4" />
                      زامن إلى Firebase
                    </>
                  )}
                </Button>
              </div>

              {connectionStatus !== 'connected' && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <Info className="size-4 text-amber-400 shrink-0" />
                  <p className="text-amber-300 text-sm">
                    يجب الاتصال بـ Firebase أولاً قبل إجراء المزامنة
                  </p>
                </div>
              )}

              {/* Sync Results */}
              {syncResult && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 rounded-lg bg-slate-900/60 border border-slate-700/50 space-y-3"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-violet-400" />
                    <span className="text-white font-medium text-sm">نتيجة المزامنة</span>
                    {syncResult.total !== undefined && (
                      <Badge className="bg-violet-500/20 text-violet-400 border-violet-500/30">
                        {syncResult.total} سجل إجمالي
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {syncResult.employees !== undefined && (
                      <div className="flex items-center justify-between p-2 rounded bg-slate-800/50 border border-slate-700/30">
                        <span className="text-slate-400 text-xs">الموظفين</span>
                        <span className="text-violet-400 text-sm font-mono" dir="ltr">{syncResult.employees}</span>
                      </div>
                    )}
                    {syncResult.attendance !== undefined && (
                      <div className="flex items-center justify-between p-2 rounded bg-slate-800/50 border border-slate-700/30">
                        <span className="text-slate-400 text-xs">الحضور</span>
                        <span className="text-violet-400 text-sm font-mono" dir="ltr">{syncResult.attendance}</span>
                      </div>
                    )}
                    {syncResult.requests !== undefined && (
                      <div className="flex items-center justify-between p-2 rounded bg-slate-800/50 border border-slate-700/30">
                        <span className="text-slate-400 text-xs">الطلبات</span>
                        <span className="text-violet-400 text-sm font-mono" dir="ltr">{syncResult.requests}</span>
                      </div>
                    )}
                    {syncResult.rules !== undefined && (
                      <div className="flex items-center justify-between p-2 rounded bg-slate-800/50 border border-slate-700/30">
                        <span className="text-slate-400 text-xs">القواعد</span>
                        <span className="text-violet-400 text-sm font-mono" dir="ltr">{syncResult.rules}</span>
                      </div>
                    )}
                    {syncResult.quality !== undefined && (
                      <div className="flex items-center justify-between p-2 rounded bg-slate-800/50 border border-slate-700/30">
                        <span className="text-slate-400 text-xs">الجودة</span>
                        <span className="text-violet-400 text-sm font-mono" dir="ltr">{syncResult.quality}</span>
                      </div>
                    )}
                    {syncResult.travel !== undefined && (
                      <div className="flex items-center justify-between p-2 rounded bg-slate-800/50 border border-slate-700/30">
                        <span className="text-slate-400 text-xs">السفر</span>
                        <span className="text-violet-400 text-sm font-mono" dir="ltr">{syncResult.travel}</span>
                      </div>
                    )}
                    {syncResult.biometric !== undefined && (
                      <div className="flex items-center justify-between p-2 rounded bg-slate-800/50 border border-slate-700/30">
                        <span className="text-slate-400 text-xs">البصمة</span>
                        <span className="text-violet-400 text-sm font-mono" dir="ltr">{syncResult.biometric}</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Section 4: Getting Started Guide */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-white flex items-center gap-2">
              <BookOpen className="size-5 text-violet-400" />
              دليل البدء
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="guide" className="border-slate-700/50">
                <AccordionTrigger className="text-slate-300 hover:text-white hover:no-underline">
                  اضغط لعرض خطوات الإعداد التفصيلية
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3 pt-2">
                    {guideSteps.map((item) => (
                      <motion.div
                        key={item.step}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: item.step * 0.03 }}
                        className="flex gap-3 p-3 rounded-lg bg-slate-900/60 border border-slate-700/30"
                      >
                        <div className="shrink-0 w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center">
                          <span className="text-violet-400 text-sm font-bold">{item.step}</span>
                        </div>
                        <div className="space-y-1">
                          <p className="text-white font-medium text-sm">{item.title}</p>
                          <p className="text-slate-400 text-xs leading-relaxed">{item.description}</p>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      </motion.div>

      {/* Section 5: Database Rules Reference */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
      >
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-white flex items-center gap-2">
                <ShieldCheck className="size-5 text-violet-400" />
                قواعد أمان قاعدة البيانات
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyRules}
                className="border-slate-600 text-slate-300 hover:bg-slate-700 h-8"
              >
                {rulesCopied ? (
                  <>
                    <Check className="size-4 text-violet-400" />
                    تم النسخ
                  </>
                ) : (
                  <>
                    <Copy className="size-4" />
                    نسخ
                  </>
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <p className="text-slate-400 text-sm">
                الصق هذه القواعد في تبويب "القواعد" في Firebase Realtime Database للسماح بقراءة وكتابة البيانات
              </p>
              <div className="relative rounded-lg bg-slate-900 border border-slate-700/50 overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-8 bg-slate-800/80 flex items-center px-3 gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-400/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-violet-400/60" />
                  <span className="text-slate-500 text-xs mr-2 font-mono" dir="ltr">rules.json</span>
                </div>
                <pre
                  className="p-4 pt-12 text-sm font-mono text-violet-300/90 overflow-x-auto leading-relaxed"
                  dir="ltr"
                >
                  {databaseRules}
                </pre>
              </div>
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <Info className="size-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-amber-300 text-xs leading-relaxed">
                  هذه القواعد تسمح بالوصول الكامل للقراءة والكتابة. للاستخدام في بيئة الإنتاج، يُنصح بتقييد الوصول باستخدام قواعد أمان أكثر تحديدًا.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
