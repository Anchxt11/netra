import styles from "./Placeholder.module.css";

export function LiveDashboard() {
  return (
    <section className={styles.page}>
      <h1 className={styles.title}>Live dashboard</h1>
      <p className={styles.sub}>Live incidents, ranked by how bad, how sure and how soon.</p>
      <p className={styles.note}>Placeholder: queue, incident detail and fixes come next.</p>
    </section>
  );
}
