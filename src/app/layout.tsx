import type { Metadata } from "next";
import { Geist, Geist_Mono, Cairo } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { QueryProvider } from "@/lib/query-provider";

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
  title: "ARM ERP - نظام إدارة الموارد البشرية والجودة",
  description: "نظام متكامل لإدارة الموارد البشرية والجودة | ARM - CODE • CREATE • SOLVE",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${cairo.variable} antialiased bg-slate-950 text-slate-50`}
        style={{ fontFamily: 'var(--font-cairo), var(--font-geist-sans), "Segoe UI", Tahoma, sans-serif' }}
      >
        <QueryProvider>
          {children}
          <Toaster position="top-left" richColors />
        </QueryProvider>
      </body>
    </html>
  );
}