export const categoryLabels: Record<string,string> = { bug: "缺陷", feature_request: "功能建议", documentation: "文档", usage_question: "使用问题", performance: "性能", other: "其他", unknown: "待判断" };
export const severityLabels: Record<string,string> = { low: "低", medium: "中", high: "高", critical: "严重", unknown: "待判断" };
export const actionLabels: Record<string,string> = { product: "产品", documentation: "文档", operations: "运营", community: "社区", research: "进一步研究" };
export function label(map: Record<string,string>, value: string) { return map[value] ?? value; }
