"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/dashboard", label: "Painel" },
  { href: "/findings", label: "Divergências" },
  { href: "/contracts", label: "Contratos" },
  { href: "/customers", label: "Clientes" },
  { href: "/imports", label: "Importações" },
  { href: "/settings", label: "Configurações" },
];

export function Nav({ hidden }: { hidden: string[] }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Principal">
      {ITEMS.filter((i) => !hidden.includes(i.href)).map((i) => {
        const active = path === i.href || path.startsWith(i.href + "/");
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm ${active ? "bg-white/10 font-medium text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
