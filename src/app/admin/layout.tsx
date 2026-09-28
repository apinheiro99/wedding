"use client";
import { usePathname } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
export default function L({ children }: { children: React.ReactNode }) {
  return usePathname() === "/admin/login" ? <>{children}</> : <AdminShell>{children}</AdminShell>;
}
