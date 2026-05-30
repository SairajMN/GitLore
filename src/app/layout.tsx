import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GitLore - Code Archaeology Assistant',
  description: 'Understand why code evolved the way it did. Trace commits, PRs, issues, and historical engineering decisions.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-[var(--border)] px-6 py-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <a href="/" className="text-xl font-bold text-[var(--primary)]">
              GitLore
            </a>
            <nav className="flex gap-4 text-sm text-[var(--muted)]">
              <a href="/" className="hover:text-[var(--foreground)] transition-colors">Search</a>
              <a href="/watchlist" className="hover:text-[var(--foreground)] transition-colors">Watchlists</a>
            </nav>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
