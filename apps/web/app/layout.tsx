import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import './globals.css';

/**
 * The root layout owns the document and nothing else.
 *
 * There are two shells above the pages, and neither belongs here:
 *
 *   app/(marketing)  → `/` and `/pricing`. Centred, top nav, full footer.
 *                      This is the face of the product.
 *   app/(app)        → `/jobs` and `/keys`. Sidebar, dense, no marketing
 *                      furniture. This is the tool.
 *
 * Route groups, so the URLs are unchanged — `(marketing)` and `(app)` never
 * appear in a path. Putting a header here instead would force both shells to
 * live with one set of chrome, which is the thing this split exists to undo.
 */

export const metadata: Metadata = {
  title: {
    default: 'Email Validator',
    template: '%s · Email Validator',
  },
  description:
    'Syntax, domain and policy verification for email lists. Every result carries a status, a confidence and a reason.',
  applicationName: 'Email Validator',
  // The dashboard is single-tenant and holds customer lists. It has no
  // business in a search index.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // Matches --color-canvas in app/globals.css, so the browser paints its own
  // chrome the same off-white instead of flashing pure white before the CSS
  // lands. One value, because the app has one theme.
  themeColor: '#faf9f7',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {/* First tab stop on every page, in either shell. Visible only when
            focused; both shells put `id="main"` on their content region. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-ink"
        >
          Skip to content
        </a>

        {children}
      </body>
    </html>
  );
}
