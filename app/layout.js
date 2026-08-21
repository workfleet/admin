import { Poppins, Inter } from 'next/font/google';
import './globals.css';
import RegisterSW from './components/RegisterSW';
import { ConfirmProvider } from './components/ConfirmProvider';
import { ToastProvider } from './components/ToastProvider';
import TooltipLayer from './components/TooltipLayer';

// Route W type: Poppins to read, Inter to count. brand.css picks these
// up as --wf-display and --wf-data. 300 is the body weight and 600 the
// heading weight; 700 is loaded only because a handful of older rules
// still ask for it, and faux-bold looks worse than the real cut.
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
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
