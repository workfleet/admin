export default function manifest() {
  return {
    name: 'WorkFleet',
    short_name: 'WorkFleet',
    description: 'CrewConnect Cleaning operations app — jobs, rota, requests and messages',
    start_url: '/',
    display: 'standalone',
    background_color: '#202327',
    theme_color: '#202327',
    icons: [
      { src: '/brand-mark.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
