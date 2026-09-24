import Link from "next/link";

const modules = [
  "Potansiyel müşteriler",
  "İlanlar",
  "Danışman atamaları",
  "WhatsApp",
  "AI aramalar",
  "Randevular",
];

export default function Home() {
  return (
    <main className="saas-landing">
      <nav className="landing-nav">
        <span className="saas-logo">
          <span>MK</span> Emlak Asistanı
        </span>
        <div>
          <Link href="/login" className="saas-link-button">
            Giriş yap
          </Link>
          <Link href="/register" className="saas-primary">
            Ofis başvurusu
          </Link>
        </div>
      </nav>

      <section className="landing-hero">
        <div>
          <p className="saas-kicker">AI destekli emlak operasyon platformu</p>
          <h1>Lead’den randevuya, bütün süreç tek çalışma alanında.</h1>
          <p className="landing-copy">
            Potansiyel müşterileri ve ilanları yönetin, danışman atayın,
            iletişimi takip edin ve her görüşmeyi ölçülebilir bir CRM sürecine
            dönüştürün.
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
        <div className="landing-panel" aria-label="Ürün akışı">
          <span>LEAD / İLAN</span>
          <b>AI ANALİZ</b>
          <span>DANIŞMAN ONAYI</span>
          <b>GÖRÜŞME</b>
          <span>RANDEVU</span>
          <b>CRM / TAKİP</b>
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
