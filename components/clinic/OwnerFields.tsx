export type OwnerValues = {
  full_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
};

export function OwnerFields({ owner }: { owner?: OwnerValues }) {
  return (
    <div className="form-grid two-columns">
      <label>Ad soyad<input name="fullName" required minLength={2} maxLength={160} defaultValue={owner?.full_name} autoComplete="off" /></label>
      <label>Telefon<input name="phone" inputMode="tel" maxLength={40} placeholder="+90 5xx xxx xx xx" defaultValue={owner?.phone ?? ""} /></label>
      <label>E-posta<input name="email" type="email" maxLength={254} defaultValue={owner?.email ?? ""} /></label>
      <label>Adres<input name="address" maxLength={500} defaultValue={owner?.address ?? ""} /></label>
      <label className="full-field">Notlar<textarea name="notes" rows={3} maxLength={5000} defaultValue={owner?.notes ?? ""} /></label>
    </div>
  );
}
