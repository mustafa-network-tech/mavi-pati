# Veteriner Sesli Asistan V1

MK Digital Systems için Mavi Pati demo kliniği. Next.js App Router, TypeScript, Tailwind ve Supabase. Yönetim, giriş, randevu sistemi veya ücretli LLM API içermez.

## Kurulum

Node.js 22+ kullanın. Windows PowerShell’de `npm.cmd install`, `Copy-Item .env.example .env.local`, ardından `npm.cmd run dev`. Diğer kabuklarda `npm` kullanabilirsiniz.

Supabase ayarları girilmiş olsa da mock veriyi denemek için `npm.cmd run dev:mock` kullanın. Bu komut yalnızca kendi geliştirme sürecindeki public Supabase değişkenlerini boş bırakır; `.env.local` dosyasını değiştirmez. Mock sunucusu ayrı `.next-mock` çıktı dizini kullanır. Aynı anda normal dev sunucusu çalışıyorsa `npm.cmd run dev:mock -- --port 3001` ile ayrı portta açabilirsiniz. Vercel ve normal build varsayılan `.next` dizinini kullanır.

`.env.local` içinde `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, yalnızca sunucuda kullanılan `SUPABASE_SERVICE_ROLE_KEY` ve rastgele uzun `RATE_LIMIT_SALT` değerlerini ayarlayın. Gerçek anahtarları Git’e eklemeyin.

Yeni Supabase kurulumu için SQL Editor üzerinden sırasıyla `supabase/migrations/202609160001_v1.sql`, `supabase/migrations/202609160002_languages.sql`, `supabase/seed.sql` ve `supabase/seed-ru.sql` çalıştırın. `psql` alternatifi: her dosya için `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f DOSYA_YOLU`. Migration dosyaları bir kez uygulanır; seed dosyaları yeniden çalıştırılabilir.

**Mevcut çalışan veritabanında:** V1 migration'ını tekrar çalıştırmayın. Yalnızca `supabase/migrations/202609160002_languages.sql`, ardından `supabase/seed-ru.sql` uygulayın. Yeni migration mevcut metinleri veya kayıtları silmez; eski knowledge, interaction ve cevapsız soru kayıtlarına `language_code = 'tr'` ekler. Klinik ve canonical soru benzersizliği dile göre genişletilir; RLS kuralları korunur. Bu dosyaları uyguladıktan sonra yeni kodu Vercel'e yayınlayın. Yeni environment variable gerekmiyor.

Demo adresi `/mavi-pati`. Varsayılan dil Türkçe; Rusça doğrudan `/mavi-pati?lang=ru` ile açılabilir. Bilgi bankasında 40 Türkçe ve 40 Rusça kayıt vardır. Klinik ve bilgi bankası Supabase’den okunur; bağlantı eksikse sahte kayıt başarısı gösterilmez.

Yerel geliştirmede iki public Supabase değişkeni de boşsa otomatik mock klinik modu açılır. Klinik ve 80 soru `supabase/seed.sql` ve `supabase/seed/ru.json` kaynaklarından üretilmiş `lib/demo/seed.json` üzerinden gelir. Seed değiştiğinde `npm.cmd run seed:demo` çalıştırın; bu komut mock veriyi ve Rusça SQL seed'ini birlikte üretir. Mock yalnızca development modunda çalışır; Supabase ayarlarından biri bile mevcutsa bağlantı hataları örnek verilerle gizlenmez. Cevapsız soru formu mock modunda kullanılabilir: onaylanan kayıt sunucu belleğinde tutulur ve ardından WhatsApp bağlantısı hazırlanır. En fazla 100 geçici kayıt tutulur, bir saatten eski kayıtlar sonraki yazmada temizlenir; yeniden başlatmada tümü silinir. UI gerçek iletim yerine demo kayıt başarısını gösterir. Otomatik WhatsApp gönderimi ve interaction veritabanı kaydı yapılmaz. Production modunda Supabase zorunludur.

## Dil mimarisi

`locales/tr.ts` ve `locales/ru.ts` tüm arayüz, durum, hata ve cevapsız soru metinlerini içerir. `locales/index.ts` dil kodlarını, görünen adları, STT/TTS locale'lerini ve eşleştirme profillerini kaydeder. Yeni dil için aynı şemaya uygun locale, registry girdisi ve o dile ait knowledge seed'i ekleyin. SQL dil kodlarını TR/RU ile sınırlamaz.

`clinics.supported_languages`, `clinics.default_language` ve `clinics.name_translations` klinik başına dil seçimini ve görünen adı belirler. Demo varsayılanı `tr`, desteklenen diller `tr/ru` şeklindedir. Yeni yönetim ekranı oluşturulmamıştır.

UI seçilen dili API'ye `language_code` ile gönderir. Erken doğrulama/rate-limit hatalarının da çevrilmesi için `X-Assistant-Language` başlığı kullanılır. Sunucu dili doğrular, kliniğin desteklediğini kontrol eder ve knowledge sorgusunu hem `clinic_id` hem `language_code` ile filtreler. Matching motoru ayrıca dili kontrol eder; başka dildeki kayıtla eşleşme olmaz. Cevapsız soru ve interaction kayıtları seçilen dili saklar. WhatsApp personel bildirimi mevcut Türkçe formatını korur; müşterinin orijinal Rusça sorusu değiştirilmeden taşınır.

Dil değişiminde metin/cevap/form temizlenir, bekleyen soru isteği iptal edilir ve eski STT/TTS callback'leri engellenir. Soru kaydı sürerken dil seçici kısa süreyle devre dışıdır. Dil URL'de `?lang=` ile korunur.

## Cevapsız soru ve WhatsApp

Güven eşiği veya adaylar arası fark yetersizse kayıtlı cevap kullanılmaz. İstenen cevapsız soru metni gösterilir ve tarayıcı TTS ile okunur. Ad Soyad, Telefon ve onay sunucuda doğrulanır. Klinik, URL slug’ından çözülür; istemci clinic_id göndermez.

`lib/unanswered.ts` yalnızca kayıt yapar (Supabase veya yerel mock). Kayıttan sonra `lib/notifications/` sağlayıcısı clinic.whatsapp üzerinden URL encoding uygulanmış bağlantı hazırlar. UI seçilen dilde başarı mesajı ve WhatsApp bağlantısını gösterir. Kullanıcı WhatsApp’ta mesajı kendisi gönderir; otomatik gönderim yapılmaz. Numara yalnızca demo seed/config kayıtlarındadır. Diğer klinikler kendi whatsapp alanlarını kullanır. Eksik/geçersiz numara kayıt başarısını engellemez, WhatsApp bağlantısı gösterilmez.

Gelecekte `AutomaticNotificationProvider.send` implementasyonu sunucuda WhatsApp Business API kullanabilir. Güvenilir otomatik teslimat için ayrı outbox/queue, tekrar deneme ve idempotency ekleyin; kayıt işlemini bildirime bağlamayın.

## Veri ve güvenlik

Tablolar: clinics, assistant_knowledge, unanswered_questions, assistant_interactions; ayrıca paylaşımlı rate limit için request_quotas. Klinik verileri clinic_id ile ayrılır. Knowledge/interaction ilişkisi bileşik foreign key ile aynı klinikle sınırlandırılır. RLS yalnızca aktif kliniklerin izin verilen public sütunlarının okunmasını sağlar. Anon/authenticated ziyaretçiler doğrudan hassas tablo okuyamaz, INSERT/UPDATE/DELETE yapamaz. Yazmalar doğrulanan sunucu endpoint’lerinden geçer. Service role yalnızca server-only modüllerdedir.

Origin kontrolü, onay doğrulaması, metin uzunluk sınırı, honeypot ve PostgreSQL üzerinden dakikada 10 istek sınırı vardır. Vercel dışındaki hostinglerde güvenilir proxy’nin x-forwarded-for başlığını yönetmesini sağlayın. Dağıtık bot saldırıları için ek edge koruması gerekir.

## Ses ve eşleştirme

BrowserSpeechRecognitionProvider Web Speech API kullanır: Türkçe `tr-TR`, Rusça `ru-RU`; dil parametresi verilmezse mevcut Türkçe davranış korunur. Destek ve izin cihazda değişebilir. Chrome üzerinde HTTPS/localhost kullanın. Desteklenmeyen tarayıcıda yazılı giriş çalışır. Tarayıcı ses tanıma servisi sesi kendi sağlayıcısına gönderebilir. BrowserTextToSpeechProvider speechSynthesis ile önce tam locale'e, sonra dil ailesine uygun voice seçer. Ses listesi boşsa utterance.lang yine doğru locale olur; TTS desteklenmiyorsa yazılı cevap kalır ve yerelleştirilmiş mesaj gösterilir. Gerçek mikrofon ve voice kalitesi cihaz üzerinde denenmelidir.

Eşleştirme dile özgü normalizasyon, stop words, canonical/alternative phrase token similarity ve keyword coverage kullanır; eşik .82, ikinci adaydan fark .08. Türkçe karakterler ve Rusça Kiril korunur. Rusça profil, yaygın çekimleri ve aşı/прививка eş anlamlarını kapsar. Kedi/köpek ve bazı aşı ayrımları kontrol edilir. Bu kontrollü V1 motoru her ifadeyi anlayamaz; belirsizlikte seçilen dildeki cevapsız akışa döner.

## Kontrol ve yayın

`npm.cmd test`, `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run build`.

20 otomatik test: Türkçe regresyon, 80 canonical soru, dil izolasyonu, Rusça alternatifler, fiyat tutarlılığı, STT/TTS locale ve fallback, arayüzün iki dilde render edilmesi, cevapsız sorunun dil kaydı, bildirim hedefi ve migration/RLS. Migration testi yalnızca geçici PGlite PostgreSQL veritabanında çalışır; 40 eski Türkçe kayıt ve önceki interaction/cevapsız soru örnekleri korunur, Rusça seed tekrarlandığında mükerrer kayıt oluşmaz. Gerçek Supabase'e bağlanmaz.

Çalışan mock sunucusunda uçtan uca HTTP kontrolü: `node scripts/smoke-local.mjs http://localhost:3001`. Bu kontrol örnek bir Rusça mock soru kaydı oluşturur ve WhatsApp URL'sini doğrular; mesaj göndermez. Fiziksel mikrofon, cihazdaki Rusça voice ve 360/390/430px görsel kontrolleri gerçek tarayıcı/cihaz üzerinde ayrıca denenmelidir.

Vercel’e repository import edin, Next.js preset kullanın; dört environment variable’ı tanımlayın. Supabase migration/seed’i önce uygulayın, ardından deploy edin. Build secrets olmadan çalışır; runtime veri erişimi için yapılandırma gereklidir. Canlı Supabase yazımı, RLS, Chrome mikrofonu/TTS ve 360/390/430px cihaz kontrollerini yayın öncesinde tamamlayın.

V2 için slug/clinic context, clinic_id ilişkileri, speech sağlayıcıları, bildirim arayüzleri ve interaction analytics temeli hazırdır. Kullanılmayan müşteri/hayvan/yönetim tabloları oluşturulmamıştır.
