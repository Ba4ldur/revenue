import type { Metadata } from "next";
import Link from "next/link";
import { can, ROLE_LABELS } from "@/application/context";
import { requireOrg } from "@/lib/session";
import { KeyValue, PageHeader, Section } from "@/components/ui";

export const metadata: Metadata = { title: "Configurações" };

export default async function SettingsPage() {
  const ctx = await requireOrg();
  const links: Array<[string, string, string, boolean]> = [
    ["/settings/members", "Membros e papéis", "Convites, papéis e desativação de acesso.", true],
    ["/settings/materiality", "Materialidade", "Limites que definem quando uma diferença vira divergência.", true],
    ["/settings/audit", "Trilha de auditoria", "Registro imutável de ações sensíveis.", can(ctx, "audit.read")],
  ];
  return (
    <>
      <PageHeader title="Configurações" />
      <Section title="Organização"><KeyValue items={[["Organização", ctx.orgName], ["Seu papel", ROLE_LABELS[ctx.role]], ["Moeda", "BRL"]]} /></Section>
      <div className="grid gap-4 sm:grid-cols-3">
        {links.filter((l) => l[3]).map(([href, title, desc]) => (
          <Link key={href} href={href} className="rounded-md border border-line bg-paper p-4 hover:border-brand">
            <p className="font-medium">{title}</p><p className="mt-1 text-sm text-ink-3">{desc}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
