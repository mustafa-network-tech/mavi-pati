-- MK Pati transition, step 1: remove the real-estate, WhatsApp and phone-call domain.
-- Forward-only. Earlier migrations are not modified.
-- IRREVERSIBLE: drops lead/listing/conversation/call data. Take a database backup first.
-- Kept: tenancy (businesses, members, entitlements, usage), platform admin, audit logs,
-- private.normalize_phone (reused for pet owner phones) and the generic helpers.
begin;

-- Domain RPCs.
drop function if exists public.update_lead_status(uuid, text);
drop function if exists public.assign_lead(uuid, uuid);
drop function if exists public.create_appointment(uuid, uuid, uuid, text, timestamptz, timestamptz, text, text);
drop function if exists public.reschedule_appointment(uuid, timestamptz, timestamptz);
drop function if exists public.cancel_appointment(uuid, text);
drop function if exists public.create_manual_whatsapp_draft(uuid, text);
drop function if exists public.schedule_callback(uuid, timestamptz);
drop function if exists public.save_conversation_summary(uuid, text, text);
drop function if exists public.transfer_to_human(uuid, uuid);
drop function if exists public.create_appointment_slot(uuid, timestamptz, timestamptz);
drop function if exists public.cancel_appointment_slot(uuid);
drop function if exists public.book_appointment_slot(uuid, uuid, text);
drop function if exists public.mark_lead_do_not_contact(uuid, text);
drop function if exists public.handoff_conversation(uuid, text);

-- One statement so foreign keys between the dropped tables need no ordering and
-- no CASCADE: an unexpected outside dependency makes the migration fail instead.
drop table if exists
  public.webhook_events,
  public.appointment_slots,
  public.listing_ai_analysis,
  public.calls,
  public.messages,
  public.appointments,
  public.conversations,
  public.activity_logs,
  public.notes,
  public.lead_listings,
  public.listings,
  public.leads;

-- Helpers that only served the dropped tables.
drop function if exists private.can_read_lead(uuid, uuid);
drop function if exists private.can_read_listing(uuid, uuid);
drop function if exists private.can_write_assigned_record(uuid, uuid);
drop function if exists private.can_read_conversation(uuid, uuid);
drop function if exists private.require_active_advisor(uuid, uuid);
drop function if exists private.member_is_busy(uuid, timestamptz, timestamptz, uuid);
drop function if exists private.ensure_assigned_advisor();
drop function if exists private.normalize_lead_phone();
drop function if exists private.log_lead_activity();
drop function if exists private.log_listing_activity();

-- Usage rows of removed features (WhatsApp messages, call seconds, listing analyses, lead imports).
delete from public.business_usage
where metric in ('AI_CALL_SECONDS', 'AI_ANALYSIS', 'WHATSAPP_MESSAGE', 'LEADS_IMPORTED', 'APPOINTMENTS_CREATED');

commit;
