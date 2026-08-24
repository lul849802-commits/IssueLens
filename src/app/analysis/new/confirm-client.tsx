"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import styles from "./confirm-page.module.css";

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function ConfirmClient({ repository }: { repository: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const hasRepository = repositoryPattern.test(repository);
  const [repositoryOwner, repositoryName] = repository.split("/", 2);
  const githubHref = hasRepository
    ? `https://github.com/${repository
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/")}`
    : null;

  async function create(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repository, limit: 100 }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error?.message ?? "创建失败");
      }

      router.push(payload.links.progress);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建失败");
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={`${styles.headerInner} shell`}>
          <Link className={styles.brand} href="/">
            IssueLens
          </Link>
          <span className={styles.headerNote}>
            GitHub Issue <span aria-hidden="true">→</span> Product Insight
          </span>
        </div>
      </header>

      <div className={`${styles.content} shell`}>
        <section className={styles.card} aria-labelledby="repository-title">
          <p className={styles.eyebrow}>Review analysis scope</p>
          <p className={styles.title}>确认分析范围</p>
          <p className={styles.intro}>
            检查目标仓库和数据范围，确认后将创建后台分析任务。
          </p>

          <div className={styles.repositoryBlock}>
            <div>
              <span className={styles.badge}>
                {hasRepository ? "Public repository" : "Repository"}
              </span>
              <h1 id="repository-title">
                {repository ? (
                  <>
                    {repositoryOwner}/<wbr />
                    {repositoryName}
                  </>
                ) : (
                  "未选择仓库"
                )}
              </h1>
            </div>
            {githubHref && (
              <a
                className={styles.githubLink}
                href={githubHref}
                target="_blank"
                rel="noreferrer"
              >
                View on GitHub <span aria-hidden="true">↗</span>
              </a>
            )}
          </div>

          <dl className={styles.scopeList}>
            <div>
              <dt>Source</dt>
              <dd>GitHub Issues</dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>最近更新的最多 100 条 · Open + Closed</dd>
            </div>
            <div>
              <dt>Excludes</dt>
              <dd>Pull Requests · 评论正文 · 私有仓库</dd>
            </div>
            <div>
              <dt>Output</dt>
              <dd>结构化分析 · 问题簇 · 暂定优先级 · 原文证据</dd>
            </div>
          </dl>

          <aside className={styles.backgroundNote}>
            <strong>This starts a background analysis</strong>
            <p>分析通常需要几分钟。任务创建后可以关闭页面，后台处理不会中断。</p>
          </aside>

          <form className={styles.actions} onSubmit={create}>
            <button disabled={!repository || loading}>
              {loading ? "正在创建任务…" : "开始分析"}
            </button>
          </form>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <Link className={styles.changeLink} href="/">
            <span aria-hidden="true">←</span> Change repository
          </Link>
        </section>
      </div>
    </main>
  );
}
