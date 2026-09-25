import { neuterLabels, sexLabels, speciesLabels } from "@/lib/clinic/labels";

export type PatientValues = {
  owner_id: string;
  name: string;
  species: string;
  breed: string | null;
  sex: string;
  birth_date: string | null;
  birth_date_estimated: boolean;
  color: string | null;
  weight_kg: number | null;
  microchip_number: string | null;
  neuter_status: string;
  notes: string | null;
  status?: string;
};

const options = (map: Record<string, string>) =>
  Object.entries(map).map(([value, text]) => <option key={value} value={value}>{text}</option>);

export function PatientFields({
  patient,
  owners,
  selectedOwnerId,
  allowNewOwner,
}: {
  patient?: PatientValues;
  owners: { id: string; full_name: string; phone: string | null }[];
  selectedOwnerId?: string;
  allowNewOwner: boolean;
}) {
  return (
    <>
      <fieldset className="form-fieldset">
        <legend>Hayvan sahibi</legend>
        <div className="form-grid two-columns">
          <label className={allowNewOwner ? undefined : "full-field"}>
            Kayıtlı sahip
            <select name="ownerId" defaultValue={patient?.owner_id ?? selectedOwnerId ?? ""} required={!allowNewOwner}>
              <option value="">{allowNewOwner ? "Yeni sahip ekle" : "Sahip seçin"}</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>{owner.full_name}{owner.phone ? ` · ${owner.phone}` : ""}</option>
              ))}
            </select>
          </label>
          {allowNewOwner && (
            <>
              <label>Yeni sahip ad soyad<input name="newOwnerName" maxLength={160} placeholder="Kayıtlı sahip seçilmediyse" /></label>
              <label>Yeni sahip telefon<input name="newOwnerPhone" inputMode="tel" maxLength={40} /></label>
            </>
          )}
        </div>
      </fieldset>
      <fieldset className="form-fieldset">
        <legend>Hasta bilgileri</legend>
        <div className="form-grid two-columns">
          <label>Adı<input name="name" required maxLength={80} defaultValue={patient?.name} /></label>
          <label>Tür<select name="species" required defaultValue={patient?.species ?? ""}><option value="" disabled>Tür seçin</option>{options(speciesLabels)}</select></label>
          <label>Irk<input name="breed" maxLength={100} defaultValue={patient?.breed ?? ""} /></label>
          <label>Cinsiyet<select name="sex" defaultValue={patient?.sex ?? "UNKNOWN"}>{options(sexLabels)}</select></label>
          <label>Doğum tarihi<input name="birthDate" type="date" defaultValue={patient?.birth_date_estimated ? "" : patient?.birth_date ?? ""} /></label>
          <label>Yaklaşık yaş (yıl)<input name="approximateAge" inputMode="decimal" placeholder="Doğum tarihi bilinmiyorsa" /></label>
          <label>Renk<input name="color" maxLength={80} defaultValue={patient?.color ?? ""} /></label>
          <label>Kilo (kg)<input name="weightKg" inputMode="decimal" defaultValue={patient?.weight_kg ?? ""} /></label>
          <label>Mikroçip numarası<input name="microchipNumber" maxLength={30} defaultValue={patient?.microchip_number ?? ""} /></label>
          <label>Kısırlaştırma<select name="neuterStatus" defaultValue={patient?.neuter_status ?? "UNKNOWN"}>{options(neuterLabels)}</select></label>
          {patient?.status && (
            <label>Kayıt durumu<select name="status" defaultValue={patient.status}><option value="ACTIVE">Aktif</option><option value="DECEASED">Vefat etti</option><option value="ARCHIVED">Arşivlendi</option></select></label>
          )}
          <label>Fotoğraf<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" /></label>
          <label className="full-field">Notlar<textarea name="notes" rows={3} maxLength={5000} defaultValue={patient?.notes ?? ""} /></label>
        </div>
        {patient?.birth_date_estimated && patient.birth_date && (
          <p className="form-hint">Kayıtlı doğum tarihi yaklaşık yaştan hesaplanmıştır ({patient.birth_date}). Değiştirmek için doğum tarihi veya yaklaşık yaş girin.</p>
        )}
      </fieldset>
    </>
  );
}
