// 染整异常放行台 —— 领域类型
// 本层只定义数据结构与判定结果，不依赖 React 与 localStorage。

export type AnomalyKind = "temperature" | "ph" | "foam";

export type AnomalyStatus = "open" | "closed";

/** 一次在线测量读数（温度 / 酸碱 / 泡沫同时上报） */
export interface Reading {
  id: string;
  minute: number; // 工艺分钟序号
  temp: number; // 实测温度 ℃
  ph: number; // 实测 pH
  foam: number; // 泡沫量 mm
  at: number; // 上报时间戳
}

/** 复测 / 排泡 / 补时 等处置动作 */
export type DispositionActionType =
  | "makeup" // 温度补时
  | "ph_retest" // pH 复测
  | "foam_defoam" // 排泡
  | "foam_retest" // 排泡后复测
  | "rush" // 加急插队
  | "unrush"; // 撤销加急

export interface DispositionAction {
  type: DispositionActionType;
  at: number;
  value?: number; // 复测读数 / 补时分钟
  pass?: boolean; // 复测是否合格
  detail: string;
}

/** 待处置异常记录 */
export interface Anomaly {
  id: string;
  seq: number; // 全批次顺序号，按发生顺序递增
  batchId: string;
  kind: AnomalyKind;
  /** 触发时刻 */
  detectedAt: number;
  /** 触发时的读数证据（温度取第 3 分钟） */
  triggerReading: Reading;
  /** 触发时刻的连续读数（温度项为 3 个点，其余 1 个） */
  evidence: Reading[];
  /** 触发时刻的阈值快照 */
  snapshot: RuleSnapshot;
  status: AnomalyStatus;
  closedAt?: number;
  /** 解除时依据的参数版本 */
  closedParamVersion?: number;
  /** 闭环处置流水：补时、复测、排泡 */
  actions: DispositionAction[];
  /** pH 合格复测次数（需两次） */
  phPassCount: number;
  /** 泡沫是否已排泡（须先排泡再复测） */
  defoamed: boolean;
  /** 加急时间戳；越小插队越靠前 */
  urgentAt?: number;
  /** 是否因改参数导致旧结论失效（失效后重新打开） */
  voided?: boolean;
  /** 结论失效时间戳 */
  voidedAt?: number;
}

export type ReviewStatus = "pending" | "approved";

/** 异常触发时刻的规则阈值快照（留档用） */
export interface RuleSnapshot {
  targetTemp: number;
  deviationC: number;
  deviationMinutes: number;
  phMin: number;
  phMax: number;
  foamLimit: number;
}

/** 批次工艺参数；修改参数会影响已闭环结论的有效性 */
export interface BatchParams {
  targetTemp: number; // 目标温度 ℃
  tempTolerance: number; // 温度允许偏离 ℃
  holdMinutes: number; // 保温时长（分钟）
  phMin: number;
  phMax: number;
  foamLimit: number; // 泡沫上限 mm
}

export interface Batch {
  id: string;
  code: string;
  fabric: string;
  recipe: string;
  orderNo: string;
  params: BatchParams;
  /** 参数版本：任一参数变更即 +1 */
  paramVersion: number;
  readings: Reading[];
  anomalies: Anomaly[];
  review: ReviewStatus;
  reviewedAt?: number;
  /** 各异常类型已扫描到的最大分钟（增量检测用） */
  scannedUpTo: Record<AnomalyKind, number>;
  createdAt: number;
}

export type TimelineType =
  | "created"
  | "reading"
  | "detected"
  | "disposition"
  | "closed"
  | "voided"
  | "param"
  | "reviewed";

/** 时间线条目；异常解除后若被改参数失效，只给闭环条目打 void 标记，旧履历保留 */
export interface TimelineEvent {
  id: string;
  batchId: string;
  at: number;
  type: TimelineType;
  text: string;
  kind?: AnomalyKind;
  anomalyId?: string;
  /** 关联的闭环结论是否已失效 */
  void?: boolean;
  urgent?: boolean;
}

export interface AppState {
  batches: Batch[];
  events: TimelineEvent[];
  nextId: number;
}

export const anomalyKindLabel: Record<AnomalyKind, string> = {
  temperature: "温度偏离",
  ph: "酸碱值超限",
  foam: "泡沫超限",
};
