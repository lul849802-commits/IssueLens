import Link from "next/link";

import styles from "./analysis-header.module.css";

interface AnalysisHeaderProps {
  runId: string;
  repository: string;
  active: "progress" | "overview";
  readOnly?: boolean;
  overviewAvailable?: boolean;
}

export function AnalysisHeader({
  runId,
  repository,
  active,
  readOnly,
  overviewAvailable = true,
}: AnalysisHeaderProps) {
  const [owner, name] = repository.split("/", 2);

  return (
    <header className={styles.header}>
      <Link className={styles.brand} href="/">
        IssueLens
      </Link>
      <div className={styles.repository}>
        <strong>
          {owner}/<wbr />
          {name}
        </strong>
        {readOnly && <span className={styles.readOnly}>只读分享</span>}
      </div>
      <nav className={styles.navigation} aria-label="分析导航">
        <Link
          className={active === "progress" ? styles.active : undefined}
          href={`/analysis/${runId}/progress`}
        >
          任务状态
        </Link>
        {overviewAvailable ? (
          <Link
            className={active === "overview" ? styles.active : undefined}
            href={`/analysis/${runId}/overview`}
          >
            洞察总览
          </Link>
        ) : (
          <span className={styles.disabled} aria-disabled="true">
            洞察总览
            <small>完成后可查看</small>
          </span>
        )}
      </nav>
    </header>
  );
}
