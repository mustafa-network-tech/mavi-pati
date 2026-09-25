import Link from "next/link";

const modules = [
  "Hasta ve hayvan sahibi kayıtları",
  "Muayene ve tedavi geçmişi",
  "Aşı ve kontrol takibi",
  "Randevu takvimi",
  "Klinik ekibi ve yetkiler",
  "MK Pati AI Klinik Danışmanı",
];

export default function Home() {
  return (
    <main className="saas-landing">
      <nav className="landing-nav">
        <span className="saas-logo">
          <span>MK</span> Pati
        </span>
        <div>
          <Link href="/login" className="saas-link-button">
            Giriş yap
          </Link>
          <Link href="/register" className="saas-primary">
            Klinik başvurusu
          </Link>
        </div>
      </nav>

      <section className="landing-hero">
        <div>
          <p className="saas-kicker">Veteriner Klinik Yönetim Sistemi</p>
          <h1>Hasta kaydından kontrole, bütün klinik tek çalışma alanında.</h1>
          <p className="landing-copy">
            Hasta ve sahip kayıtlarını, muayene ve aşı geçmişini, randevuları ve
            klinik ekibini yönetin. MK Pati AI kayıtlarınızı yazılı veya sesli
            olarak özetler; veteriner hekim değerlendirmesinin yerine geçmez.
          </p>
          <div className="landing-actions">
            <Link href="/register" className="saas-primary">
              Başvuru oluştur
            </Link>
            <Link href="/login" className="saas-secondary">
              Çalışma alanına gir
            </Link>
          </div>
        </div>
        <div className="landing-panel" aria-label="Klinik akışı">
          <span>SAHİP / HASTA</span>
          <b>RANDEVU</b>
          <span>MUAYENE</span>
          <b>TEDAVİ / AŞI</b>
          <span>KONTROL TAKİBİ</span>
          <b>AI ÖZET</b>
        </div>
      </section>

      <section className="module-grid" aria-label="Ürün modülleri">
        {modules.map((module, index) => (
          <article key={module}>
            <small>0{index + 1}</small>
            <h2>{module}</h2>
          </article>
        ))}
      </section>
    </main>
  );
}
