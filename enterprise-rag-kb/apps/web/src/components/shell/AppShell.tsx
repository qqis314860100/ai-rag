import type { ReactNode } from "react";
import TopNav from "./TopNav";
import SideNav from "./SideNav";
import ServiceBanner from "./ServiceBanner";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-surface-page">
      <TopNav />
      <ServiceBanner />
      <div className="flex flex-1 overflow-hidden">
        <SideNav />
        <main className="flex-1 flex flex-col min-h-0 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
