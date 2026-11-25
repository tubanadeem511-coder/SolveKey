import type { ReactNode } from "react";
import { AppShell } from "../../components/AppShell";
import { SocketConnection } from "../../components/SocketConnection";

export default function MainLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <SocketConnection />
      <AppShell>{children}</AppShell>
    </>
  );
}
