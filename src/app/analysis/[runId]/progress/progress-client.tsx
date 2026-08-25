"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AnalysisHeader } from "@/components/analysis-header";
import {
  issueProgress,
  pipelineStates,
  runDescription,
  runStatusCopy,
  shouldAutoOpenOverview,
  type PipelineStageState,
  type ProgressCounts,
} from "@/components/progress-presentation";
import type { RunStatus } from "@/domain/runs/run-state";

import styles from "./progress-page.module.css";

interface Status {
  repositorySlug: string;
  status: RunStatus;
  progress: ProgressCounts;
  isTerminal: boolean;
  updatedAt: string;
}

const pipelineStages = [
  { label: "Fetch Issues", index: "01" },
  { label: "Analyze Issues", index: "02" },
  { label: "Build Clusters", index: "03" },
  { label: "Prepare Insights", index: "04" },
];

const stageStateLabels: Record<PipelineStageState, string> = {
  complete: "Complete",
  active: "In progress",
  pending: "Pending",
  partial: "Completed with gaps",
};

const stageStateIcons: Record<PipelineStageState, string> = {
  complete: "✓",
  active: "●",
  pending: "○",
  partial: "!",
};

function stageDetail(
  stageIndex: number,
  state: PipelineStageState,
  counts: ProgressCounts,
): string {
  const processed = counts.succeeded + counts.failed;
  if (state === "pending") return stageIndex === 0 ? "等待后台任务" : "等待中";

  if (stageIndex === 0) {
    return state === "active"
      ? "正在读取公开 Issue"
      : `已读取 ${counts.total} 条`;
  }
  if (stageIndex === 1) {
    if (state === "active") return `${processed}/${counts.total || "—"} 已处理`;
    if (state === "partial") return `${counts.succeeded} 成功 · ${counts.failed} 失败`;
    return `${processed}/${counts.total || processed} 已处理`;
  }
  if (stageIndex === 2) {
    return state === "active" ? "正在归纳相关反馈" : "聚类完成";
  }
  return state === "active" ? "正在整理最终结果" : "洞察已生成";
}

function timestampLabel(status: RunStatus, pollError: boolean): string {
  if (pollError) return "Last successful sync";
  if (status === "complete") return "Completed at";
  if (status === "partial") return "Completed with gaps at";
  if (status === "failed") return "Failed at";
  return "Status synced at";
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function ProgressClient({
  runId,
  initial,
}: {
  runId: string;
  initial: Status;
}) {
  const router = useRouter();
  const hasRedirected = useRef(false);
  const [data, setData] = useState(initial);
  const [pollError, setPollError] = useState(false);

  useEffect(() => {
    if (data.isTerminal) return;

    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/analysis/${runId}/status`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error();
        const payload = await response.json();
        setData(payload.data as Status);
        setPollError(false);
      } catch {
        setPollError(true);
      }
    }, 2500);

    return () => clearInterval(timer);
  }, [runId, data.isTerminal]);

  const copy = runStatusCopy[data.status];
  const description = runDescription(data.status, data.progress);
  const states = pipelineStates(data.status, data.progress.failed);
  const { processed, percentage } = issueProgress(data.progress);
  const overviewAvailable = data.status === "complete" || data.status === "partial";
  const isEmpty = data.status === "complete" && data.progress.total === 0;
  const isFailed = data.status === "failed";
  const isTerminalResult = overviewAvailable && !isEmpty;

  useEffect(() => {
    if (!shouldAutoOpenOverview(data.status, data.progress, pollError)) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const openOverview = () => {
      if (hasRedirected.current || document.visibilityState !== "visible") return;
      hasRedirected.current = true;
      router.push(`/analysis/${runId}/overview`);
    };
    const schedule = () => {
      if (document.visibilityState === "visible" && !hasRedirected.current) {
        timer = setTimeout(openOverview, 1000);
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") {
        if (timer) clearTimeout(timer);
        return;
      }
      schedule();
    };

    schedule();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [data.status, data.progress, pollError, router, runId]);

  return (
    <main className={styles.page}>
      <AnalysisHeader
        runId={runId}
        repository={data.repositorySlug}
        active="progress"
        overviewAvailable={overviewAvailable}
      />

      <section className={`${styles.content} shell`} data-status={data.status}>
        <header className={styles.hero} aria-live="polite" aria-atomic="true">
          <p className={styles.eyebrow}>
            Analysis run <span aria-hidden="true">·</span>{" "}
            <strong>{copy.tag}</strong>
          </p>
          <h1>{isEmpty ? "没有找到可分析的 Issue" : copy.title}</h1>
          <p>{description}</p>
          <div className={styles.scopeLine} aria-label="分析范围">
            <strong>Analysis scope</strong>
            <span>Up to 100 recent Issues · Open + Closed · Comments excluded</span>
          </div>
        </header>

        <section className={styles.runCard} aria-label="分析任务进度">
          {pollError && (
            <div className={styles.connectionWarning} role="status">
              <strong>Connection interrupted · Reconnecting</strong>
              <span>暂时无法同步最新状态，后台任务可能仍在继续运行。</span>
            </div>
          )}

          {isFailed ? (
            <div className={styles.failureState} role="alert">
              <span className={styles.failureIcon} aria-hidden="true">×</span>
              <h2>这次分析任务未能完成</h2>
              <p>请返回首页重新创建任务。未生成的结果不会进入洞察统计。</p>
              <Link href="/">返回首页重新开始</Link>
            </div>
          ) : isEmpty ? (
            <div className={styles.emptyState}>
              <span aria-hidden="true">○</span>
              <h2>当前范围内没有可分析内容</h2>
              <p>该仓库可能没有公开 Issue，或者读取到的内容均为 Pull Requests。</p>
              <Link href="/">Change repository</Link>
            </div>
          ) : (
            <>
              <ol className={styles.pipeline} aria-label="Analysis Pipeline">
                {pipelineStages.map((stage, index) => {
                  const state = states[index]!;
                  return (
                    <li
                      className={styles[state]}
                      key={stage.label}
                      aria-current={state === "active" ? "step" : undefined}
                    >
                      <div className={styles.stageTop}>
                        <span className={styles.stageIcon} aria-hidden="true">
                          {stageStateIcons[state]}
                        </span>
                        <span className={styles.stageIndex}>{stage.index}</span>
                      </div>
                      <strong>{stage.label}</strong>
                      <span className={styles.stageStatus}>{stageStateLabels[state]}</span>
                      <small>{stageDetail(index, state, data.progress)}</small>
                    </li>
                  );
                })}
              </ol>

              {isTerminalResult ? (
                <div className={styles.terminalArea}>
                  {data.status === "partial" && (
                    <div className={styles.partialWarning} role="status">
                      <strong>Partial result</strong>
                      <span>
                        {data.progress.failed} 条 Issue 未成功；可用结果和缺口都会保留。
                      </span>
                    </div>
                  )}
                  <div className={styles.summaryGrid}>
                    <div>
                      <span>Issues analyzed</span>
                      <strong>{data.progress.succeeded}</strong>
                    </div>
                    <div>
                      <span>Failed</span>
                      <strong>{data.progress.failed}</strong>
                    </div>
                    <div>
                      <span>Status</span>
                      <strong className={styles.statusValue}>{copy.tag}</strong>
                    </div>
                  </div>
                  <Link className={styles.resultLink} href={`/analysis/${runId}/overview`}>
                    {data.status === "partial" ? "查看可用洞察" : "立即查看结果"}
                    <span aria-hidden="true">→</span>
                  </Link>
                  {data.status === "complete" && (
                    <p className={styles.redirectNote} role="status">
                      正在进入 Issue 洞察总览…
                    </p>
                  )}
                </div>
              ) : (
                <section className={styles.issueProgress} aria-labelledby="issue-progress-title">
                  <header>
                    <div>
                      <p>Issue analysis</p>
                      <h2 id="issue-progress-title">
                        {percentage === null
                          ? "正在确定可分析 Issue 数量"
                          : `${processed} / ${data.progress.total} processed`}
                      </h2>
                    </div>
                    <strong>{percentage === null ? "Determining scope" : `${percentage}%`}</strong>
                  </header>
                  {percentage === null ? (
                    <div
                      className={`${styles.progressTrack} ${styles.indeterminate}`}
                      role="progressbar"
                      aria-label="正在确定可分析 Issue 数量"
                    >
                      <span />
                    </div>
                  ) : (
                    <div
                      className={styles.progressTrack}
                      role="progressbar"
                      aria-label="Issue analysis progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percentage}
                    >
                      <span style={{ width: `${percentage}%` }} />
                    </div>
                  )}
                  <div className={styles.countGrid}>
                    <div>
                      <span>Completed</span>
                      <strong>{data.progress.succeeded}</strong>
                    </div>
                    <div>
                      <span>Failed</span>
                      <strong>{data.progress.failed}</strong>
                    </div>
                    <div>
                      <span>Remaining</span>
                      <strong>{data.progress.pending}</strong>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
        </section>

        <p className={styles.timestamp} suppressHydrationWarning>
          {timestampLabel(data.status, pollError)} · {formatTimestamp(data.updatedAt)}
        </p>
      </section>
    </main>
  );
}
