// 异常放行台 —— 领域类型定义
// 本文件只定义数据形状，不含任何状态计算与副作用。

/** 异常项类别 */
export type AnomalyType = "temperature" | "ph" | "foam";

/**
 * 异常闭环结论：
 * - open       待处置 / 失效后打回重处
 * - closed     已闭环（结论有效）
 * - voided     已闭环但因之后改参数而失效（旧履历留档，不再有效）
 */
export type IncidentStatus = "open" | "closed" | "voided";

export type ReviewVerdict = "released" | "rejected";

export type ParamKey = "targetTemp" | "holdMinutes" | "phLimit" | "foamLimit";

/** 采样读数（时间倒序写入，最新在数组头部也可，一律以 at 排序） */
export interface Reading {
  id: string;
  at: number;
  temperature: number; // ℃
  ph: number;
  foam: number; // 泡沫量（mm）
}

/** 闭环过程事件 —— 履历的唯一明细来源，永不删除 */
export interface IncidentEvent {
  id: string;
  at: number;
  kind:
    | "raised" // 生成待处置记录
    | "urged" // 标记加急
    | "deurged" // 取消加急
    | "timeMadeUp" // 温度补时
    | "retestPass" // 复测合格
    | "retestFail" // 复测不合格
    | "defoamed" // 排泡
    | "closed" // 闭环
    | "invalidated"; // 因改参数导致本结论失效
  note?: string;
}

/** 一次异常处置记录（同一批次同一类别，未闭环期间不重复生成） */
export interface Incident {
  id: string;
  batchId: string;
  seq: number; // 批次内发生序号，从 1 开始，决定解除顺序
  type: AnomalyType;
  raisedAt: number;
  status: IncidentStatus;
  /** 触发时的越限值快照 */
  trigger: {
    temperature?: number;
    ph?: number;
    foam?: number;
  };
  closedAt?: number;
  closeNote?: string;
  urgent: boolean;
  urgedAt?: number;
  /** 失效时间：该时刻起本记录打回，事件履历保留 */
  invalidatedAt?: number;
  invalidateReason?: string;
  events: IncidentEvent[];
}

export interface Review {
  at: number;
  verdict: ReviewVerdict;
  note: string;
  /** 参数被改 / 异常打回后，旧评审结论被作废但留档 */
  superseded: boolean;
}

export interface Batch {
  id: string;
  name: string;
  fabric: string;
  orderNo: string;
  /** 工艺参数（解除后修改会使本项及后续结论失效） */
  params: {
    targetTemp: number; // 目标温度 ℃
    holdMinutes: number; // 要求保温分钟数
    phLimit: [number, number]; // 合格 pH 区间
    foamLimit: number; // 泡沫上限 mm
  };
  /** 累计已补保温分钟数（温度项闭环依据） */
  makeupMinutes: number;
  readings: Reading[];
  incidents: Incident[];
  reviews: Review[];
  createdAt: number;
}

export interface AppState {
  version: 1;
  batches: Batch[];
  selectedBatchId: string | null;
}
