// ══════════════════════════════════════════════════════════════
//  Cross-page create pre-fill — pure builders (UX Corrections §1)
//
//  ROOT CAUSE FIXED: cross-module create intents arrive via
//  navigateTo navParams BEFORE the destination page mounts (the
//  PageRouter remounts pages per navigation). The old
//  "adjust state during render" guard compared navParams against a
//  useState(navParams) initializer — identical on mount — so the
//  creation dialog NEVER opened for freshly-mounted pages. These
//  builders are consumed in useState INITIALIALIZERS (mount-time
//  semantics) so the dialog opens immediately with context, plus a
//  render-time guard keeps handling intents that arrive while the
//  page is already mounted.
//
//  Only information the source actually provides is mapped — never
//  invented. Each builder documents its source keys.
// ══════════════════════════════════════════════════════════════

/** Create-intent payload carried in navParams (source key present). */
export interface CreateIntentNavParams {
  source?: string;
  title?: string;
  department?: string;
  priority?: string;
  employeeId?: string;
  problemDescription?: string;
  relatedFollowUpId?: string;
  relatedComplaintId?: string;
  relatedQualityDeductionId?: string;
  relatedHrDeductionId?: string;
  // Travel → Complaint extras
  sourceRecordId?: string;
  dealId?: string;
  customerName?: string;
  description?: string;
}

/** True when navParams carry a cross-page CREATE intent (not a detail link). */
export function hasCreateIntent(
  navParams: CreateIntentNavParams & { id?: string } | null | undefined,
): boolean {
  return Boolean(navParams && navParams.source && !navParams.id);
}

/**
 * CAPAQuickCreate defaultValues from any cross-module create intent
 * (Quality deduction / Complaint / Follow-up / Repetition alert …).
 * Maps ONLY the keys the CAPA model stores.
 */
export function capaDefaultsFromNavParams(
  navParams: CreateIntentNavParams | null | undefined,
): Record<string, string> {
  if (!navParams?.source) return {};
  const defaults: Record<string, string> = {};
  if (navParams.title) defaults.title = navParams.title;
  if (navParams.department) defaults.department = navParams.department;
  if (navParams.priority) defaults.priority = navParams.priority;
  if (navParams.employeeId) defaults.employeeId = navParams.employeeId;
  if (navParams.problemDescription) defaults.problemDescription = navParams.problemDescription;
  defaults.source = navParams.source;
  if (navParams.relatedFollowUpId) defaults.relatedFollowUpId = navParams.relatedFollowUpId;
  if (navParams.relatedComplaintId) defaults.relatedComplaintId = navParams.relatedComplaintId;
  if (navParams.relatedQualityDeductionId) defaults.relatedQualityDeductionId = navParams.relatedQualityDeductionId;
  if (navParams.relatedHrDeductionId) defaults.relatedHrDeductionId = navParams.relatedHrDeductionId;
  return defaults;
}

/** Complaint form fields pre-fillable from a Travel deal intent. */
export interface ComplaintPrefill {
  customerName: string;
  dealId: string;
  employeeId: string;
  description: string;
}

const EMPTY_COMPLAINT_PREFILL: ComplaintPrefill = {
  customerName: '',
  dealId: '',
  employeeId: '',
  description: '',
};

/**
 * Complaint pre-fill from the Travel page's intent (§7 of Milestone 7).
 * Only keys present in the intent are set — missing info stays empty.
 */
export function complaintPrefillFromTravelIntent(
  navParams: CreateIntentNavParams | null | undefined,
): ComplaintPrefill {
  if (!navParams || navParams.source !== 'travel') return EMPTY_COMPLAINT_PREFILL;
  return {
    customerName: navParams.customerName ?? '',
    dealId: navParams.dealId ?? '',
    employeeId: navParams.employeeId ?? '',
    description: navParams.description ?? '',
  };
}
