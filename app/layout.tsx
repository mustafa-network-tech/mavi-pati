import "./globals.css";
export const metadata = {
  title: "Mavi Pati · Sesli Asistan",
  description: "Veteriner kliniğinizin sesli bilgi asistanı",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
