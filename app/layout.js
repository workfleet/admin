import { Poppins } from 'next/font/google';
import './globals.css';
import RegisterSW from './components/RegisterSW';

const poppins = Poppins({ subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap' });

export const metadata = {
  title: 'Workfleet',
  description: 'Job check-ins, tasks, photos and rota for cleaners and clients',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Workfleet',
  },
};

export const viewport = {
  themeColor: '#2fa5a9',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Served as a plain static asset from public/, not through the
            App Router icon convention - that pipeline hits a Windows path
            bug in this dev environment when generating icon metadata. */}
        <link rel="apple-touch-icon" href="/apple-icon.png" sizes="180x180" />
      </head>
      <body className={poppins.className}>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
