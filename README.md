# MK Pati — Veteriner Klinik Yönetim Sistemi

Veteriner klinikleri için multi-tenant hasta, muayene, aşı, tedavi ve randevu
yönetimi; yazılı ve uygulama içi sesli **MK Pati AI Klinik Danışmanı**.
MK Digital Systems ürünüdür.

## Teknoloji

- Next.js 16 App Router, React 19 ve TypeScript
- Tailwind CSS 4
- Supabase Auth, PostgreSQL ve Storage (hasta fotoğrafları, özel bucket)
- `@supabase/ssr` ile sunucu tarafı oturum yönetimi
- PostgreSQL Row Level Security ile tenant izolasyonu
- OpenAI (yalnızca sunucu tarafı): klinik danışmanı ve konuşmanın yazıya çevrilmesi

## Roller

| Rol | Kapsam |
| --- | --- |
| `PLATFORM_ADMIN` | MK Digital Systems. Klinik onayı, aktif/pasif, erişim süresi, hekim/personel limitleri, modüller, AI ve sesli AI yetkisi, aylık AI kotası, platform istatistikleri. Tenant üyesi olamaz. |
| `CLINIC_ADMIN` | Klinik yöneticisi. Tüm klinik kayıtları, ekip onayı/pasife alma, operasyon özeti. |
| `VETERINARIAN` | Kliniğin tüm hastaları; muayene ve tedavi kaydı. |
| `CLINIC_STAFF` | Sahip, hasta, randevu ve aşı kayıtları. Muayene ve tedavi kayıtlarını göremez. |
| Hayvan sahibi (portal) | Klinik davetiyle bağlanan ayrı hesap. Yalnızca kendi hayvanlarının aşı/randevu bilgileri ve kendi talepleri; klinik tablolarına doğrudan erişimi yoktur. |

## Modüller

- Dashboard: bugünkü randevular, yaklaşan kontroller ve aşılar, hasta/sahip sayıları, hekim bazında randevular, son işlemler
- Hayvan sahipleri, hastalar (fotoğraf, mikroçip, yaklaşık yaş), muayeneler, tedavi/işlem geçmişi, aşı takibi
- Randevular: hekim çakışma kontrolü, durum akışı
- MK Pati AI: hasta detayında ve genel sayfada; yazılı veya uygulama içi sesli
- Hayvan sahibi portalı (`/portal`): MK Pati AI ile yazılı veya uygulama içi sesli konuşma, randevu ve ilaç talebi, talep durumu
- Sahip talepleri (`/app/[slug]/requests`): klinik randevu taleplerini saat vererek onaylar; ilaç taleplerini yalnızca veteriner hekim/klinik yöneticisi yanıtlar. Menüde bekleyen talep sayacı.
- Platform Admin: klinikler, başvurular, kullanım ve AI istatistikleri, audit log

## MK Pati AI

- Tek endpoint (`POST /api/clinics/[slug]/advisor`), yazılı (JSON) ve sesli (multipart ses) istekler aynı
  oturum, tenant, rol, kota, politika ve güvenlik katmanından geçer (`lib/clinic-ai/advisor.ts`).
- Serbest istek önce beyaz listedeki bir işleme sınıflandırılır; veri, rolün izin verdiği işlem için
  kullanıcının kendi RLS istemcisiyle ve en az alanla okunur. Model SQL, araç veya service-role erişimi almaz.
- Teşhis, reçete, ilaç/doz ve tedavi kararı üretmez; kayıtta olmayan doz/kesin teşhis ifadeleri kodda
  engellenir (`lib/ai/safety.ts`). Klinik yanıtlara uyarı notu uygulama tarafından eklenir.
- Sesli konuşma yalnızca uygulama içidir: mikrofon kaydı sunucuda OpenAI ile yazıya çevrilir, yanıt tarayıcıda
  sesli okunur. Telefon araması, SIP/GSM veya WhatsApp entegrasyonu yoktur.
- Hayvan sahibi asistanı (`POST /api/portal/assistant`, `lib/owner-ai/assistant.ts`) aynı sağlayıcı, güvenlik
  filtresi, kota ve kayıt altyapısını kullanır; daha dar bir politikayla çalışır. Acil belirtiler model çağrısı
  beklenmeden kliniğe yönlendirilir. Randevu/ilaç talepleri yalnızca **taslak** olarak hazırlanır; sahip onaylar,
  klinik yanıtlar. İlaç adı yalnızca sahibin kendi söylediği ifadeden alınır; AI ilaç önermez. Her sahip için günlük
  40 AI isteği sınırı vardır.

## Yerel geliştirme

Node.js 22+ kullanın:

```bash
npm install
npm run dev
```

Windows PowerShell’de `npm` yerine gerekirse `npm.cmd` kullanın. `.env.local` için gerekli değişkenler
`.env.example` dosyasındadır. Gerçek anahtarları Git’e eklemeyin.

## Supabase migration sırası

1. `202609240001_platform_foundation.sql`
2. `202609240002_crm_core.sql`
3. `202609240003_engagement_core.sql`
4. `202609240004_platform_controls.sql`
5. `202609240005_seed_platform_admin.sql`
6. `202609240006_self_service_registration.sql`
7. `202609240007_whatsapp_ai_outreach.sql`
8. `202609250008_remove_real_estate.sql` — **geri alınamaz**: emlak/WhatsApp/telefon tablolarını siler. Önce yedek alın.
9. `202609250009_clinic_roles_entitlements.sql` — rol ve entitlement dönüşümü
10. `202609250010_clinic_core.sql` — klinik çekirdek şeması, RLS, hasta fotoğrafı bucket’ı
11. `202609250011_clinic_ai.sql` — AI konuşma kayıtları ve atomik kota
12. `202609250012_platform_overview.sql` — Platform Admin istatistikleri
13. `202609250013_owner_portal.sql` — hayvan sahibi portalı, davetler, talepler, sahip AI kotası

Migration’lar ileri yönlüdür; eski dosyalar değiştirilmez. Önce staging ortamında deneyin. Kod, migration
uygulandıktan sonra deploy edilmelidir. Production migration ve deploy işlemleri otomatik değildir.

## Güvenlik modeli

- Her klinik tablosunda `business_id` ve aynı klinik içinde kalmayı zorlayan bileşik yabancı anahtarlar vardır.
- RLS + kolon bazlı GRANT: kullanıcılar kayıt silemez, `business_id` değiştiremez.
- Muayene/tedavi kayıtları yalnızca `CLINIC_ADMIN` ve `VETERINARIAN` tarafından okunur; düzenleme yalnızca kaydı
  yazan hekim veya klinik yöneticisi tarafından yapılabilir.
- AI konuşmaları yalnızca sahibi ve klinik yöneticisi tarafından görülür.
- Service-role anahtarı yalnızca Platform Admin işlemleri ve kayıt ön kontrolü için sunucuda kullanılır.

## Kontroller

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Migration, RLS ve AI orkestrasyon testleri geçici PGlite veritabanında veya bellek içi sahte istemciyle çalışır;
gerçek Supabase verisini ya da OpenAI’ı kullanmaz.
