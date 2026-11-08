import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Itqan LMS",
  description: "Multi-tenant learning management system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className="antialiased min-h-screen bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}
