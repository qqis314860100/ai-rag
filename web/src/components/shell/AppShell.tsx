import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import TopNav from "./TopNav";
import SideNav from "./SideNav";
import ServiceBanner from "./ServiceBanner";

export default function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location.key]);

  return (
    <div className="flex h-screen flex-col bg-white">
      <TopNav />
      <ServiceBanner />
      <div className="flex flex-1 overflow-hidden">
        <SideNav />
        <main ref={mainRef} className="flex-1 flex flex-col min-h-0 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
