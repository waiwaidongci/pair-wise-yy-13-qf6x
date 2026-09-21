// 选择器层：所有派生状态（批次状态、处置队列、复测进度、时间线）
// 均为纯函数，组件与持久化之外不允许另算状态，保证列表/时间线/刷新后一致。
import type {
  AnomalyType,
  AppState,
  Batch,
  Incident,
  Reading,
} from "./types";
import {
  isFoamOverLimit,
  isPhOutOfRange,
  isTempDeviating,
  REQUIRED_PASS,
  TYPE_LABEL,
} from "./rules";

export const clamp = (n: number) => Math.round(n * 100) / 100;

export function getBatch(state: AppState, id: string | null): Batch | undefined {
  if (!id) return undefined;
  return state.batches.find((b) => b.id === id);
}

export function sortedReadings(batch: Batch): Reading[] {
  return [...batch.readings].sort((a, b) => a.at - b.at);
}

export function sortedIncidents(batch: Batch): Incident[] {
  return [...batch.incidents].sort((a, b) => a.seq - b.seq);
}

export function openIncidents(batch: Batch): Incident[] {
  return sortedIncidents(batch).filter((i) => i.status === "open");
}

/** 解除顺序永远以发生序号为准；加急不改变 FIFO，只改变展示与提醒 */
export function earliestOpen(batch: Batch): Incident | undefined {
  return openIncidents(batch)[0];
}

/** 处置队列：加急插队首，同级再按发生序号 */
export function disposalQueue(batch: Batch): Incident[] {
  return openIncidents(batch).sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return a.seq - b.seq;
  });
}

export function isFifoBlocked(batch: Batch, inc: Incident): boolean {
  const first = earliestOpen(batch);
  return !first || first.id !== inc.id;
}

export type BatchStatus = "normal" | "blocked" | "released" | "rejected";

export function activeReview(batch: Batch) {
  return [...batch.reviews].reverse().find((r) => !r.superseded);
}

export function batchStatus(batch: Batch): BatchStatus {
  if (openIncidents(batch).length > 0) return "blocked";
  const review = activeReview(batch);
  if (review) return review.verdict;
  return "normal";
}

export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  normal: "无异常·可评审",
  blocked: "异常锁定·不得评审",
  released: "已放行",
  rejected: "已拒收",
};

/** pH 连续合格复测次数（一次失败即断链清零） */
export function phProgress(inc: Incident): number {
  let pass = 0;
  for (const e of inc.events) {
    if (e.kind === "retestPass") pass += 1;
    if (e.kind === "retestFail") pass = 0;
  }
  return pass;
}

/** 泡沫项当前是否已排泡且尚未被一次复测消耗（复测失败后须重新排泡） */
export function foamDefoamReady(inc: Incident): boolean {
  let ready = false;
  for (const e of inc.events) {
    if (e.kind === "defoamed") ready = true;
    if (e.kind === "retestPass" || e.kind === "retestFail") ready = false;
  }
  return ready;
}

export function requiredPass(type: AnomalyType): number {
  return REQUIRED_PASS[type];
}

export function incidentHeadline(inc: Incident): string {
  const parts: string[] = [];
  if (inc.trigger.temperature !== undefined)
    parts.push(`实测 ${clamp(inc.trigger.temperature)}℃`);
  if (inc.trigger.ph !== undefined) parts.push(`pH ${inc.trigger.ph}`);
  if (inc.trigger.foam !== undefined) parts.push(`泡沫 ${inc.trigger.foam}mm`);
  return parts.join(" · ");
}

// ───────────────────────── 触发检测（供采样引擎调用） ─────────────────────────

/**
 * 该类型上一条已终结记录的"判定截止时刻"：
 * - 已闭环：取闭环时刻（此时刻之前的越限已被处置）；
 * - 闭环后失效：仍取闭环时刻——闭环前表征当前状态的读数窗口
 *   在改参数后仍可作为重判依据，但同一偏离不会再次计数（失效时立即重判，
 *   若未重触发，则后续需有闭环时刻之后的新读数才能再触发）。
 */
export function cutoffAfter(batch: Batch, type: AnomalyType): number {
  let cutoff = 0;
  for (const inc of batch.incidents) {
    if (inc.type !== type) continue;
    if (inc.status === "closed") cutoff = Math.max(cutoff, inc.closedAt ?? 0);
    if (inc.status === "voided")
      cutoff = Math.max(cutoff, inc.closedAt ?? inc.invalidatedAt ?? 0);
  }
  return cutoff;
}

function hasOpenType(batch: Batch, type: AnomalyType): boolean {
  return batch.incidents.some(
    (i) => i.type === type && i.status === "open"
  );
}

export interface TriggerHit {
  type: AnomalyType;
  at: number;
  value: number;
}

/**
 * 依据当前全部读数计算"此刻应当新生成"的待处置记录：
 * 温度需连续 3 分钟（采样间隔不大于 90 秒视为连续）偏离 ≥2℃。
 */
export function evaluateTriggers(batch: Batch): TriggerHit[] {
  const hits: TriggerHit[] = [];
  const readings = sortedReadings(batch);

  // 温度：连续偏离滑窗
  if (!hasOpenType(batch, "temperature")) {
    const cutoff = cutoffAfter(batch, "temperature");
    let runStart: number | null = null;
    let prevAt: number | null = null;
    for (const r of readings) {
      if (r.at <= cutoff) continue;
      const deviating = isTempDeviating(
        r.temperature,
        batch.params.targetTemp
      );
      if (deviating) {
        if (
          runStart === null ||
          prevAt === null ||
          r.at - prevAt > 90_000
        ) {
          runStart = r.at; // 间隔过大不能主张"连续"
        }
        if (r.at - runStart >= 180_000 - 1e-9) {
          hits.push({ type: "temperature", at: r.at, value: r.temperature });
          break;
        }
      } else {
        runStart = null;
      }
      prevAt = r.at;
    }
  }

  if (!hasOpenType(batch, "ph")) {
    const cutoff = cutoffAfter(batch, "ph");
    for (const r of readings) {
      if (r.at <= cutoff) continue;
      if (isPhOutOfRange(r.ph, batch.params.phLimit)) {
        hits.push({ type: "ph", at: r.at, value: r.ph });
        break;
      }
    }
  }

  if (!hasOpenType(batch, "foam")) {
    const cutoff = cutoffAfter(batch, "foam");
    for (const r of readings) {
      if (r.at <= cutoff) continue;
      if (isFoamOverLimit(r.foam, batch.params.foamLimit)) {
        hits.push({ type: "foam", at: r.at, value: r.foam });
        break;
      }
    }
  }

  return hits;
}

// ───────────────────────── 时间线（履历留档的统一视图） ─────────────────────────

export interface TimelineItem {
  key: string;
  at: number;
  seq?: number;
  tone: "raise" | "action" | "close" | "void" | "review" | "flag";
  title: string;
  detail: string;
  dimmed?: boolean; // 已失效履历
}

const EVENT_TEXT: Partial<Record<string, string>> = {
  urged: "标记加急（处置队列插队首，不跳过更早未闭环项）",
  deurged: "取消加急",
  timeMadeUp: "温度补时",
  retestPass: "复测合格",
  retestFail: "复测不合格，连续合格计数清零",
  defoamed: "已排泡",
  closed: "闭环解除",
  invalidated: "工艺参数变更，本结论失效并打回重处",
};

export function selectTimeline(batch: Batch): TimelineItem[] {
  const items: TimelineItem[] = [];

  for (const inc of sortedIncidents(batch)) {
    const tag = `#${inc.seq} ${TYPE_LABEL[inc.type]}`;
    for (const e of inc.events) {
      if (e.kind === "raised") {
        items.push({
          key: e.id,
          at: e.at,
          seq: inc.seq,
          tone: "raise",
          title: `${tag} 生成待处置记录`,
          detail: incidentHeadline(inc),
          dimmed: inc.status === "voided",
        });
        continue;
      }
      items.push({
        key: e.id,
        at: e.at,
        seq: inc.seq,
        tone:
          e.kind === "closed"
            ? "close"
            : e.kind === "invalidated"
              ? "void"
              : e.kind === "urged"
                ? "flag"
                : "action",
        title: `${tag} · ${EVENT_TEXT[e.kind] ?? e.kind}`,
        detail: e.note ?? "",
        dimmed: inc.status === "voided",
      });
    }
  }

  for (const review of batch.reviews) {
    items.push({
      key: `review-${review.at}`,
      at: review.at,
      tone: "review",
      title:
        review.verdict === "released"
          ? "评审结论：放行"
          : "评审结论：拒收",
      detail:
        (review.superseded ? "【已作废·留档】" : "") + (review.note || ""),
      dimmed: review.superseded,
    });
  }

  return items.sort((a, b) => a.at - b.at);
}

export interface DashboardMetric {
  label: string;
  value: number;
  hint: string;
}

export function selectMetrics(state: AppState): DashboardMetric[] {
  let openCount = 0;
  let blocked = 0;
  let released = 0;
  let urgent = 0;
  for (const b of state.batches) {
    const ops = openIncidents(b);
    openCount += ops.length;
    urgent += ops.filter((i) => i.urgent).length;
    if (ops.length > 0) blocked += 1;
    if (batchStatus(b) === "released") released += 1;
  }
  return [
    { label: "异常批次锁定", value: blocked, hint: "存在待处置记录" },
    { label: "待处置异常", value: openCount, hint: "按发生顺序闭环" },
    { label: "加急异常", value: urgent, hint: "插队首·不跳序" },
    { label: "已放行批次", value: released, hint: "评审通过" },
  ];
}
