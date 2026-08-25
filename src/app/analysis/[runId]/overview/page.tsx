import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { AnalysisHeader } from "@/components/analysis-header";
import { sortRunIssues, type IssueSort } from "@/components/issue-ordering";
import { actionLabels, categoryLabels, label, severityLabels } from "@/components/labels";
import { ShareButton } from "@/components/share-button";
import { getDatabase } from "@/db/client";
import { creatorCookieName } from "@/domain/creator-access/cookie";
import { getRunContext, isRunCreator, listRunClusters, listRunIssues } from "@/queries/product";

import styles from "./overview-page.module.css";

export const dynamic = "force-dynamic";

type ResultView = "overview" | "clusters" | "issues";
type ClusterRow = Awaited<ReturnType<typeof listRunClusters>>[number];
type RunIssue = Awaited<ReturnType<typeof listRunIssues>>[number];

const severityWeight: Record<string, number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

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

  const view = resultView(single(query.view));
  const category = single(query.category);
  const severity = single(query.severity);
  const state = single(query.state);
  const action = single(query.action);
  const search = single(query.q).trim();
  const review = single(query.review) === "true";
  const sort: IssueSort = single(query.sort) === "recent" ? "recent" : "recommended";
  const hasFilters = Boolean(category || severity || state || action || search || review);
  const valid = allIssues.filter((item): item is RunIssue & { effective: NonNullable<RunIssue["effective"]> } => Boolean(item.effective));
  const filtered = valid.filter((item) =>
    (!category || item.effective.category === category) &&
    (!severity || item.effective.severity === severity) &&
    (!state || item.issue.state === state) &&
    (!action || item.effective.suggestedAction === action) &&
    (!review || needsReview(item)) &&
    (!search || issueSearchText(item).includes(search.toLocaleLowerCase("zh-CN"))));
  const sortedIssues = sortRunIssues(filtered, sort);
  const high = valid.filter((item) => ["high", "critical"].includes(item.effective.severity)).length;
  const reviewCount = valid.filter(needsReview).length;
  const categories = Object.entries(counts(valid.map((item) => item.effective.category))).sort(
    ([aKey, aValue], [bKey, bValue]) => bValue - aValue ||
      label(categoryLabels, aKey).localeCompare(label(categoryLabels, bKey), "zh-CN"),
  );
  const overviewCategories = compactCategories(categories);
  const maxCount = Math.max(1, ...overviewCategories.map(([, value]) => value));
  const issueById = new Map(valid.map((item) => [item.runIssue.id, item]));

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
          <ShareButton className={styles.shareButton} href={`/analysis/${runId}/overview`} />
        </section>

        <nav className={styles.viewNav} aria-label="洞察结果视图">
          <ViewLink href={`/analysis/${runId}/overview`} active={view === "overview"}>Overview</ViewLink>
          <ViewLink href={`/analysis/${runId}/overview?view=clusters`} active={view === "clusters"}>Clusters <span>{clusterRows.length}</span></ViewLink>
          <ViewLink href={`/analysis/${runId}/overview?view=issues`} active={view === "issues"}>Issues <span>{valid.length}</span></ViewLink>
        </nav>

        {view === "overview" && (
          <>
            <section className={styles.metricStrip} aria-label="关键指标">
              <Metric label="Analyzed" value={valid.length} note="有效分析" tone="primary" />
              <Metric label="High / Critical" value={high} note={`${valid.length ? Math.round(high / valid.length * 100) : 0}% of analyzed`} tone="risk" />
              <Metric label="Clusters" value={clusterRows.length} note="暂定问题簇" />
              <Metric label="Needs review" value={reviewCount} note="含待判断字段" tone="review" />
            </section>

            <section className={styles.panel} aria-labelledby="priorities-title">
              <div className={styles.sectionTitle}>
                <div><p className={styles.eyebrow}>Top priorities</p><h2 id="priorities-title">最值得先验证的问题</h2><p>先看影响更高、重复出现且近期仍活跃的问题簇。</p></div>
                <span className={styles.neutralBadge}>暂定优先级</span>
              </div>
              {clusterRows.length ? (
                <>
                  <ClusterGrid rows={clusterRows.slice(0, 3)} runId={runId} issueById={issueById} />
                  <a className={styles.sectionLink} href={`/analysis/${runId}/overview?view=clusters`}>查看全部 {clusterRows.length} 个问题簇 <span aria-hidden="true">→</span></a>
                </>
              ) : <EmptyState title="尚未生成问题簇" text="旧任务或无有效分析时可能出现此状态；单条 Issue 仍可浏览。" />}
            </section>

            <section className={`${styles.panel} ${styles.distributionPanel}`} aria-labelledby="distribution-title">
              <div className={styles.sectionTitle}>
                <div><p className={styles.eyebrow}>Category snapshot</p><h2 id="distribution-title">反馈构成</h2><p>辅助理解当前仓库的主要 Issue 类型。</p></div>
                <span className={styles.sampleSize}>n = {valid.length}</span>
              </div>
              <div className={styles.barChart} aria-label={`Issue 类别分布，共 ${valid.length} 条有效分析`}>
                {overviewCategories.map(([key, value]) => (
                  <div className={styles.barRow} key={key}>
                    <span>{key === "__other" ? "Other" : label(categoryLabels, key)}</span>
                    <div><i className={key === "unknown" ? styles.unknownBar : undefined} style={{ width: `${value / maxCount * 100}%` }} /></div>
                    <strong>{value} <small>· {valid.length ? Math.round(value / valid.length * 100) : 0}%</small></strong>
                  </div>
                ))}
              </div>
              <div className={styles.overviewFooter}>
                <details className={styles.methodDisclosure}>
                  <summary>数据口径</summary>
                  <p>仅统计成功完成或命中缓存的分析；人工修正后的值会替代模型值。</p>
                </details>
                <a className={styles.sectionLink} href={`/analysis/${runId}/overview?view=issues`}>浏览全部 Issues <span aria-hidden="true">→</span></a>
              </div>
            </section>
          </>
        )}

        {view === "clusters" && (
          <section className={styles.panel} aria-labelledby="all-clusters-title">
            <div className={styles.viewHeader}>
              <div><p className={styles.eyebrow}>Problem clusters</p><h2 id="all-clusters-title">全部问题簇</h2><p>按暂定 Priority score 从高到低排列，下钻后可核对簇内原始证据。</p></div>
              <strong>{clusterRows.length}</strong>
            </div>
            {clusterRows.length
              ? <ClusterGrid rows={clusterRows} runId={runId} issueById={issueById} />
              : <EmptyState title="尚未生成问题簇" text="单条 Issue 仍可在 Issues 视图中浏览。" />}
          </section>
        )}

        {view === "issues" && (
          <section className={`${styles.panel} ${styles.evidencePanel}`} id="issues" aria-labelledby="issues-title">
            <div className={styles.viewHeader}>
              <div><p className={styles.eyebrow}>Evidence workspace</p><h2 id="issues-title">逐条查看 Issue</h2><p>筛选、排序并回到原始反馈，核对每一条结论。</p></div>
              <strong>{hasFilters ? `${sortedIssues.length}/${valid.length}` : sortedIssues.length}</strong>
            </div>
            <form className={styles.filters} method="get">
              <input type="hidden" name="view" value="issues" />
              <label className={styles.searchField}>Search Issues<input name="q" type="search" defaultValue={search} placeholder="Title, summary or area" /></label>
              <Filter labelText="Category" name="category" value={category} options={categoryLabels} />
              <Filter labelText="Severity" name="severity" value={severity} options={severityLabels} />
              <Filter labelText="GitHub status" name="state" value={state} options={{ open: "Open", closed: "Closed" }} />
              <Filter labelText="Needs review" name="review" value={review ? "true" : ""} options={{ true: "Needs review" }} />
              <Filter labelText="Suggested action" name="action" value={action} options={actionLabels} />
              <label>Sort by<select name="sort" defaultValue={sort}><option value="recommended">Recommended</option><option value="recent">Recently updated</option></select></label>
              <button className={styles.filterButton}>应用筛选</button>
              {hasFilters && <a className={styles.clearLink} href={`/analysis/${runId}/overview?view=issues`}>清除全部</a>}
            </form>
            <p className={styles.sortHint}>{sort === "recommended" ? "Recommended：Critical / High → Needs review → Medium → Low；同级按最近更新。" : "Recently updated：按 GitHub 最后更新时间倒序。"}</p>
            {sortedIssues.length ? (
              <div className={styles.issueTable}>
                <div className={styles.tableHead} aria-hidden="true"><span>Issue</span><span>Classification</span><span>Severity</span><span>Status</span><span /></div>
                {sortedIssues.map((item) => (
                  <a className={styles.tableRow} href={`/analysis/${runId}/issues/${item.runIssue.id}`} key={item.runIssue.id}>
                    <span className={styles.issueCell}>
                      <span className={styles.issueTitle}><strong>#{item.issue.issueNumber} {item.issue.title}</strong>{needsReview(item) && <i className={styles.reviewFlag}>Needs review</i>}</span>
                      <small>{item.effective.summary}</small><em>Area · {item.effective.productArea} · {label(actionLabels, item.effective.suggestedAction)}</em>
                    </span>
                    <span className={styles.classificationCell} data-label="Classification"><strong>{label(categoryLabels, item.effective.category)}</strong><small>{item.effective.productArea}</small></span>
                    <span data-label="Severity"><i className={`${styles.severity} ${styles[`severity_${item.effective.severity}`] ?? ""}`}>{label(severityLabels, item.effective.severity)}</i></span>
                    <span data-label="Status">{item.issue.state === "open" ? "Open" : "Closed"}</span>
                    <span className={styles.rowArrow} aria-hidden="true">→</span>
                  </a>
                ))}
              </div>
            ) : <EmptyState title="没有符合条件的 Issue" text="调整搜索、筛选或排序条件后再试。" />}
          </section>
        )}
      </div>
    </main>
  );
}

function ViewLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return <a className={active ? styles.activeView : undefined} href={href} aria-current={active ? "page" : undefined}>{children}</a>;
}

function Metric({ label: metricLabel, value, note, tone }: { label: string; value: number; note: string; tone?: "primary" | "risk" | "review" }) {
  return <article className={tone ? styles[`metric_${tone}`] : undefined}><span>{metricLabel}</span><strong>{value}</strong><small>{note}</small></article>;
}

function ClusterGrid({ rows, runId, issueById }: { rows: ClusterRow[]; runId: string; issueById: Map<string, RunIssue> }) {
  return (
    <div className={styles.clusterGrid}>
      {rows.map(({ cluster, memberIds }, index) => {
        const members = memberIds.flatMap((id) => issueById.get(id) ? [issueById.get(id)!] : []);
        const highestSeverity = members.reduce((current, item) =>
          (severityWeight[item.effective?.severity ?? "unknown"] ?? 0) > (severityWeight[current] ?? 0)
            ? item.effective?.severity ?? "unknown"
            : current, "unknown");
        const lastUpdated = members.reduce<Date | null>((current, item) =>
          !current || item.issue.githubUpdatedAt > current ? item.issue.githubUpdatedAt : current, null);
        return (
          <a className={styles.clusterCard} href={`/analysis/${runId}/clusters/${cluster.id}`} key={cluster.id}>
            <span className={styles.rank}>{String(index + 1).padStart(2, "0")}</span>
            <h3>{cluster.name}</h3><p>{cluster.summary}</p>
            <footer>
              <div><strong>{memberIds.length} Issues</strong><span>Score {Math.round((cluster.priorityScore ?? 0) * 100)} / 100</span></div>
              <div className={styles.clusterMeta}><span>{label(severityLabels, highestSeverity)}</span>{lastUpdated && <span>{formatShortDate(lastUpdated)}</span>}</div>
              <span className={styles.clusterLink}>View evidence <span aria-hidden="true">→</span></span>
            </footer>
          </a>
        );
      })}
    </div>
  );
}

function Filter({ labelText, name, value, options }: { labelText: string; name: string; value: string; options: Record<string, string> }) {
  return <label>{labelText}<select name={name} defaultValue={value}><option value="">全部</option>{Object.entries(options).map(([key, text]) => <option value={key} key={key}>{text}</option>)}</select></label>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className={styles.emptyState}><h3>{title}</h3><p>{text}</p></div>;
}

function resultView(value: string): ResultView {
  return value === "clusters" || value === "issues" ? value : "overview";
}

function needsReview(item: RunIssue): boolean {
  return item.effective?.category === "unknown" || item.effective?.severity === "unknown";
}

function issueSearchText(item: RunIssue): string {
  return [item.issue.issueNumber, item.issue.title, item.effective?.summary, item.effective?.productArea]
    .filter(Boolean).join(" ").toLocaleLowerCase("zh-CN");
}

function compactCategories(entries: Array<[string, number]>): Array<[string, number]> {
  if (entries.length <= 5) return entries;
  return [...entries.slice(0, 5), ["__other", entries.slice(5).reduce((sum, [, value]) => sum + value, 0)]];
}

function formatShortDate(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(value);
}

function single(value: string | string[] | undefined) { return typeof value === "string" ? value : ""; }
function counts(values: string[]) { return values.reduce<Record<string, number>>((result, value) => { result[value] = (result[value] ?? 0) + 1; return result; }, {}); }
