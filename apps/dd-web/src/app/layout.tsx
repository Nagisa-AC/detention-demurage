import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import { readTheme } from "../theme";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-sans",
});

const plex = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "D&D Recovery",
};

/** Font, theme, and page background. This layout also wraps sign-in, so it does not check the session. */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = await readTheme();
  return (
    <html lang="en" data-theme={theme} className={`${inter.variable} ${plex.variable}`}>
      <body className={inter.className}>{children}</body>
    </html>
  );
}
