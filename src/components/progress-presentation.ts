import type { RunStatus } from "@/domain/runs/run-state";

export type PipelineStageState = "complete" | "active" | "pending" | "partial";

export interface ProgressCounts {
  total: number;
  succeeded: number;
  failed: number;
  pending: number;
}

export interface RunStatusCopy {
  tag: string;
  title: string;
}

export const runStatusCopy: Record<RunStatus, RunStatusCopy> = {
  queued: { tag: "Queued", title: "分析任务已排队" },
  fetching: { tag: "Live", title: "正在读取 GitHub Issues" },
  analyzing: { tag: "Live", title: "正在逐条分析 Issues" },
  clustering: { tag: "Live", title: "正在归纳问题簇" },
  aggregating: { tag: "Live", title: "正在生成洞察总览" },
  complete: { tag: "Complete", title: "分析完成" },
  partial: { tag: "Partial", title: "分析完成，部分 Issue 未成功" },
  failed: { tag: "Failed", title: "分析未完成" },
};

const activeStageByStatus: Partial<Record<RunStatus, number>> = {
  fetching: 0,
  analyzing: 1,
  clustering: 2,
  aggregating: 3,
};

export function pipelineStates(
  status: RunStatus,
  failedCount: number,
): PipelineStageState[] {
  if (status === "complete") return ["complete", "complete", "complete", "complete"];
  if (status === "partial") {
    return ["complete", failedCount > 0 ? "partial" : "complete", "complete", "complete"];
  }
  if (status === "queued" || status === "failed") {
    return ["pending", "pending", "pending", "pending"];
  }

  const activeStage = activeStageByStatus[status];
  return [0, 1, 2, 3].map((stage) => {
    if (stage < activeStage!) return "complete";
    if (stage === activeStage) return "active";
    return "pending";
  });
}

export function issueProgress(counts: ProgressCounts) {
  const processed = counts.succeeded + counts.failed;
  return {
    processed,
    percentage: counts.total > 0
      ? Math.min(100, Math.round((processed / counts.total) * 100))
      : null,
  };
}

export function runDescription(status: RunStatus, counts: ProgressCounts): string {
  switch (status) {
    case "queued":
      return "任务已经创建，正在等待后台处理。你可以安全关闭页面。";
    case "fetching":
      return "正在读取最近更新的公开 Issue，并排除 Pull Requests。";
    case "analyzing":
      return "AI 正在生成结构化判断；单条失败不会中断其余任务。";
    case "clustering":
      return "Issue 分析已完成，正在将相关反馈整理为问题簇。";
    case "aggregating":
      return "问题簇已经生成，正在整理最终统计和洞察结果。";
    case "complete":
      return counts.total === 0
        ? "该仓库没有找到符合当前范围的公开 Issue。"
        : `${counts.succeeded} 条 Issue 已完成分析，问题簇与洞察结果已经生成并保存。`;
    case "partial":
      return `${counts.succeeded} 条 Issue 已形成有效分析，${counts.failed} 条未成功；统计只基于成功条目。`;
    case "failed":
      return "任务未能完成。页面不会把缺失结果显示为成功。";
  }
}
