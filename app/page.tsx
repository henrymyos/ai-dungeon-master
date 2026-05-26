"use client";

import { DmChat } from "@/components/dm-chat";
import { ToastProvider } from "@/components/toast";

export default function Home() {
  return (
    <ToastProvider>
      <div className="h-dvh flex">
        <DmChat />
      </div>
    </ToastProvider>
  );
}
