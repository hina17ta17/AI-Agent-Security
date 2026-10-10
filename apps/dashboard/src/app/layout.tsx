import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Noto_Sans_JP, Zen_Maru_Gothic } from "next/font/google";

import { Providers } from "./providers";
import "./globals.css";

const zen = Zen_Maru_Gothic({ variable: "--font-zen", weight: ["500", "700"], subsets: ["latin"], preload: false });
const noto = Noto_Sans_JP({ variable: "--font-noto", subsets: ["latin"], preload: false });
const mono = JetBrains_Mono({ variable: "--font-jbmono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AgentGuard",
  description: "小さなお店のサイトを、AIのチームが守ります。攻撃を検知した瞬間だけAIが出動して、解析・防御・報告まで自律的に行います。",
};

export const viewport: Viewport = { themeColor: "#4f46e5" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={`${zen.variable} ${noto.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
