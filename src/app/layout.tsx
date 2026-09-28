import type { Metadata, Viewport } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const serif = Fraunces({ subsets: ["latin"], variable: "--font-serif-display", display: "swap", axes: ["opsz"] });

export const metadata: Metadata = {
  title: "As fotos de todo mundo",
  description: "Álbum privado da família",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#F7F3EE", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${serif.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
