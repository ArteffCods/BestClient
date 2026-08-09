import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'BestClient',
  description: 'PvP-optimized Minecraft launcher',
};

export const viewport: Viewport = {
  themeColor: '#0d0910',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}
