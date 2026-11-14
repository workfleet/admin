import { Poppins, Inter } from 'next/font/google';
import './globals.css';
import RegisterSW from './components/RegisterSW';
import { ConfirmProvider } from './components/ConfirmProvider';
import { ToastProvider } from './components/ToastProvider';
import TooltipLayer from './components/TooltipLayer';

// Route W type: Poppins to read, Inter to count. brand.css picks these
// up as --wf-display and --wf-data. Since the modern pass (2026-11-13)
// Inter carries the working text and Poppins only headings (600), names
// on the rota (500) and the "Work" of the wordmark (300) - so 400 and 700
// are no longer loaded. Each Poppins weight is its own file preloaded on
// every first visit; anything still asking for 400 or 700 gets the
// nearest loaded cut.
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['300', '500', '600'],
  variable: '--font-poppins',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  // 700 now that Inter carries the app's working text (--app-ui-font in
  // globals.css) - older rules that ask for bold get the real cut.
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata = {
  title: 'WorkFleet',
  description: 'Job check-ins, tasks, photos and rota for cleaners and clients',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'WorkFleet',
  },
};

export const viewport = {
  themeColor: '#202327',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${poppins.variable} ${inter.variable}`}>
      <head>
        {/* Served as a plain static asset from public/, not through the
            App Router icon convention - that pipeline hits a Windows path
            bug in this dev environment when generating icon metadata. */}
        <link rel="apple-touch-icon" href="/apple-icon.png" sizes="180x180" />
        <link rel="icon" href="/brand-mark.svg" type="image/svg+xml" />
        <link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192" />
        {/* Chrome fires beforeinstallprompt as soon as it has the manifest
            and service worker, which on a fast connection beats our own
            bundle to it - and the event only ever fires once. Catching it
            here, inline and before any chunk loads, is the only way to be
            sure it is not lost; lib/pwaInstall.js adopts whatever landed. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__wfInstallEvent=e;});",
          }}
        />
      </head>
      <body>
        <ToastProvider>
          <ConfirmProvider>
            {children}
          </ConfirmProvider>
        </ToastProvider>
        <RegisterSW />
        <TooltipLayer />
      </body>
    </html>
  );
}
