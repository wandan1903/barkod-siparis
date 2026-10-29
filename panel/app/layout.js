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
        {/* E-postadaki şifre sıfırlama bağlantısı yanlışlıkla ana sayfaya düşerse, oturum açılıp panele
            geçilmeden önce şifre belirleme sayfasına taşır (adres parçası korunur). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var h=location.hash;if(h&&h.indexOf('type=recovery')>-1&&location.pathname!=='/sifre-yenile'){location.replace('/sifre-yenile'+location.search+h);}}catch(e){}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
