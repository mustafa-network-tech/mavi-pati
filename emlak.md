# MK EMLAK ASİSTANI
## MASTER PROJE DOKÜMANI

Sürüm: 1.1
Tarih: 24.09.2026
Proje Sahibi: MK Digital Systems
Ürün Tipi: Multi-Tenant SaaS
Durum: Tasarım / Dönüşüm Aşaması

---

# 1. PROJENİN AMACI

MK Emlak Asistanı, emlak ofisleri ve emlak danışmanları için geliştirilen
AI destekli, çok kiracılı (multi-tenant) bir SaaS platformudur.

Ürünün temel amacı:

Potansiyel müşteri ve ilanların sisteme alınması,
AI ile analiz edilmesi,
danışman tarafından değerlendirilmesi,
WhatsApp veya AI telefon görüşmesiyle iletişime geçilmesi,
randevu oluşturulması,
görüşmelerin özetlenmesi
ve bütün sürecin CRM içerisinde takip edilmesidir.

Ana ürün döngüsü:

LEAD / İLAN
↓
AI ANALİZ
↓
DANIŞMAN İNCELEMESİ
↓
DANIŞMAN ONAYI
↓
WHATSAPP veya AI TELEFON ARAMASI
↓
GÖRÜŞME
↓
NİTELENDİRME
↓
RANDEVU
↓
AI GÖRÜŞME ÖZETİ
↓
CRM
↓
TAKİP
↓
SONUÇ

MK Emlak Asistanı yalnızca bir CRM değildir.

Ürünün temel değer önerisi:

"Potansiyel müşteriyi görüşmeye ve randevuya dönüştürmeye yardımcı olan
AI destekli emlak asistanı."

---

# 2. TEKNİK BAŞLANGIÇ NOKTASI

MK Emlak Asistanı mevcut Next.js ve Supabase altyapısı üzerinde
multi-tenant SaaS platformu olarak geliştirilecektir.

Mevcut altyapı:

- Next.js
- React
- TypeScript
- Tailwind CSS
- Vercel
- Supabase
- Browser Web Speech API
- Türkçe / Rusça locale altyapısı
- WhatsApp deep-link altyapısı

Mevcut browser voice sistemi gerçek telefon/SIP sistemi değildir.

Browser SpeechRecognition ve speechSynthesis altyapısı:

- web demo,
- sesli not,
- danışman sesli veri girişi,
- AI senaryo testi

için yeniden kullanılabilir.

Gerçek telefon görüşmeleri ayrı bir Telephony/Voice Provider üzerinden
geliştirilecektir.

---

# 3. SAAS ORGANİZASYON MİMARİSİ

Sistem üç temel yönetim seviyesinden oluşur:

PLATFORM_ADMIN
│
├── EMLAK OFİSİ A
│    ├── OFFICE_ADMIN
│    ├── ADVISOR
│    ├── ADVISOR
│    └── ADVISOR
│
├── EMLAK OFİSİ B
│    ├── OFFICE_ADMIN
│    ├── ADVISOR
│    └── ADVISOR
│
└── EMLAK OFİSİ C
     ├── OFFICE_ADMIN
     ├── ADVISOR
     ├── ADVISOR
     ├── ADVISOR
     └── ADVISOR

Platform seviyesi ile tenant/ofis seviyesi kesin olarak ayrılmalıdır.

PLATFORM_ADMIN ≠ OFFICE_ADMIN

OFFICE_ADMIN ≠ ADVISOR

---

# 4. PLATFORM ADMIN

PLATFORM_ADMIN MK Emlak Asistanı platformunun en üst yöneticisidir.

Platform Admin herhangi bir emlak ofisinin kullanıcısı değildir.

Platform seviyesinde çalışır.

Platform Admin:

- emlak ofisi başvurularını görür,
- ofisleri onaylar,
- reddeder,
- aktif eder,
- askıya alır,
- kullanım süresi verir,
- kullanım süresini uzatır,
- danışman limitini belirler,
- özellikleri açar/kapatır,
- AI kullanım hakkı verir,
- AI telefon kullanım hakkı verir,
- WhatsApp kullanım hakkı verir,
- import yetkisi verir,
- randevu modülünü açar/kapatır,
- kullanım kotalarını belirler,
- ofis kullanımını izler,
- ileride abonelik ve planları yönetir,
- sistem genelindeki audit kayıtlarını izler.

PLATFORM_ADMIN rolü hiçbir OFFICE_ADMIN tarafından oluşturulamaz,
atanamaz veya değiştirilemez.

---

# 5. EMLAK OFİSİ / TENANT

Her emlak ofisi bağımsız bir tenant'tır.

Ana tablo:

businesses

olarak kullanılabilir.

Her ofis tamamen kendi verisine sahip olur.

Bir ofis başka bir ofisin:

- kullanıcılarını,
- danışmanlarını,
- lead'lerini,
- ilanlarını,
- görüşmelerini,
- WhatsApp mesajlarını,
- telefon görüşmelerini,
- randevularını,
- notlarını,
- raporlarını

göremez veya değiştiremez.

---

# 6. OFİS DURUMLARI

Önerilen business status değerleri:

PENDING
TRIAL
ACTIVE
SUSPENDED
EXPIRED
REJECTED

PENDING:
Platform Admin onayı bekliyor.

TRIAL:
Deneme kullanımında.

ACTIVE:
Aktif kullanım.

SUSPENDED:
Platform Admin tarafından askıya alınmış.

EXPIRED:
Kullanım süresi sona ermiş.

REJECTED:
Başvuru reddedilmiş.

---

# 7. OFİS ONAY SÜRECİ

Yeni emlak ofisi kayıt olduğunda doğrudan aktif olmamalıdır.

Akış:

OFİS KAYIT
↓
PENDING
↓
PLATFORM ADMIN PANELİ
↓
İNCELEME
↓
ONAY / RED
↓
DANIŞMAN LİMİTİ
↓
ÖZELLİKLER
↓
KOTALAR
↓
KULLANIM SÜRESİ
↓
TRIAL veya ACTIVE

Platform Admin onayı olmadan ofis operasyonel CRM kullanamamalıdır.

---

# 8. OFFICE ADMIN

Her emlak ofisinde başlangıçta bir OFFICE_ADMIN bulunur.

OFFICE_ADMIN yalnızca kendi emlak ofisini yönetir.

Yetkileri:

- kendi ofis dashboard'unu görmek,
- danışmanları görmek,
- danışman eklemek,
- danışman davet etmek,
- danışman aktif/pasif yapmak,
- lead oluşturmak,
- ilan oluşturmak,
- lead atamak,
- ilan atamak,
- danışman atamasını değiştirmek,
- randevuları görmek,
- görüşmeleri görmek,
- ofis içi raporları görmek,
- ofis operasyonlarını yönetmek.

OFFICE_ADMIN:

- danışman limitini artıramaz,
- kullanım süresini değiştiremez,
- kendi ofisini ACTIVE yapamaz,
- AI kotasını artıramaz,
- platform özelliğini açamaz,
- başka ofisleri göremez,
- PLATFORM_ADMIN oluşturamaz.

---

# 9. ADVISOR

ADVISOR emlak danışmanıdır.

Her Advisor belirli bir business/ofise bağlıdır.

Advisor:

- kendisine atanmış lead'leri,
- kendisine atanmış ilanları,
- kendi görüşmelerini,
- kendi randevularını,
- kendisine yetki verilen CRM kayıtlarını

görür.

Varsayılan güvenlik modeli:

OFFICE_ADMIN
→ ofisin tamamını görür.

ADVISOR
→ kendisine atanmış operasyon kayıtlarını görür.

Danışmanın bütün ofis lead'lerini görebilmesi ileride ayrı permission olarak
tanımlanabilir.

Varsayılan olarak açık olmamalıdır.

---

# 10. DANIŞMAN LİMİTİ

Her emlak ofisinin danışman limiti farklı olabilir.

Örnek:

ABC Emlak → 3 danışman

XYZ Gayrimenkul → 8 danışman

Örnek Emlak → 15 danışman

Bu limit PLATFORM_ADMIN tarafından belirlenir.

OFFICE_ADMIN değiştiremez.

Danışman ekleme sırasında backend:

business aktif mi?
↓
kullanım süresi geçerli mi?
↓
team/advisor özelliği açık mı?
↓
aktif danışman sayısı
↓
max_advisors

kontrollerini yapmalıdır.

Frontend'de buton kapatmak yeterli güvenlik değildir.

Limit backend/database seviyesinde uygulanmalıdır.

---

# 11. BUSINESS ENTITLEMENTS

Ofis hakları tek tek yönetilebilir olmalıdır.

Önerilen tablo:

business_entitlements

Alanlar örneğin:

business_id

max_advisors

crm_enabled

appointments_enabled

whatsapp_enabled

ai_analysis_enabled

ai_voice_enabled

imports_enabled

reports_enabled

monthly_ai_call_minutes

monthly_ai_analysis_limit

monthly_lead_limit

valid_from

valid_until

updated_by_platform_admin

updated_at

Bu yapı sayesinde her ofise farklı haklar tanımlanabilir.

---

# 12. OFİSE ÖZEL HAK ÖRNEĞİ

ABC Emlak:

Danışman: 5
CRM: Açık
Randevu: Açık
WhatsApp: Açık
AI Analiz: Açık
AI Voice: Açık
Import: Açık
AI dakika: 500
Lead limiti: 5.000
Bitiş: 31.12.2026

XYZ Emlak:

Danışman: 12
CRM: Açık
Randevu: Açık
WhatsApp: Açık
AI Analiz: Açık
AI Voice: Kapalı
Import: Açık
AI dakika: 0
Lead limiti: 20.000
Bitiş: 30.06.2027

Bu değerler her business için bağımsızdır.

---

# 13. PLAN + OVERRIDE MİMARİSİ

İleride SaaS planları oluşturulabilir.

Örneğin:

STARTER
PRO
BUSINESS

Plan:

varsayılan özellikleri ve kotaları verir.

Ancak Platform Admin gerektiğinde belirli bir ofis için override yapabilir.

Mantık:

PLAN DEFAULT
+
BUSINESS OVERRIDE
=
EFFECTIVE ENTITLEMENTS

Örnek:

PRO plan danışman limiti = 5

Ancak Platform Admin:

ABC Emlak → 8 danışman

override verebilir.

Böylece özel müşteri anlaşmaları desteklenebilir.

---

# 14. KULLANIM SÜRESİ

Her ofisin kullanım süresi Platform Admin tarafından belirlenebilir.

Önerilen alanlar:

access_starts_at
access_expires_at

Süre dolduğunda:

business.status = EXPIRED

olabilir.

Süre dolması verilerin otomatik silinmesi anlamına gelmez.

Ofisin mevcut verileri korunmalıdır.

Hangi işlemlerin read-only kalacağı ayrıca business rule olarak belirlenmelidir.

Platform Admin süreyi uzattığında ofis yeniden aktif hale getirilebilir.

---

# 15. PLATFORM ADMIN PANELİ

Platform Admin paneli normal ofis panelinden ayrı düşünülmelidir.

Ana menü:

Dashboard

Emlak Ofisleri

Başvurular

Kullanıcılar

Yetkiler ve Kotalar

AI Kullanımı

WhatsApp Kullanımı

Sistem Kullanımı

Planlar

Abonelikler

Audit Log

Sistem Ayarları

---

# 16. PLATFORM DASHBOARD

Örnek metrikler:

Toplam Ofis

Aktif Ofis

Trial Ofis

Bekleyen Başvuru

Askıya Alınan

Süresi Dolan

Toplam Danışman

Toplam Lead

Bugünkü Randevu

AI Arama

AI Dakika Kullanımı

WhatsApp Kullanımı

---

# 17. EMLAK OFİSLERİ EKRANI

Liste kolonları:

Ofis
Durum
Office Admin
Danışman
Danışman Limiti
AI Voice
WhatsApp
Başlangıç
Bitiş
Son Aktivite

Örnek:

ABC Emlak
ACTIVE
Zerrin B.
4 / 5
Açık
Açık
24.09.2026
24.12.2026

İşlemler:

Detay

Onayla

Yetkiler

Kota Düzenle

Süre Uzat

Askıya Al

Aktifleştir

Kullanımı Gör

Audit Geçmişi

---

# 18. OFFICE ADMIN PANELİ

Menü:

Dashboard

Potansiyel Müşteriler

İlanlar

Danışmanlar

Görüşmeler

WhatsApp

AI Aramalar

Randevular

Raporlar

Ofis Ayarları

Office Admin Platform Admin menülerini göremez.

---

# 19. DANIŞMAN ATAMA

Lead:

UNASSIGNED

olabilir.

Office Admin lead'i danışmana atar.

Örnek:

Lead #1001
→ Ayşe

Lead #1002
→ Mehmet

Office Admin:

atanmamış lead'leri görür,

danışman atar,

danışmanı değiştirir,

gerekirse atamayı kaldırır.

Atama geçmişi activity_logs içerisinde tutulmalıdır.

---

# 20. LEAD YÖNETİMİ

Lead sistemin merkezindedir.

Örnek:

id
business_id
assigned_advisor_id

name
phone
email

source
source_reference
source_url

city
district

status
priority
ai_score

preferred_contact_method

whatsapp_allowed
call_allowed

last_contact_at
next_follow_up_at

created_at
updated_at

---

# 21. LEAD PIPELINE

Önerilen akış:

NEW
↓
REVIEWING
↓
APPROVED
↓
CONTACTED
↓
QUALIFIED
↓
APPOINTMENT_SCHEDULED
↓
WON / LOST / ARCHIVED

Lead state değişiklikleri kontrollü backend işlemleri üzerinden yapılmalıdır.

---

# 22. İLAN YÖNETİMİ

listings:

id
business_id

external_reference
source
source_url

title
description

property_type
transaction_type

price
currency

city
district
neighborhood

gross_area
net_area
room_count

status

created_at
updated_at

Lead ile ilan N:N ilişkide olabilir.

Bu nedenle:

lead_listings

kullanılmalıdır.

---

# 23. LEAD KAYNAKLARI

İlk sürüm:

manuel giriş

CSV

Excel

danışmanın sağladığı veri

izinli web formu

izinli API

desteklemelidir.

İzinsiz scraping veya otomatik telefon toplama sistemi ürünün temel
özelliği yapılmamalıdır.

Herhangi bir portal entegrasyonu ayrı LeadSourceProvider üzerinden
tasarlanmalıdır.

---

# 24. AI LEAD ANALİZİ

AI lead ve ilan bilgilerini analiz edebilir.

Örnek:

AI Uygunluk: 87/100

Neden:

- bölge uygun,
- fiyat aralığı uygun,
- ilan yeni,
- yeterli veri mevcut.

AI puanı kesin gerçek değildir.

Danışmana karar desteği sağlar.

---

# 25. WHATSAPP V1

İlk aşamada:

WHATSAPP'TAN YAZ

butonu kullanılabilir.

Sistem mesaj taslağı oluşturur.

Danışman mesajı kontrol eder.

WhatsApp deep-link açılır.

Danışman gönderir.

CRM:

"WhatsApp açıldı"

aktivitesi oluşturabilir.

Mesajın gerçekten gönderildiği doğrulanmadan:

"SENT"

olarak işaretlenmemelidir.

---

# 26. WHATSAPP V2

Daha sonra resmi WhatsApp Business entegrasyonu yapılabilir.

Provider abstraction:

WhatsAppProvider

createDeepLink()
sendTemplate()
sendMessage()
sendMedia()
verifyWebhook()
parseWebhook()
markRead()
getDeliveryStatus()

Token ve secret değerleri client'a gönderilmez.

---

# 27. AI TELEFON ARAMASI

Danışman:

AI İLE ARA

butonuna basar.

Akış:

ADVISOR
↓
AI İLE ARA
↓
AUTH
↓
BUSINESS MEMBERSHIP
↓
ENTITLEMENT
↓
AI VOICE KOTASI
↓
LEAD PERMISSION
↓
CALL RECORD
↓
TELEPHONY PROVIDER
↓
SIP/PSTN
↓
MÜŞTERİ
↓
AI GÖRÜŞME
↓
TOOL CALL
↓
RANDEVU / CALLBACK / SONUÇ
↓
TRANSCRIPT
↓
AI ÖZET
↓
CRM

---

# 28. AI KENDİSİNİ TANITMALI

AI kendisini insan gibi göstermemelidir.

Örnek:

"Merhaba, ben Zerrin Hanım'ın dijital asistanıyım.
Gayrimenkul ilanınızla ilgili iletişime geçiyorum.
Şu anda kısa bir görüşme için uygun musunuz?"

İsimler hardcode edilmemelidir.

Business ve advisor context üzerinden gelmelidir.

---

# 29. AI TOOL'LARI

AI doğrudan SQL çalıştırmaz.

Whitelist edilmiş backend tool'ları kullanır.

Örnek:

getLead()

getListing()

getAdvisorAvailability()

updateLeadStatus()

createAppointment()

rescheduleAppointment()

cancelAppointment()

scheduleCallback()

saveConversationSummary()

addLeadNote()

markNotInterested()

transferToHuman()

---

# 30. TOOL GÜVENLİĞİ

Her tool:

authenticated user

business membership

role

entitlement

tenant

input validation

state transition

idempotency

kontrollerinden geçmelidir.

AI tarafından gönderilen business_id güvenilir kabul edilmemelidir.

Business context güvenilir session/backend tarafından belirlenmelidir.

---

# 31. TELEPHONY PROVIDER

Telefon sistemi provider bağımsız tasarlanmalıdır.

TelephonyProvider:

startCall()

endCall()

transferCall()

getCallStatus()

verifyWebhook()

parseWebhook()

Provider daha sonra seçilecektir.

---

# 32. VOICE CONTROL PLANE

Vercel/backend:

authorization

tenant

lead context

call creation

provider command

webhook

CRM update

appointment

summary

işlemlerini yönetebilir.

---

# 33. VOICE MEDIA PLANE

Gerçek zamanlı:

SIP/PSTN

audio streaming

STT

LLM

TTS

uzun süreli serverless request içerisinde tutulmamalıdır.

Voice provider veya uygun uzun bağlantı servisi kullanılmalıdır.

---

# 34. RANDEVU

appointments:

id
business_id
lead_id
listing_id
advisor_id
conversation_id

start_at
end_at
timezone

type
location
status

created_by_type
created_by_id

external_calendar_id

notes
cancellation_reason

created_at
updated_at

---

# 35. RANDEVU DURUMLARI

SCHEDULED

CONFIRMED

COMPLETED

CANCELLED

NO_SHOW

RESCHEDULED

---

# 36. RANDEVU ÇAKIŞMASI

Aynı danışmana aynı zaman aralığında iki aktif randevu oluşturulmamalıdır.

Kontrol yalnızca UI seviyesinde yapılmamalıdır.

Backend/database seviyesinde concurrency-safe koruma bulunmalıdır.

---

# 37. CONVERSATIONS

Tüm iletişim conversation altında birleştirilebilir.

channel:

PHONE
WHATSAPP
WEB
MANUAL
EMAIL

Conversation:

business
lead
listing
advisor
channel
status
started_at
ended_at

---

# 38. CALLS

calls:

id
business_id
conversation_id
lead_id
advisor_id

provider
provider_call_id

direction
status

started_at
answered_at
ended_at

duration_seconds

transcript
summary

recording_reference

ai_result

created_at

---

# 39. ACTIVITY LOG

Örnek timeline:

09:30 Lead oluşturuldu

09:32 AI analiz etti

10:05 Office Admin → Ayşe danışmana atadı

10:07 WhatsApp açıldı

11:40 AI arama başladı

11:44 Görüşme tamamlandı

11:45 Randevu oluşturuldu

Kritik işlemler activity_logs tablosuna yazılmalıdır.

---

# 40. TEMEL VERİTABANI

Platform:

platform_users
businesses
business_entitlements
business_subscriptions
business_usage
platform_audit_logs

Tenant:

profiles
business_members
leads
listings
lead_listings
conversations
messages
calls
appointments
notes
activity_logs
imports
import_rows
advisor_availability
provider_connections
webhook_events
outbox_jobs

---

# 41. AUTH

Supabase Auth kullanılacaktır.

profiles.user_id
→ auth.users.id

business_members:

business_id
user_id
role
active

Tenant rolleri:

OFFICE_ADMIN
ADVISOR

PLATFORM_ADMIN tenant membership rolü değildir.

Ayrı platform authorization mekanizması kullanılmalıdır.

---

# 42. RLS

CRM verileri public olmamalıdır.

Her tenant tablosunda:

business_id NOT NULL

bulunmalıdır.

OFFICE_ADMIN:

kendi business verilerini yönetebilir.

ADVISOR:

kendi yetkili/atanmış kayıtlarını kullanabilir.

Başka business verisi hiçbir tenant kullanıcısına açılmamalıdır.

RLS ile birlikte Postgres grants da minimum gerekli yetkilerle
yapılandırılmalıdır.

---

# 43. COMPOSITE FOREIGN KEY

Cross-tenant ilişki database seviyesinde de engellenmelidir.

Örnek:

leads
UNIQUE(id, business_id)

listings
UNIQUE(id, business_id)

lead_listings:

(lead_id, business_id)
→ leads(id, business_id)

(listing_id, business_id)
→ listings(id, business_id)

---

# 44. SERVICE ROLE

Service role / Supabase secret:

browser'a verilmez.

AI'a verilmez.

Client bundle'a girmez.

Normal tenant CRUD için varsayılan çözüm olarak kullanılmaz.

Webhook, background/system işlemleri gibi güvenilir server-side
işlemlerle sınırlandırılır.

---

# 45. IMPORT

CSV / Excel:

Dosya
↓
Önizleme
↓
Kolon eşleştirme
↓
Doğrulama
↓
Duplicate kontrol
↓
Import
↓
Rapor

Kontroller:

dosya boyutu
satır limiti
telefon normalization
email validation
duplicate
formula injection
encoding
bozuk satır

---

# 46. AI GÜVENLİĞİ

AI'a:

database password

service-role

JWT secret

provider secret

WhatsApp token

SIP credential

serbest SQL

verilmemelidir.

External lead/listing metinleri instruction değil DATA olarak ele alınmalıdır.

Prompt injection dikkate alınmalıdır.

---

# 47. AI'NIN YAPMAMASI GEREKENLER

AI:

olmayan bilgi üretmemeli,

olmayan randevuyu onaylamamalı,

fiyat garantisi vermemeli,

satış garantisi vermemeli,

hukuki taahhüt vermemeli,

başka tenant verisini kullanmamalı,

kendi kendine rastgele kişileri aramamalı,

izinsiz lead toplamamalı.

---

# 48. HUMAN-IN-THE-LOOP

Temel prensip:

AI destekler.

İnsan kontrol eder.

Özellikle ilk sürümlerde:

lead seçimi

iletişim başlangıcı

kritik CRM kararları

danışman kontrolünde olmalıdır.

---

# 49. SUPER ADMIN / PLATFORM ADMIN KOTA KONTROLÜ

Özellik kullanımından önce backend:

business.status

access_expires_at

entitlement

quota

usage

kontrol etmelidir.

Örnek AI arama:

business ACTIVE?
↓
AI_VOICE enabled?
↓
monthly quota available?
↓
advisor authorized?
↓
lead assigned/authorized?
↓
CALL

---

# 50. BUSINESS USAGE

İleride kullanım tablosu:

business_usage

business_id
metric
period_start
period_end
used_quantity

Metric örnekleri:

AI_CALL_SECONDS

AI_ANALYSIS

WHATSAPP_MESSAGE

LEADS_IMPORTED

APPOINTMENTS_CREATED

---

# 51. PLATFORM AUDIT LOG

Platform Admin işlemleri ayrıca audit edilmelidir.

Örnek:

Office approved

Office suspended

Advisor limit 5 → 10

AI Voice enabled

Expiration 30.11 → 31.12

Quota changed

Bu kayıtlar tenant activity log ile karıştırılmamalıdır.

---

# 52. MVP

İlk gerçek sürüm:

Supabase Auth

Platform Admin

Business approval

Business access duration

Business entitlements

Advisor limit

Office Admin

Advisor

RLS

Lead

Listing

Lead assignment

CSV/Excel import

Notes

Activity Log

Appointments

WhatsApp deep-link

Dashboard

içermelidir.

---

# 53. MVP'DEN SONRA

AI lead analysis

AI summary

Official WhatsApp

AI Voice

SIP/PSTN

Calendar

Super Admin gelişmiş analytics

Plans

Subscriptions

Billing

Usage billing

eklenebilir.

---

# 54. GELİŞTİRME FAZLARI

FAZ 1
Platform / Auth / Tenant / RLS

FAZ 2
Office Admin / Advisor / Limits / Entitlements

FAZ 3
Lead / Listing / Assignment / CRM

FAZ 4
Appointments

FAZ 5
Import

FAZ 6
WhatsApp

FAZ 7
AI Analysis / Agent Tools

FAZ 8
AI Voice / SIP

FAZ 9
Plans / Subscriptions / Usage / Billing

---

# 55. GEÇİŞ SONRASI VERİ POLİTİKASI

Kullanılmayan önceki domain tabloları ayrı veri saklama kararı olmadan silinmemelidir.

Yeni emlak tabloları additive migration ile oluşturulmalıdır.

Eski tablolar:

LEGACY / READ-ONLY

olarak bırakılabilir.

Yeni sistem stabil olduktan sonra ayrı migration ile temizleme
değerlendirilebilir.

---

# 56. MIGRATION KURALI

Uygulanmış migration değiştirilmez.

Yeni DB değişikliği:

NEW FORWARD MIGRATION

olarak yapılır.

Production'da destructive DROP otomatik yapılmaz.

Akış:

LOCAL
↓
TEST
↓
RLS TEST
↓
REVIEW
↓
PRODUCTION

---

# 57. RLS TESTLERİ

Zorunlu senaryolar:

Office A → Office B verisini göremez.

Advisor A → başka business verisini göremez.

Advisor → atanmadığı lead'i göremez.

Office Admin → başka business göremez.

Office Admin → kendi limitini değiştiremez.

Office Admin → kullanım süresini değiştiremez.

Office Admin → entitlement değiştiremez.

Anon → CRM göremez.

Member olmayan authenticated user → CRM göremez.

Platform Admin operasyonları güvenli platform auth üzerinden çalışır.

Cross-tenant FK oluşturulamaz.

---

# 58. LIMIT TESTLERİ

Örnek:

max_advisors = 5

Aktif advisor = 5

OFFICE_ADMIN altıncı advisor oluşturmayı denediğinde:

REJECT.

Platform Admin:

max_advisors = 6

yaptığında yeni advisor oluşturulabilir.

Frontend kontrolünün yanı sıra backend/database kontrolü bulunmalıdır.

---

# 59. EXPIRATION TESTLERİ

Business:

ACTIVE

access_expires_at geçmiş.

Yeni operasyon:

REJECT.

Mevcut veriler:

DELETE edilmez.

Platform Admin süre uzattığında:

yeniden kullanılabilir.

---

# 60. CODEX / CLAUDE ÇALIŞMA TALİMATI

Bu dosya MK Emlak Asistanı'nın ana ürün ve mimari dokümanıdır.

Repository üzerinde çalışmadan önce:

1. Bu dosyayı oku.
2. Mevcut repository'yi incele.
3. Gerçek mevcut durum ile hedef mimariyi ayır.
4. Mevcut olmayan özelliği varmış gibi raporlama.
5. Çalışan sistemi gereksiz yere yeniden yazma.
6. Production verisini silme.
7. Uygulanmış migration'ı değiştirme.
8. Yeni DB değişikliklerinde forward migration oluştur.
9. RLS + GRANT + POLICY birlikte kontrol et.
10. PLATFORM_ADMIN ve OFFICE_ADMIN rollerini karıştırma.
11. Advisor limitini yalnızca UI'da uygulama.
12. Tenant izolasyonunu database seviyesinde koru.
13. AI'a database/service-role erişimi verme.
14. Provider entegrasyonlarını abstraction üzerinden yap.
15. İzinsiz scraping geliştirme.
16. Production migration/deploy/commit/push işlemlerini kullanıcı
    açıkça istemeden yapma.

---

# 61. TAMAMLAMA RAPORU STANDARDI

Her büyük geliştirme sonunda rapor:

Yapılanlar

Değişen dosyalar

Yeni migration

RLS değişiklikleri

GRANT değişiklikleri

Environment variables

Test sonuçları

Build sonucu

Local test sonucu

Integration test sonucu

Production'a uygulanmayanlar

Eksik provider/credential

Riskler

Manuel yapılacaklar

Sonraki adım

başlıklarını içermelidir.

---

# 62. DURUM TERİMLERİ

AI raporlarında şu terimler birbirinden ayrılmalıdır:

IMPLEMENTED

MOCK

LOCAL TESTED

INTEGRATION TESTED

PRODUCTION DEPLOYED

PRODUCTION VERIFIED

Örneğin:

"AI ile Ara butonu oluşturuldu."

gerçek telefon aramasının çalıştığı anlamına gelmez.

"WhatsApp deep-link çalışıyor."

resmi WhatsApp Business API entegrasyonunun tamamlandığı anlamına gelmez.

---

# 63. SAAS'IN ANA YÖNETİM KURALI

PLATFORM_ADMIN
→ PLATFORMU YÖNETİR.

OFFICE_ADMIN
→ KENDİ EMLAK OFİSİNİ YÖNETİR.

ADVISOR
→ KENDİ İŞ AKIŞINI YÖNETİR.

PLATFORM_ADMIN:

ofise ne kadar yetki verileceğine karar verir.

OFFICE_ADMIN:

kendisine verilen sınırlar içerisinde ekibini yönetir.

ADVISOR:

kendisine atanmış işleri yürütür.

---

# 64. GELECEK HEDEF

Uzun vadede ürün:

Multi-Tenant Emlak CRM

AI Lead Qualification

AI Telefon Agent

WhatsApp Assistant

Appointment Automation

Follow-up Automation

Listing Intelligence

Team Management

Platform Administration

Subscription SaaS

Usage-Based AI Billing

Analytics

ürününe dönüşebilir.

---

# 65. PROJE DURUMU — 24.09.2026

Kaynak proje:

MK Emlak Asistanı.

Deployment:

Vercel.

Database:

Supabase.

Mevcut voice:

Browser Web Speech API.

Gerçek telefon/SIP:

Henüz yok.

Resmi WhatsApp Business API:

Henüz yok.

Gerçek CRM:

Henüz yok.

Randevu sistemi:

Henüz yok.

Yeni hedef:

MK Emlak Asistanı Multi-Tenant SaaS.

Kesinleşmiş yönetim modeli:

PLATFORM_ADMIN
→ BUSINESS / REAL ESTATE OFFICE
→ OFFICE_ADMIN
→ ADVISOR

Platform Admin:

ofis onayı,
kullanım süresi,
danışman limiti,
özellikler,
kotalar

üzerinde nihai yetkilidir.

Office Admin:

kendi ofisinin danışmanlarını ve atamalarını,
Platform Admin tarafından verilen sınırlar içerisinde yönetir.

---

# 66. SONRAKİ TEKNİK ADIM

Codex bu dosyayı ve mevcut repository'yi birlikte incelemelidir.

İlk implementasyon öncesinde şu raporu üretmelidir:

1. Mevcut repo ile bu hedef mimari arasındaki farklar.
2. Korunacak mevcut kod.
3. Kaldırılacak eski domain kodu.
4. Yeni Platform Admin mimarisi.
5. Auth ve rol mimarisi.
6. Business/tenant şeması.
7. Business entitlement ve kullanım süresi modeli.
8. Advisor limit enforcement yöntemi.
9. Office Admin / Advisor RLS matrisi.
10. Platform Admin güvenlik modeli.
11. Yeni CRM tabloları.
12. Gerekli forward migration'lar.
13. UI route ve ekran planı.
14. Test planı.
15. Uygulama sırası.

Bu rapor onaylanmadan production üzerinde destructive işlem yapılmamalıdır.

---

# 67. MASTER DOKÜMAN GÜNCELLEME KURALI

Şunlardan biri değiştiğinde bu dosya güncellenmelidir:

Platform rolleri

Tenant rolleri

Business lifecycle

Advisor limit sistemi

Entitlements

Auth

RLS

Database

Lead pipeline

Appointment modeli

AI

Voice

WhatsApp

Planlar

Abonelikler

Kotalar

Fiyatlandırma

KVKK/gizlilik

Deployment

Provider seçimi

Önemli ürün kararı

Amaç:

Projenin mimarisinin sohbet geçmişlerinde kaybolmasını engellemek
ve Codex/Claude/yeni geliştiriciler için tek bir ana kaynak sağlamaktır.

---

END OF MK EMLAK ASİSTANI MASTER PROJECT DOCUMENT
