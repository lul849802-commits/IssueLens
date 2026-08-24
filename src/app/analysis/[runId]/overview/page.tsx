import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { AnalysisHeader } from "@/components/analysis-header";
import { actionLabels, categoryLabels, label, severityLabels } from "@/components/labels";
import { ShareButton } from "@/components/share-button";
import { getDatabase } from "@/db/client";
import { creatorCookieName } from "@/domain/creator-access/cookie";
import { getRunContext, isRunCreator, listRunClusters, listRunIssues } from "@/queries/product";

import styles from "./overview-page.module.css";

export const dynamic = "force-dynamic";

export default async function Overview({ params, searchParams }: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { runId } = await params;
  const query = await searchParams;
  const { db } = getDatabase();
  const context = await getRunContext(db, runId);
  if (!context) notFound();

  const [creator, allIssues, clusterRows] = await Promise.all([
    isRunCreator(db, runId, (await cookies()).get(creatorCookieName(runId))?.value),
    listRunIssues(db, runId),
    listRunClusters(db, runId),
  ]);
  const category = single(query.category);
  const severity = single(query.severity);
  const state = single(query.state);
  const action = single(query.action);
  const hasFilters = Boolean(category || severity || state || action);
  const valid = allIssues.filter((item) => item.effective);
  const filtered = valid.filter((item) =>
    (!category || item.effective?.category === category) &&
    (!severity || item.effective?.severity === severity) &&
    (!state || item.issue.state === state) &&
    (!action || item.effective?.suggestedAction === action));
  const high = valid.filter((item) => ["high", "critical"].includes(item.effective!.severity)).length;
  const needsReview = valid.filter((item) =>
    item.effective!.category === "unknown" || item.effective!.severity === "unknown").length;
  const categories = Object.entries(counts(valid.map((item) => item.effective!.category))).sort(
    ([aKey, aValue], [bKey, bValue]) => bValue - aValue ||
      label(categoryLabels, aKey).localeCompare(label(categoryLabels, bKey), "zh-CN"),
  );
  const maxCount = Math.max(1, ...categories.map(([, value]) => value));

  return (
    <main className={styles.page}>
      <AnalysisHeader runId={runId} repository={`${context.repository.owner}/${context.repository.name}`}
        active="overview" readOnly={!creator} />
      <div className={`shell ${styles.dashboard}`}>
        {context.run.status === "partial" && (
          <p className={styles.warning} role="status">
            部分 Issue 分析失败；以下洞察仅基于 {context.run.succeededCount} 条有效分析。
          </p>
        )}

        <section className={styles.hero} aria-labelledby="overview-title">
          <div>
            <p className={styles.eyebrow}>Insight overview</p>
            <h1 id="overview-title">Issue 洞察总览</h1>
            <p className={styles.scope}>最近更新的 {context.run.totalCount} 条公开 Issue · {context.run.succeededCount} 成功 · {context.run.failedCount} 失败 · Open + Closed</p>
          </div>
          <ShareButton className={styles.shareButton} />
        </section>

        <section className={styles.kpiGrid} aria-label="关键指标">
          <article className={styles.kpiPrimary}><span>Analyzed</span><strong>{valid.length}</strong><small>已完成有效分析</small></article>
          <article><span>High / Critical</span><strong>{high}</strong><small>占有效分析 {valid.length ? Math.round(high / valid.length * 100) : 0}%</small></article>
          <article><span>Clusters</span><strong>{clusterRows.length}</strong><small>暂定问题簇</small></article>
          <article className={styles.kpiReview}><span>Needs review</span><strong>{needsReview}</strong><small>条 Issue 含待判断字段</small></article>
        </section>

        <section className={styles.panel} aria-labelledby="clusters-title">
          <div className={styles.sectionTitle}>
            <div><p className={styles.eyebrow}>Top clusters</p><h2 id="clusters-title">优先关注的问题簇</h2><p>从重复反馈中归纳主题，先查看最值得验证的问题。</p></div>
            <span className={styles.neutralBadge}>暂定优先级</span>
          </div>
          {clusterRows.length ? (
            <div className={styles.clusterGrid}>
              {clusterRows.slice(0, 6).map(({ cluster, memberIds }, index) => (
                <a className={styles.clusterCard} href={`/analysis/${runId}/clusters/${cluster.id}`} key={cluster.id}>
                  <span className={styles.rank}>{String(index + 1).padStart(2, "0")}</span>
                  <h3>{cluster.name}</h3><p>{cluster.summary}</p>
                  <footer>
                    <div><strong>{memberIds.length} Issues</strong><span>Score {Math.round((cluster.priorityScore ?? 0) * 100)} / 100</span></div>
                    <span className={styles.clusterLink}>View cluster <span aria-hidden="true">→</span></span>
                  </footer>
                </a>
              ))}
            </div>
          ) : <EmptyState title="尚未生成问题簇" text="旧任务或无有效分析时可能出现此状态；单条 Issue 仍可浏览。" />}
        </section>

        <section className={`${styles.panel} ${styles.distribution}`} aria-labelledby="distribution-title">
          <div>
            <div className={styles.sectionTitle}>
              <div><p className={styles.eyebrow}>Category distribution</p><h2 id="distribution-title">类别分布</h2></div>
              <span className={styles.sampleSize}>n = {valid.length}</span>
            </div>
            <div className={styles.barChart} aria-label={`Issue 类别分布，共 ${valid.length} 条有效分析`}>
              {categories.map(([key, value]) => (
                <div className={styles.barRow} key={key}>
                  <span>{label(categoryLabels, key)}</span>
                  <div><i className={key === "unknown" ? styles.unknownBar : undefined} style={{ width: `${value / maxCount * 100}%` }} /></div>
                  <strong>{value} <small>· {valid.length ? Math.round(value / valid.length * 100) : 0}%</small></strong>
                </div>
              ))}
            </div>
          </div>
          <aside className={styles.methodNote}>
            <p className={styles.eyebrow}>How to read</p><h2>数据口径</h2>
            <p>仅统计成功完成或命中缓存的分析。失败项不进入分布；人工修正后的值会替代模型结果。</p>
          </aside>
        </section>

        <section className={`${styles.panel} ${styles.evidencePanel}`} id="issues" aria-labelledby="issues-title">
          <div className={styles.sectionTitle}>
            <div><p className={styles.eyebrow}>Evidence table</p><h2 id="issues-title">逐条查看 Issue</h2><p>从聚合洞察回到原始反馈，核对每一条结论。</p></div>
            <span className={styles.resultCount}>{hasFilters ? `${filtered.length} / ${valid.length}` : filtered.length} results</span>
          </div>
          <form className={styles.filters} method="get">
            <Filter labelText="Category" name="category" value={category} options={categoryLabels} />
            <Filter labelText="Severity" name="severity" value={severity} options={severityLabels} />
            <Filter labelText="GitHub status" name="state" value={state} options={{ open: "Open", closed: "Closed" }} />
            <Filter labelText="Suggested action" name="action" value={action} options={actionLabels} />
            <button className={styles.filterButton}>应用筛选</button>
            {hasFilters && <a className={styles.clearLink} href={`/analysis/${runId}/overview#issues`}>清除</a>}
          </form>
          {filtered.length ? (
            <div className={styles.issueTable}>
              <div className={styles.tableHead} aria-hidden="true"><span>Issue</span><span>Category</span><span>Severity</span><span>Suggested action</span><span>GitHub status</span><span /></div>
              {filtered.map((item) => (
                <a className={styles.tableRow} href={`/analysis/${runId}/issues/${item.runIssue.id}`} key={item.runIssue.id}>
                  <span className={styles.issueCell}>
                    <strong>#{item.issue.issueNumber} {item.issue.title}</strong>
                    <small>{item.effective!.summary}</small><em>Area · {item.effective!.productArea}</em>
                  </span>
                  <span data-label="Category">{label(categoryLabels, item.effective!.category)}</span>
                  <span data-label="Severity"><i className={`${styles.severity} ${styles[`severity_${item.effective!.severity}`] ?? ""}`}>{label(severityLabels, item.effective!.severity)}</i></span>
                  <span data-label="Suggested action">{label(actionLabels, item.effective!.suggestedAction)}</span>
                  <span data-label="GitHub status">{item.issue.state === "open" ? "Open" : "Closed"}</span>
                  <span className={styles.rowArrow} aria-hidden="true">→</span>
                </a>
              ))}
            </div>
          ) : <EmptyState title="没有符合条件的 Issue" text="调整或清除筛选条件后再试。" />}
        </section>
      </div>
    </main>
  );
}

function Filter({ labelText, name, value, options }: { labelText: string; name: string; value: string; options: Record<string, string> }) {
  return <label>{labelText}<select name={name} defaultValue={value}><option value="">全部</option>{Object.entries(options).map(([key, text]) => <option value={key} key={key}>{text}</option>)}</select></label>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className={styles.emptyState}><h3>{title}</h3><p>{text}</p></div>;
}

function single(value: string | string[] | undefined) { return typeof value === "string" ? value : ""; }
function counts(values: string[]) { return values.reduce<Record<string, number>>((result, value) => { result[value] = (result[value] ?? 0) + 1; return result; }, {}); }
