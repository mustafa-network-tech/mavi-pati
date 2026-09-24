# MK Emlak Asistanı

Emlak ofisleri için geliştirilen multi-tenant lead, ilan, iletişim, AI telefon
görüşmesi, WhatsApp ve randevu yönetim platformu.

## Teknoloji

- Next.js 16 App Router, React 19 ve TypeScript
- Tailwind CSS 4
- Supabase Auth ve PostgreSQL
- `@supabase/ssr` ile sunucu tarafı oturum yönetimi
- PostgreSQL Row Level Security ile tenant izolasyonu
- Vercel uyumlu serverless mimari

## Modüller

- Platform Admin: ofis başvuruları, erişim süreleri, özellikler ve kotalar
- Ofis çalışma alanı: Dashboard, Lead’ler, İlanlar ve Ayarlar
- İletişim: WhatsApp taslakları, provider-bağımsız AI aramaları
- CRM: lead durum akışı, danışman ataması, notlar ve aktiviteler
- Randevular ve görüşme geçmişi
- Serbest SQL yerine kontrollü AI araçları

## Yerel geliştirme

Node.js 22+ kullanın:

```bash
npm install
npm run dev
```

Windows PowerShell’de `npm` yerine gerekirse `npm.cmd` kullanın. Uygulama
varsayılan olarak `http://localhost:3000` adresinde açılır.

`.env.local` için gerekli değişkenler `.env.example` dosyasında listelenir.
Gerçek anahtarları Git’e eklemeyin. Her satır `NAME=value` biçiminde olmalıdır.

## Supabase migration sırası

Yeni bir ortamda aşağıdaki dosyaları sırayla uygulayın:

1. `202609240001_platform_foundation.sql`
2. `202609240002_crm_core.sql`
3. `202609240003_engagement_core.sql`
4. `202609240004_platform_controls.sql`

Migration’ları önce staging ortamında deneyin. Production migration ve deploy
işlemleri otomatik değildir.

## Güvenlik modeli

- `PLATFORM_ADMIN`, tenant üyeliğinden ayrı tutulur.
- Tenant kullanıcıları `OFFICE_ADMIN` veya `ADVISOR` rolüne sahiptir.
- Her operasyon tablosunda `business_id` bulunur.
- RLS politikaları tenant ve danışman ataması sınırlarını uygular.
- Hassas işlemler doğrulanan Server Action veya kontrollü PostgreSQL RPC
  fonksiyonlarından geçer.
- AI çalışma zamanı doğrudan SQL çalıştıramaz; yalnızca izinli domain araçlarını
  çağırabilir.
- WhatsApp manuel modunda mesaj `DRAFT` olarak kaydedilir; teslim edilmiş gibi
  gösterilmez.

## Sağlayıcılar

Gerçek AI, telefon/SIP ve WhatsApp Business API bağlantıları provider
arayüzlerinin arkasındadır. Credential verilmeden telefon çağrıları
`UNCONFIGURED`, WhatsApp ise `MANUAL_DEEP_LINK` modunda kalır.

## Kontroller

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Migration ve RLS testleri geçici PGlite veritabanında çalışır; gerçek Supabase
verisini değiştirmez.
