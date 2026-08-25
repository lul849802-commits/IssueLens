"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

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
  const scopeDialog = useRef<HTMLDialogElement>(null);
  const [repository, setRepository] = useState("");
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"idle" | "validating" | "creating">("idle");

  useEffect(() => {
    document
      .querySelector("form.repo-form")
      ?.setAttribute("data-hydrated", "true");
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (phase !== "idle") return;
    setError("");
    setPhase("validating");

    try {
      const validationResponse = await fetch("/api/repositories/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repository }),
      });
      const validationPayload = await validationResponse.json();

      if (!validationResponse.ok) {
        throw new Error(validationPayload.error?.message ?? "无法验证仓库");
      }

      setPhase("creating");
      const analysisResponse = await fetch("/api/analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repository: validationPayload.data.repository.slug,
          limit: 100,
        }),
      });
      const analysisPayload = await analysisResponse.json();

      if (!analysisResponse.ok) {
        throw new Error(analysisPayload.error?.message ?? "暂时无法创建分析任务");
      }

      router.push(analysisPayload.links.progress);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法验证仓库");
      setPhase("idle");
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
            <button disabled={phase !== "idle"}>
              {phase === "validating"
                ? "正在验证…"
                : phase === "creating"
                  ? "正在创建…"
                  : "开始分析"}
            </button>
          </div>
          <div className={styles.helpRow}>
            <p id="repo-help" className={styles.help}>
              Public repositories only · 无需 GitHub 登录 · 不读取评论正文
            </p>
            <button
              className={styles.scopeTrigger}
              type="button"
              onClick={() => scopeDialog.current?.showModal()}
            >
              Analysis scope
            </button>
          </div>
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

        <dialog
          className={styles.scopeDialog}
          ref={scopeDialog}
          aria-labelledby="scope-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) event.currentTarget.close();
          }}
        >
          <div className={styles.scopePanel}>
            <div className={styles.scopeHeader}>
              <div>
                <p>Analysis scope</p>
                <h2 id="scope-title">本次会分析什么</h2>
              </div>
              <button
                type="button"
                aria-label="关闭分析范围说明"
                onClick={() => scopeDialog.current?.close()}
              >
                ×
              </button>
            </div>
            <dl className={styles.scopeList}>
              <div><dt>Source</dt><dd>GitHub Issues</dd></div>
              <div><dt>Scope</dt><dd>最近更新的最多 100 条 · Open + Closed</dd></div>
              <div><dt>Excludes</dt><dd>Pull Requests · 评论正文 · 私有仓库</dd></div>
              <div><dt>Output</dt><dd>结构化分析 · 问题簇 · 暂定优先级 · 原文证据</dd></div>
            </dl>
            <p className={styles.scopeNote}>开始后可关闭页面，后台分析不会中断。</p>
          </div>
        </dialog>
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
