import "./globals.css";
export const metadata = {
  title: "MK Pati — Veteriner Klinik Yönetim Sistemi",
  description: "Veteriner klinikleri için hasta, muayene, aşı, randevu yönetimi ve MK Pati AI Klinik Danışmanı",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
