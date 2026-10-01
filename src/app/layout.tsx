import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Revenue Intelligence", template: "%s · Revenue Intelligence" },
  description: "Verificação independente entre contrato, operação e faturamento.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
