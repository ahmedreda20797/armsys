import type { Metadata } from "next";
import { Geist, Geist_Mono, Cairo } from "next/font/google";
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
  title: "Qnlys — منصة الذكاء التشغيلي",
  description: "منصة متكاملة لإدارة الجودة والأداء وذكاء العمليات | Qnlys",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
           globals.css (Qnlys charcoal/paper) + the base-layer
           bg-background token here. */
        className={`${geistSans.variable} ${geistMono.variable} ${cairo.variable} antialiased bg-background text-slate-50`}
        style={{ fontFamily: 'var(--font-cairo), var(--font-geist-sans), "Segoe UI", Tahoma, sans-serif' }}
      >
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
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
