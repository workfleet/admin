export default function manifest() {
  return {
    name: 'Workfleet',
    short_name: 'Workfleet',
    description: 'CrewConnect Cleaning operations app — jobs, rota, requests and messages',
    start_url: '/',
    display: 'standalone',
    background_color: '#1e2526',
    theme_color: '#2fa5a9',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
