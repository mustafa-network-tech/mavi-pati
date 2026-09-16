# Veteriner Sesli Asistan V1

MK Digital Systems için Mavi Pati demo kliniği. Next.js App Router, TypeScript, Tailwind ve Supabase. Yönetim, giriş, randevu sistemi veya ücretli LLM API içermez.

## Kurulum

Node.js 22+ kullanın. Windows PowerShell’de `npm.cmd install`, `Copy-Item .env.example .env.local`, ardından `npm.cmd run dev`. Diğer kabuklarda `npm` kullanabilirsiniz.

`.env.local` içinde `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, yalnızca sunucuda kullanılan `SUPABASE_SERVICE_ROLE_KEY` ve rastgele uzun `RATE_LIMIT_SALT` değerlerini ayarlayın. Gerçek anahtarları Git’e eklemeyin.

Supabase SQL Editor üzerinden sırasıyla `supabase/migrations/202609160001_v1.sql` ve `supabase/seed.sql` çalıştırın. Alternatif: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202609160001_v1.sql` ve `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql`. Migration ilk kurulum içindir; seed yeniden çalıştırılabilir.

Demo adresi `/mavi-pati`. Seed 40 bilgi kaydı içerir. Klinik ve bilgi bankası Supabase’den okunur; bağlantı eksikse sahte kayıt başarısı gösterilmez.

Yerel geliştirmede iki public Supabase değişkeni de boşsa otomatik mock klinik modu açılır. Klinik ve 40 soru `supabase/seed.sql` dosyasından üretilmiş `lib/demo/seed.json` üzerinden gelir. Seed değiştiğinde `node scripts/generate-demo.mjs` çalıştırın. Mock yalnızca development modunda çalışır; Supabase ayarlarından biri bile mevcutsa bağlantı hataları örnek verilerle gizlenmez. Cevapsız soru formu mock modunda kullanılabilir: onaylanan kayıt sunucu belleğinde tutulur ve ardından WhatsApp bağlantısı hazırlanır. En fazla 100 geçici kayıt tutulur, bir saatten eski kayıtlar sonraki yazmada temizlenir; yeniden başlatmada tümü silinir. UI gerçek iletim yerine demo kayıt başarısını gösterir. Otomatik WhatsApp gönderimi ve interaction veritabanı kaydı yapılmaz. Production modunda Supabase zorunludur.

## Cevapsız soru ve WhatsApp

Güven eşiği veya adaylar arası fark yetersizse kayıtlı cevap kullanılmaz. İstenen cevapsız soru metni gösterilir ve tarayıcı TTS ile okunur. Ad Soyad, Telefon ve onay sunucuda doğrulanır. Klinik, URL slug’ından çözülür; istemci clinic_id göndermez.

`lib/unanswered.ts` yalnızca veritabanına kayıt yapar. Kayıttan sonra `lib/notifications/` sağlayıcısı clinic.whatsapp üzerinden URL encoding uygulanmış bağlantı hazırlar. UI başarı mesajı ve “WhatsApp ile Kliniğe İlet” bağlantısını gösterir. Kullanıcı WhatsApp’ta mesajı kendisi gönderir; otomatik gönderim yapılmaz. Numara yalnızca demo seed kaydındadır. Diğer klinikler kendi whatsapp alanlarını kullanır. Eksik/geçersiz numara kayıt başarısını engellemez, WhatsApp bağlantısı gösterilmez.

Gelecekte `AutomaticNotificationProvider.send` implementasyonu sunucuda WhatsApp Business API kullanabilir. Güvenilir otomatik teslimat için ayrı outbox/queue, tekrar deneme ve idempotency ekleyin; kayıt işlemini bildirime bağlamayın.

## Veri ve güvenlik

Tablolar: clinics, assistant_knowledge, unanswered_questions, assistant_interactions; ayrıca paylaşımlı rate limit için request_quotas. Klinik verileri clinic_id ile ayrılır. Knowledge/interaction ilişkisi bileşik foreign key ile aynı klinikle sınırlandırılır. RLS yalnızca aktif kliniklerin izin verilen public sütunlarının okunmasını sağlar. Anon/authenticated ziyaretçiler doğrudan hassas tablo okuyamaz, INSERT/UPDATE/DELETE yapamaz. Yazmalar doğrulanan sunucu endpoint’lerinden geçer. Service role yalnızca server-only modüllerdedir.

Origin kontrolü, onay doğrulaması, metin uzunluk sınırı, honeypot ve PostgreSQL üzerinden dakikada 10 istek sınırı vardır. Vercel dışındaki hostinglerde güvenilir proxy’nin x-forwarded-for başlığını yönetmesini sağlayın. Dağıtık bot saldırıları için ek edge koruması gerekir.

## Ses ve eşleştirme

BrowserSpeechRecognitionProvider Web Speech API kullanır (`tr-TR`); destek ve izin cihazda değişebilir. Chrome üzerinde HTTPS/localhost kullanın. Desteklenmeyen tarayıcıda yazılı giriş çalışır. Tarayıcı ses tanıma servisi sesi kendi sağlayıcısına gönderebilir. BrowserTextToSpeechProvider speechSynthesis ve varsa Türkçe ses kullanır; ses yoksa yazılı cevap kalır. Gerçek mikrofon/TTS kontrolü cihaz üzerinde yapılmalıdır.

Eşleştirme Türkçe normalizasyon, canonical/alternative phrase token similarity ve keyword coverage kullanır; eşik .82, ikinci adaydan fark .08. Kedi/köpek ve bazı aşı ayrımları kontrol edilir. Bu kontrollü V1 motoru tüm Türkçe ifadeleri anlayamaz; belirsizlikte cevapsız akışa döner.

## Kontrol ve yayın

`npm.cmd test`, `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run build`.

Vercel’e repository import edin, Next.js preset kullanın; dört environment variable’ı tanımlayın. Supabase migration/seed’i önce uygulayın, ardından deploy edin. Build secrets olmadan çalışır; runtime veri erişimi için yapılandırma gereklidir. Canlı Supabase yazımı, RLS, Chrome mikrofonu/TTS ve 360/390/430px cihaz kontrollerini yayın öncesinde tamamlayın.

V2 için slug/clinic context, clinic_id ilişkileri, speech sağlayıcıları, bildirim arayüzleri ve interaction analytics temeli hazırdır. Kullanılmayan müşteri/hayvan/yönetim tabloları oluşturulmamıştır.
