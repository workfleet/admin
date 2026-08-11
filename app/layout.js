import { Poppins } from 'next/font/google';
import './globals.css';

const poppins = Poppins({ subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap' });

export const metadata = {
  title: 'Workfleet',
  description: 'Job check-ins, tasks, photos and rota for cleaners and clients',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={poppins.className}>{children}</body>
    </html>
  );
}
