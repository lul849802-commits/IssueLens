import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { AnalysisHeader } from "@/components/analysis-header";
import { IssueMarkdown } from "@/components/issue-markdown";
import { actionLabels, categoryLabels, label, severityLabels } from "@/components/labels";
import { getDatabase } from "@/db/client";
import { creatorCookieName } from "@/domain/creator-access/cookie";
import { getIssueDetail, getRunContext, isRunCreator, listRunClusters } from "@/queries/product";

import { CorrectionForm } from "./correction-form";
import styles from "./issue-page.module.css";

export const dynamic = "force-dynamic";

export default async function IssuePage({ params }: { params: Promise<{ runId: string; runIssueId: string }> }) {
  const { runId, runIssueId } = await params;
  const { db } = getDatabase();
  const [context, item, clusterRows] = await Promise.all([
    getRunContext(db, runId),
    getIssueDetail(db, runId, runIssueId),
    listRunClusters(db, runId),
  ]);
  if (!context || !item) notFound();

  const creator = await isRunCreator(db, runId, (await cookies()).get(creatorCookieName(runId))?.value);
  const analysis = item.effective;

  return (
    <main className={styles.page}>
      <AnalysisHeader runId={runId} repository={`${context.repository.owner}/${context.repository.name}`}
        active="overview" readOnly={!creator} />
      <div className={`shell ${styles.detailPage}`}>
        <a className={styles.backLink} href={`/analysis/${runId}/overview#issues`}>← 返回 Issue 列表</a>

        <section className={styles.hero} aria-labelledby="issue-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Issue #{item.issue.issueNumber}</p>
            <h1 id="issue-title">{item.issue.title}</h1>
            <div className={styles.metadata}>
              <span className={item.issue.state === "open" ? styles.openState : styles.closedState}>
                {item.issue.state === "open" ? "Open" : "Closed"}
              </span>
              <span>{item.issue.commentsCount} comments</span>
              <span>Updated {formatDate(item.issue.githubUpdatedAt)}</span>
            </div>
          </div>
          <a className={styles.githubButton} href={item.issue.htmlUrl} target="_blank" rel="noreferrer">View on GitHub ↗</a>
        </section>

        {item.runIssue.status === "failed" || !analysis ? (
          <section className={`${styles.card} ${styles.unavailable}`}>
            <p className={styles.eyebrow}>Analysis unavailable</p>
            <h2>这条 Issue 暂时没有有效分析</h2>
            <p>{item.runIssue.errorPublicMessage ?? "你仍然可以通过上方链接查看 GitHub 原文。"}</p>
          </section>
        ) : (
          <section className={styles.evidenceLayout}>
            <article className={`${styles.card} ${styles.evidenceCard}`}>
              <p className={styles.eyebrow}>Original evidence</p>
              <h2>GitHub 原文</h2>
              <div className={styles.markdownWrap}><IssueMarkdown value={item.issue.body ?? ""} /></div>
              {item.issue.labels.length > 0 && (
                <div className={styles.labels} aria-label="GitHub labels">
                  {item.issue.labels.map((value) => <span key={value}>{value}</span>)}
                </div>
              )}
            </article>

            <article className={`${styles.card} ${styles.analysisCard}`}>
              <div className={styles.analysisHeader}>
                <div><p className={styles.eyebrow}>AI analysis</p><h2>结构化判断</h2></div>
                {creator ? (
                  <CorrectionForm runId={runId} runIssueId={runIssueId}
                    current={{ category: analysis.category, severity: analysis.severity,
                      productArea: analysis.productArea, targetClusterId: item.correction?.targetClusterId }}
                    clusters={clusterRows.map(({ cluster }) => ({ id: cluster.id, name: cluster.name }))} />
                ) : <span className={styles.readOnly}>Read-only</span>}
              </div>

              {item.correction && (
                <div className={styles.correctionNote} role="status">
                  <strong>Human correction applied</strong>
                  <span>当前使用人工修正后的有效值；原始模型输出仍被保留。</span>
                </div>
              )}

              <div className={styles.summaryBox}><span>摘要</span><p>{analysis.summary}</p></div>

              <dl className={styles.primaryFields}>
                <Field labelText="Category" value={label(categoryLabels, analysis.category)} />
                <div><dt>Severity</dt><dd><i className={`${styles.severity} ${styles[`severity_${analysis.severity}`] ?? ""}`}>{label(severityLabels, analysis.severity)}</i></dd></div>
                <Field labelText="Suggested action" value={label(actionLabels, analysis.suggestedAction)} />
                <Field labelText="Product area" value={analysis.productArea} />
              </dl>

              <dl className={styles.secondaryFields}>
                <Field labelText="User scenario" value={analysis.userScenario} />
                <Field labelText="Reproducibility" value={analysis.reproducibility} />
                <Field labelText="Confidence" value={`${Math.round(analysis.confidence * 100)}%`} />
              </dl>

              <div className={styles.rationale}><span>判断依据</span><p>{analysis.rationale}</p></div>
            </article>
          </section>
        )}
      </div>
    </main>
  );
}

function Field({ labelText, value }: { labelText: string; value: string }) {
  return <div><dt>{labelText}</dt><dd>{value}</dd></div>;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(value);
}
