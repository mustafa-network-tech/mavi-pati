"use client";

import { useState } from "react";
import { slugify } from "@/lib/slug";

type AccountType = "CLINIC_ADMIN" | "CLINIC_MEMBER";

export function RegistrationFields() {
  const [accountType, setAccountType] = useState<AccountType>("CLINIC_ADMIN");
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  return (
    <>
      <fieldset className="account-type">
        <legend>Kayıt türü</legend>
        <label>
          <input
            type="radio"
            name="accountType"
            value="CLINIC_ADMIN"
            checked={accountType === "CLINIC_ADMIN"}
            onChange={() => setAccountType("CLINIC_ADMIN")}
          />
          <span>
            <strong>Yeni veteriner kliniği</strong>
            <small>Klinik yöneticisi olarak kaydolun. Platform Admin onaylar.</small>
          </span>
        </label>
        <label>
          <input
            type="radio"
            name="accountType"
            value="CLINIC_MEMBER"
            checked={accountType === "CLINIC_MEMBER"}
            onChange={() => setAccountType("CLINIC_MEMBER")}
          />
          <span>
            <strong>Mevcut kliniğe katıl</strong>
            <small>Veteriner hekim veya personel olarak. Klinik yöneticiniz onaylar.</small>
          </span>
        </label>
      </fieldset>

      {accountType === "CLINIC_ADMIN" ? (
        <>
          <label>
            Klinik adı
            <input
              name="displayName"
              minLength={2}
              maxLength={160}
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value);
                if (!slugEdited) setSlug(slugify(event.target.value));
              }}
              required
            />
          </label>
          <label>
            Klinik adresi
            <span className="input-prefix">
              mkpati.app/
              <input
                name="slug"
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                minLength={3}
                maxLength={80}
                placeholder="ornek-veteriner"
                value={slug}
                onChange={(event) => {
                  setSlug(event.target.value.toLowerCase());
                  setSlugEdited(true);
                }}
                required
              />
            </span>
          </label>
          <label>
            Klinik telefonu
            <input name="phone" type="tel" autoComplete="tel" maxLength={30} />
          </label>
          <label>
            Klinik e-postası
            <input name="clinicEmail" type="email" />
          </label>
        </>
      ) : (
        <>
          <label>
            Klinikteki rolünüz
            <select name="memberRole" defaultValue="VETERINARIAN" required>
              <option value="VETERINARIAN">Veteriner Hekim</option>
              <option value="CLINIC_STAFF">Klinik Personeli</option>
            </select>
          </label>
          <label>
            Klinik adresi
            <span className="input-prefix">
              mkpati.app/
              <input
                name="clinicSlug"
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                minLength={3}
                maxLength={80}
                placeholder="ornek-veteriner"
                required
              />
            </span>
            <small className="field-hint">Klinik adresini klinik yöneticinizden alın.</small>
          </label>
        </>
      )}
    </>
  );
}
