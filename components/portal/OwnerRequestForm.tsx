"use client";

import { useActionState, useState } from "react";
import { submitOwnerRequestAction, type OwnerActionState } from "@/app/portal/actions";

export function OwnerRequestForm({
  pets,
  appointmentsEnabled,
  today,
}: {
  pets: { id: string; name: string }[];
  appointmentsEnabled: boolean;
  today: string;
}) {
  const [type, setType] = useState<"APPOINTMENT" | "MEDICATION">(appointmentsEnabled ? "APPOINTMENT" : "MEDICATION");
  const [state, action, pending] = useActionState<OwnerActionState, FormData>(submitOwnerRequestAction, {});
  return (
    <form action={action} className="record-form embedded-form">
      <input type="hidden" name="channel" value="FORM" />
      <div className="form-grid two-columns">
        <label>Talep türü
          <select name="requestType" value={type} onChange={(event) => setType(event.target.value as typeof type)}>
            {appointmentsEnabled && <option value="APPOINTMENT">Randevu</option>}
            <option value="MEDICATION">İlaç / ürün tekrarı</option>
          </select>
        </label>
        <label>Hayvanınız
          <select name="patientId" required defaultValue={pets.length === 1 ? pets[0].id : ""}>
            <option value="" disabled>Seçin</option>
            {pets.map((pet) => <option key={pet.id} value={pet.id}>{pet.name}</option>)}
          </select>
        </label>
        {type === "APPOINTMENT" ? (
          <>
            <label>Tercih edilen gün<input name="preferredDate" type="date" min={today} /></label>
            <label>Tercih edilen saat<input name="preferredTime" maxLength={100} placeholder="Örn. öğleden sonra" /></label>
          </>
        ) : (
          <label className="full-field">İlaç / ürün adı<input name="medicationName" required minLength={2} maxLength={200} placeholder="Veteriner hekiminizin verdiği adıyla" /></label>
        )}
        <label className="full-field">Açıklama<textarea name="details" required minLength={3} maxLength={2000} rows={3} placeholder={type === "APPOINTMENT" ? "Randevu nedeni (ör. aşı, kontrol)" : "Ne zaman verildi, ne kadar kaldı?"} /></label>
      </div>
      {type === "MEDICATION" && <p className="form-hint">İlaç talepleri yalnızca veteriner hekim onayıyla karşılanır.</p>}
      {state.error && <p className="form-message error-message">{state.error}</p>}
      {state.success && <p className="form-message success-message">{state.success}</p>}
      <button className="saas-primary" disabled={pending}>{pending ? "Gönderiliyor…" : "Talebi gönder"}</button>
    </form>
  );
}
