import './globals.css';

export const metadata = {
  title: 'Barkod Sipariş – Distribütör Paneli',
  description: 'Bağlı marketlerdeki stok durumu, sipariş önerileri ve teklifler.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="tr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
