'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { SiteContent } from '@/lib/site-content';
const Context = createContext<SiteContent | null>(null);
export const useSiteContent = () => useContext(Context);
export function SiteProvider({
  value,
  children,
}: {
  value: SiteContent | null;
  children: ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
