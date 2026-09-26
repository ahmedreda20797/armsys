"use client"

// ══════════════════════════════════════════════════════════════
//  Qnalys Toggle (§UX-STRUCTURE PART 8) — the ONE switch control.
//
//  Every on/off control in the app renders through this primitive
//  (Radix Switch under the hood — role="switch", aria-checked,
//  keyboard + focus-visible for free). Do NOT restyle toggles
//  per page; use this component.
//
//  State contract:
//    OFF        neutral token track, bright thumb at the inline
//               START — unmistakably off in dark AND light themes
//    ON         Qnalys brand track, thumb at the inline END
//    DISABLED   dimmed + not-allowed cursor (Radix `disabled`)
//    LOADING    `loading` prop: spinner replaces the thumb, input
//               blocked, current state stays readable — async
//               saves never look frozen or accept silent clicks
//
//  State is conveyed by THUMB POSITION and TRACK FILL, not color
//  alone. Colors come from semantic tokens — no hardcoded
//  dark-only values (§PART 17), RTL-safe travel (§PART 18).
// ══════════════════════════════════════════════════════════════

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

function Switch({
  className,
  loading = false,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & { loading?: boolean }) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      aria-busy={loading || undefined}
      disabled={props.disabled || loading}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent p-0.5 transition-colors outline-none",
        // OFF — neutral token track (light: soft gray / dark: charcoal)
        "data-[state=unchecked]:bg-input hover:data-[state=unchecked]:bg-border",
        // ON — Qnalys brand red
        "data-[state=checked]:bg-brand-600 hover:data-[state=checked]:bg-brand-500",
        // Focus — visible ring, never removed for compactness
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        // Disabled
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-4 rounded-full shadow-sm transition-transform",
          // Thumb: white in light, near-white in dark — high contrast on
          // both the neutral and the brand track (not color-only state).
          "bg-white dark:bg-slate-200 border border-black/10 dark:border-white/20",
          // Checked → inline END (inverted in RTL via dir-aware variant)
          "translate-x-0 data-[state=checked]:translate-x-4 rtl:data-[state=checked]:-translate-x-4",
          "data-[state=checked]:bg-white",
          // While loading the thumb yields to the spinner
          "data-[loading=true]:opacity-0"
        )}
        data-loading={loading || undefined}
      />
      {loading && (
        <Loader2
          data-slot="switch-loading"
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 animate-spin text-foreground/70"
        />
      )}
    </SwitchPrimitive.Root>
  )
}

/** Named alias — prefer this in new code (same component, one primitive). */
const QnalysToggle = Switch

export { Switch, QnalysToggle }
