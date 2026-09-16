import { notFound } from "next/navigation";
import { getClinic } from "@/lib/clinics";
import { Assistant } from "@/components/assistant/Assistant";
import { isLocalDemo } from "@/lib/demo/mode";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{
    clinicSlug: string;
  }>;
}) {
  const { clinicSlug } = await params;
  let clinic;
  try {
    clinic = await getClinic(clinicSlug);
  } catch {
    return (
      <main>
        <p>
          Klinik bilgilerine şu anda ulaşılamıyor. Lütfen daha sonra tekrar
          deneyin.
        </p>
      </main>
    );
  }
  if (!clinic) notFound();
  return <Assistant clinic={clinic} preview={isLocalDemo()} />;
}
