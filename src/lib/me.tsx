"use client";
import { createContext, useContext } from "react";
export type Me = { id: string; email: string; displayName: string; isAdmin: boolean };
export const MeContext = createContext<{ me: Me; reload: () => void } | null>(null);
export function useMe() {
  const v = useContext(MeContext);
  if (!v) throw new Error("useMe outside MeContext");
  return v;
}
