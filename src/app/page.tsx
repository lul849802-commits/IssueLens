"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import styles from "./page.module.css";

const exampleRepository = "openai/openai-python";

const proofPoints = [
  { label: "Up to 100", value: "最近更新的 Issue" },
  { label: "Structured", value: "AI 结构化分析" },
  { label: "Traceable", value: "结论可回溯" },
  { label: "Correctable", value: "创建者可修正" },
];

const capabilities = [
  {
    index: "01",
    label: "Find patterns",
    title: "识别共性问题",
    description: "将语义相近的 Issue 聚合为问题簇，快速发现反复出现的反馈。",
  },
  {
    index: "02",
    label: "Prioritize",
    title: "判断关注顺序",
    description:
      "综合频次、严重程度、近期性和互动信号，提供可解释的暂定优先级。",
  },
  {
    index: "03",
    label: "Trace evidence",
    title: "回看真实证据",
    description: "从问题簇下钻到原始 Issue，对照 GitHub 原文与 AI 判断。",
  },
];

export default function Home() {
  const router = useRouter();
  const [repository, setRepository] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document
      .querySelector("form.repo-form")
      ?.setAttribute("data-hydrated", "true");
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/repositories/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repository }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error?.message ?? "无法验证仓库");
      }

      router.push(
        `/analysis/new?repository=${encodeURIComponent(payload.data.repository.slug)}` as Route,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法验证仓库");
    } finally {
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

      <section className={`${styles.hero} shell`}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>
            Evidence-first product intelligence
          </p>
          <h1>
            <span>把零散 Issue，</span>
            <span>
              变成可行动的<span className={styles.mobileBreak}><br /></span>产品洞察
            </span>
          </h1>
          <p className={styles.lead}>
            输入公开 GitHub 仓库，IssueLens 会分析最近更新的最多 100 条
            Issue，识别共性问题、严重程度与行动方向，并让每条结论都能回到原始证据。
          </p>
        </div>

        <form
          className={`${styles.repoForm} repo-form`}
          action="/analysis/new"
          method="get"
          onSubmit={submit}
          aria-label="创建仓库分析"
          data-hydrated="false"
        >
          <p className={styles.formKicker}>Start an analysis</p>
          <label htmlFor="repository">分析公开仓库</label>
          <div className={styles.inputRow}>
            <input
              id="repository"
              name="repository"
              aria-label="公开仓库地址"
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              placeholder="owner/repo 或 GitHub URL"
              required
              aria-describedby="repo-help repo-error"
            />
            <button disabled={loading}>
              {loading ? "正在验证…" : "开始分析"}
            </button>
          </div>
          <p id="repo-help" className={styles.help}>
            Public repositories only · 无需 GitHub 登录 · 不读取评论正文
          </p>
          <button
            className={styles.example}
            type="button"
            onClick={() => {
              setRepository(exampleRepository);
              setError("");
            }}
          >
            Try <span>{exampleRepository}</span>
          </button>
          {error && (
            <p id="repo-error" className={styles.error} role="alert">
              {error}
            </p>
          )}
        </form>
      </section>

      <section className={`${styles.proofStrip} shell`} aria-label="产品可信特性">
        {proofPoints.map((point) => (
          <div key={point.label}>
            <strong>{point.label}</strong>
            <span>{point.value}</span>
          </div>
        ))}
      </section>

      <section
        className={`${styles.capabilities} shell`}
        aria-labelledby="capabilities-title"
      >
        <div className={styles.sectionHeading}>
          <div>
            <p>From signal to evidence</p>
            <h2 id="capabilities-title">从反馈里找到下一步</h2>
          </div>
        </div>
        <div className={styles.capabilityGrid}>
          {capabilities.map((capability) => (
            <article key={capability.index}>
              <div className={styles.cardMeta}>
                <span>{capability.index}</span>
                <span>{capability.label}</span>
              </div>
              <h3>{capability.title}</h3>
              <p>{capability.description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className={`${styles.footer} shell`}>
        <span>IssueLens</span>
        <span>Evidence-first product intelligence for GitHub Issues</span>
      </footer>
    </main>
  );
}
