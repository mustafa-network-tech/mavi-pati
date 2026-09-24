import "./globals.css";
export const metadata = {
  title: "MK Emlak Asistanı",
  description: "Lead, iletişim, randevu ve CRM için AI destekli emlak asistanı",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
