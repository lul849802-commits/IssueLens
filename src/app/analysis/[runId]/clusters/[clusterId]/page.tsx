import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { AnalysisHeader } from "@/components/analysis-header";
import { actionLabels, categoryLabels, label, severityLabels } from "@/components/labels";
import { getDatabase } from "@/db/client";
import { creatorCookieName } from "@/domain/creator-access/cookie";
import { getClusterDetail, getRunContext, isRunCreator } from "@/queries/product";

import styles from "./cluster-page.module.css";

export const dynamic = "force-dynamic";

const severityOrder: Record<string, number> = { unknown: 0, low: 1, medium: 2, high: 3, critical: 4 };

export default async function ClusterPage({ params }: { params: Promise<{ runId: string; clusterId: string }> }) {
  const { runId, clusterId } = await params;
  const { db } = getDatabase();
  const [context, detail] = await Promise.all([
    getRunContext(db, runId),
    getClusterDetail(db, runId, clusterId),
  ]);
  if (!context || !detail) notFound();

  const creator = await isRunCreator(db, runId, (await cookies()).get(creatorCookieName(runId))?.value);
  const highestSeverity = detail.issues.reduce<string>((current, item) => {
    const value = item.effective?.severity ?? "unknown";
    return (severityOrder[value] ?? 0) > (severityOrder[current] ?? 0) ? value : current;
  }, "unknown");

  return (
    <main className={styles.page}>
      <AnalysisHeader runId={runId} repository={`${context.repository.owner}/${context.repository.name}`}
        active="overview" readOnly={!creator} />
      <div className={`shell ${styles.detailPage}`}>
        <a className={styles.backLink} href={`/analysis/${runId}/overview`}>← 返回洞察总览</a>

        <section className={styles.hero} aria-labelledby="cluster-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Problem cluster</p>
            <h1 id="cluster-title">{detail.cluster.name}</h1>
            <p className={styles.summary}>{detail.cluster.summary}</p>
            <div className={styles.clusterMeta}>
              <span>{detail.issues.length} Issues</span>
              <span>最高严重性：{label(severityLabels, highestSeverity)}</span>
              <span>Suggested action：{label(actionLabels, detail.cluster.suggestedAction)}</span>
            </div>
          </div>
          <aside className={styles.scoreCard} aria-label="暂定优先评分">
            <span>Provisional score</span>
            <strong>{Math.round((detail.cluster.priorityScore ?? 0) * 100)} <small>/ 100</small></strong>
            <p>Frequency · Severity<br />Recency · Engagement</p>
          </aside>
        </section>

        <section className={styles.panel} aria-labelledby="cluster-evidence-title">
          <div className={styles.sectionTitle}>
            <div>
              <p className={styles.eyebrow}>Cluster evidence</p>
              <h2 id="cluster-evidence-title">构成该问题簇的 Issue</h2>
              <p>逐条查看原始反馈，验证这个问题簇是否成立。</p>
            </div>
            <span>{detail.issues.length} results</span>
          </div>
          {detail.issues.length ? (
            <div className={styles.issueList}>
              {detail.issues.map((item) => (
                <a href={`/analysis/${runId}/issues/${item.runIssue.id}`} key={item.runIssue.id}>
                  <div className={styles.issueCopy}>
                    <strong>#{item.issue.issueNumber} {item.issue.title}</strong>
                    <p>{item.effective?.summary ?? "这条 Issue 暂时没有有效分析。"}</p>
                  </div>
                  <div className={styles.issueMeta}>
                    <span>{item.effective ? label(categoryLabels, item.effective.category) : "未分析"}</span>
                    <i className={`${styles.severity} ${styles[`severity_${item.effective?.severity ?? "unknown"}`] ?? ""}`}>
                      {item.effective ? label(severityLabels, item.effective.severity) : "—"}
                    </i>
                    <span>{item.issue.state === "open" ? "Open" : "Closed"}</span>
                  </div>
                  <span className={styles.viewLink}>View issue <span aria-hidden="true">→</span></span>
                </a>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <h3>这个问题簇暂时没有 Issue</h3>
              <p>人工修正归属后可能出现此状态。</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
