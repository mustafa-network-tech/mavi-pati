"use client";

import { useState } from "react";
import { slugify } from "@/lib/slug";

type AccountType = "OFFICE_ADMIN" | "ADVISOR";

export function RegistrationFields() {
  const [accountType, setAccountType] = useState<AccountType>("OFFICE_ADMIN");
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
            value="OFFICE_ADMIN"
            checked={accountType === "OFFICE_ADMIN"}
            onChange={() => setAccountType("OFFICE_ADMIN")}
          />
          <span>
            <strong>Yeni emlak ofisi</strong>
            <small>Ofis yöneticisi olarak kaydolun. Platform Admin onaylar.</small>
          </span>
        </label>
        <label>
          <input
            type="radio"
            name="accountType"
            value="ADVISOR"
            checked={accountType === "ADVISOR"}
            onChange={() => setAccountType("ADVISOR")}
          />
          <span>
            <strong>Mevcut ofise danışman</strong>
            <small>Ofisinize katılın. Ofis yöneticiniz onaylar.</small>
          </span>
        </label>
      </fieldset>

      {accountType === "OFFICE_ADMIN" ? (
        <>
          <label>
            Ofis adı
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
            Ofis adresi
            <span className="input-prefix">
              mkemlak.app/
              <input
                name="slug"
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                minLength={3}
                maxLength={80}
                placeholder="ornek-emlak"
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
            Ofis telefonu
            <input name="phone" type="tel" autoComplete="tel" maxLength={30} />
          </label>
          <label>
            Ofis e-postası
            <input name="officeEmail" type="email" />
          </label>
        </>
      ) : (
        <label>
          Ofis adresi
          <span className="input-prefix">
            mkemlak.app/
            <input
              name="officeSlug"
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              minLength={3}
              maxLength={80}
              placeholder="ornek-emlak"
              required
            />
          </span>
          <small className="field-hint">
            Ofis adresini ofis yöneticinizden alın.
          </small>
        </label>
      )}
    </>
  );
}
