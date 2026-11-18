import type { Metadata } from "next";
import { Geist, Geist_Mono, Cairo } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { Toaster } from "sonner";
import { ThemeProvider } from "next-themes";
import { QueryProvider } from "@/lib/query-provider";
import { RtlDirectionProvider } from "@/components/shared/RtlDirectionProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Qnalys — منصة الذكاء التشغيلي",
  description: "منصة متكاملة لإدارة الجودة والأداء وذكاء العمليات | Qnalys",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // ══════════════════════════════════════════════════════════════
  //  §CSP-NONCE (production CSP recovery) — the per-request nonce
  //  minted by the middleware (§CSP-ORDER in src/middleware.ts).
  //
  //  Reading `headers()` here does two things, both REQUIRED for a
  //  nonce-based CSP with 'strict-dynamic':
  //    1. It opts every page into DYNAMIC rendering. Statically
  //       prerendered HTML is produced at build time and can never
  //       carry a per-request nonce — the served page kept
  //       `x-nextjs-prerender: 1` + an immutable `s-maxage=31536000`
  //       cache entry, so the browser received zero-nonce HTML under
  //       a nonce-enforcing policy (the production failure's second
  //       root-cause component).
  //    2. It exposes the nonce to the ONE application-level inline
  //       script in the document — next-themes' theme-boot <script> —
  //       which otherwise has no nonce attribute and is blocked under
  //       'strict-dynamic'. Next.js nonces its own framework scripts
  //       (bootstrap + flight data) directly from the request CSP;
  //       only this provider needs the value passed explicitly.
  // ══════════════════════════════════════════════════════════════
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    // §20.2 — next-themes owns the `dark`/`light` class on <html>.
    // defaultTheme="dark" preserves the app's visual identity; the
    // Settings page switches dark/light/system and the choice persists.
    // The provider MUST live INSIDE <body>: it renders a theme-boot
    // <script>, and wrapping <html> itself places that script outside
    // the main document (React 19/Next 16 hard-errors on that).
    <html lang="ar" dir="rtl" className="dark" suppressHydrationWarning>
      <body
        /* bg-slate-950 removed — slate is a NAVY-tinted scale and its
           color propagated to the canvas (scrollbar-gutter strip),
           producing the dark-blue edge seen at the viewport borders.
           The canvas is owned by the html background rule in
           globals.css (Qnalys charcoal/paper) + the base-layer
           bg-background token here. */
        className={`${geistSans.variable} ${geistMono.variable} ${cairo.variable} antialiased bg-background text-slate-50`}
        style={{ fontFamily: 'var(--font-cairo), var(--font-geist-sans), "Segoe UI", Tahoma, sans-serif' }}
      >
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange nonce={nonce}>
          <RtlDirectionProvider>
            <QueryProvider>
              {children}
              <Toaster position="top-left" richColors />
            </QueryProvider>
          </RtlDirectionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
