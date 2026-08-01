import type { Metadata } from "next";
// Suppress TypeScript warning for side-effect CSS import when no global CSS types are declared
// @ts-ignore
import "./globals.css";
import "bootstrap-icons/font/bootstrap-icons.css";

export const metadata: Metadata = {
  title: "Synapse Snaps — Studio",
  description: "Content automation studio for Synapse Snaps"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        
        {/* Apply dark class by default; toggle script keeps it in sync with localStorage */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var stored = localStorage.getItem('ss-theme');
                  var html = document.documentElement;
                  if (stored === 'light') {
                    html.classList.add('light');
                  } else {
                    // default: dark (no class needed since :root vars are dark)
                    html.classList.remove('light');
                  }
                } catch(e) {}
              })();
            `,
          }}
        />
      </head>
      <body style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>{children}</body>
    </html>
  );
}