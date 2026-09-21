// 异常判定规则（纯函数）
// - 温度：连续三分钟偏离目标值 2℃ 及以上
// - 酸碱：pH 超出 [4.5, 7.5] 闭区间
// - 泡沫：泡沫量超过上限
import type {
  Anomaly,
  AnomalyKind,
  Batch,
  BatchParams,
  Reading,
  RuleSnapshot,
} from "./types";

export const DEVIATION_C = 2; // 温度偏离阈值 ℃
export const DEVIATION_MINUTES = 3; // 连续偏离分钟数
export const PH_MIN = 4.5;
export const PH_MAX = 7.5;
export const FOAM_LIMIT_MM = 20;
export const PH_RETEST_PASS_REQUIRED = 2; // pH 须两次复测合格

export function snapshotOf(p: BatchParams): RuleSnapshot {
  return {
    targetTemp: p.targetTemp,
    deviationC: p.tempTolerance,
    deviationMinutes: DEVIATION_MINUTES,
    phMin: p.phMin,
    phMax: p.phMax,
    foamLimit: p.foamLimit,
  };
}

export function tempDeviated(r: Reading, p: BatchParams): boolean {
  return Math.abs(r.temp - p.targetTemp) >= p.tempTolerance;
}

export function phOutOfRange(r: Reading, p: BatchParams): boolean {
  return r.ph < p.phMin || r.ph > p.phMax;
}

export function foamOverLimit(r: Reading, p: BatchParams): boolean {
  return r.foam > p.foamLimit;
}

export const KIND_ORDER: AnomalyKind[] = ["temperature", "ph", "foam"];

/** 该类型当前是否存在未闭环异常（同类型在异常未解除前不再重复生成） */
export function hasOpenAnomaly(batch: Batch, kind: AnomalyKind): boolean {
  return batch.anomalies.some((a) => a.kind === kind && a.status === "open");
}

export interface DetectionHit {
  kind: AnomalyKind;
  trigger: Reading;
  evidence: Reading[];
  reason: string;
}

/**
 * 对某一异常类型做一次全量扫描：
 * - 已有未闭环同类型异常 -> 不重复生成
 * - 否则从该类型已扫描位置之后查找触发窗口
 * 温度需要连续 N 分钟偏离；pH / 泡沫只需当前超限点。
 */
export function scanKind(
  batch: Batch,
  kind: AnomalyKind
): DetectionHit | null {
  if (hasOpenAnomaly(batch, kind)) return null;
  const p = batch.params;
  const sorted = [...batch.readings].sort((a, b) => a.minute - b.minute);
  const after = batch.scannedUpTo[kind] ?? 0;

  if (kind === "temperature") {
    let run: Reading[] = [];
    for (const r of sorted) {
      if (r.minute <= after) {
        run = []; // 已扫描过的区间不参与新的连续窗口
        continue;
      }
      if (tempDeviated(r, p)) {
        run.push(r);
        if (run.length >= DEVIATION_MINUTES) {
          const window = run.slice(-DEVIATION_MINUTES);
          return {
            kind,
            trigger: window[window.length - 1],
            evidence: window,
            reason: `${window[0].minute}–${
              window[window.length - 1].minute
            }分钟连续偏离目标 ${p.targetTemp}℃ ≥ ${p.tempTolerance}℃`,
          };
        }
      } else {
        run = [];
      }
    }
    return null;
  }

  const hit = sorted.find((r) => {
    if (r.minute <= after) return false;
    return kind === "ph" ? phOutOfRange(r, p) : foamOverLimit(r, p);
  });
  if (!hit) return null;
  return {
    kind,
    trigger: hit,
    evidence: [hit],
    reason:
      kind === "ph"
        ? `${hit.minute}分钟 pH ${hit.ph} 超出 [${p.phMin}, ${p.phMax}]`
        : `${hit.minute}分钟泡沫 ${hit.foam}mm 超过上限 ${p.foamLimit}mm`,
  };
}

/** 一次上报后依次扫描温度 / pH / 泡沫，保持发生顺序 */
export function detectAll(batch: Batch): DetectionHit[] {
  const hits: DetectionHit[] = [];
  for (const kind of KIND_ORDER) {
    const hit = scanKind(batch, kind);
    if (hit) hits.push(hit);
  }
  return hits;
}

/** 批次当前是否可评审放行：无未闭环异常 */
export function canReview(batch: Batch): boolean {
  return !batch.anomalies.some((a) => a.status === "open");
}

export function openAnomalies(batch: Batch): Anomaly[] {
  return batch.anomalies.filter((a) => a.status === "open");
}

/**
 * 处置队列排序：加急在前（加急时间早的在前），其余按发生顺序。
 * 加急只调队首位置，不改变闭环门槛。
 */
export function sortDispositionQueue(
  anomalies: Anomaly[]
): Anomaly[] {
  return [...anomalies].sort((a, b) => {
    const ua = a.urgentAt ?? Infinity;
    const ub = b.urgentAt ?? Infinity;
    if (ua !== ub) return ua - ub;
    return a.detectedAt - b.detectedAt;
  });
}

/**
 * 该异常此刻是否允许闭环操作：
 * 不能跳过同批次中更早发生（seq 更小）且未闭环的异常。
 */
export function isActionable(batch: Batch, anomaly: Anomaly): boolean {
  if (anomaly.status !== "open") return false;
  return !batch.anomalies.some(
    (a) => a.status === "open" && a.seq < anomaly.seq
  );
}

/** 改参数后：哪些已闭环异常结论失效 —— 从受参数影响的最早闭环异常起，其后的闭环结论全部失效 */
export function affectedByParamChange(
  batch: Batch,
  paramKey: keyof BatchParams
): string[] {
  const kindMap: Partial<Record<keyof BatchParams, AnomalyKind>> = {
    targetTemp: "temperature",
    tempTolerance: "temperature",
    phMin: "ph",
    phMax: "ph",
    foamLimit: "foam",
  };
  const kind = kindMap[paramKey];
  if (!kind) return [];
  const closed = batch.anomalies
    .filter((a) => a.kind === kind && a.status === "closed")
    .sort((a, b) => a.seq - b.seq);
  const first = closed[0];
  if (!first) return [];
  return batch.anomalies
    .filter((a) => a.status === "closed" && a.seq >= first.seq)
    .map((a) => a.id);
}

export function readingStatus(r: Reading, p: BatchParams) {
  return {
    temp: tempDeviated(r, p),
    ph: phOutOfRange(r, p),
    foam: foamOverLimit(r, p),
  };
}
