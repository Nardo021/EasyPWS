import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "EasyPWS",
  description: "Easy Price Watch Service — self-hosted price monitoring",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
