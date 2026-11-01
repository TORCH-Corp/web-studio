import '@/app/globals.css';
import RootLayoutShell, { defaultMetadata } from '@/components/RootLayoutShell';
import SessionNotice from '@/lib/platform/SessionNotice';

// TORCH spike patch: Google Fonts is unreachable from this sandbox, so the
// builder falls back to the system font stack. Upstream loads Inter here.
const inter = { variable: 'font-inter-fallback' };

export const metadata = defaultMetadata;

export default function BuilderLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <RootLayoutShell lang="en" bodyClassName={`${inter.variable} font-sans antialiased text-xs`}>
      {children}
      <SessionNotice />
    </RootLayoutShell>
  );
}
