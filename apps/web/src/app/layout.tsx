import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { Shell } from "@/components/Shell";
import "./globals.css";

// Inter, bundled locally (next/font/local) so it works fully offline — no build-time fetch.
const inter = localFont({ src: "./fonts/Inter.woff2", variable: "--font-inter", display: "swap", weight: "100 900" });

export const metadata: Metadata = {
  title: { default: "Project Autopilot", template: "%s · Autopilot" },
  description: "A calm team control room: standing goals, sandboxed AI workers, a different AI verifier, a plain-code gate and human approval.",
  icons: { icon: "/icon.svg" },
};

// Set the theme before paint (respects system preference unless the user chose one).
const themeScript = `(function(){try{var t=localStorage.getItem('theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static theme bootstrap */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
