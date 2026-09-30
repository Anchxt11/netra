import { Outlet } from "react-router-dom";
import { TopBar } from "../features/topbar/TopBar";
import styles from "./AppShell.module.css";

export function AppShell() {
  return (
    <div className={styles.shell}>
      <TopBar />
      <main className={styles.page}>
        <Outlet />
      </main>
    </div>
  );
}
