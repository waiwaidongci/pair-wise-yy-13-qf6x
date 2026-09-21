// 状态计算层：纯 reducer，不触碰 React 与 localStorage。
import type {
  Anomaly,
  AnomalyKind,
  AppState,
  Batch,
  BatchParams,
  Reading,
  RuleSnapshot,
  TimelineEvent,
  TimelineType,
} from "./types";
import {
  PH_RETEST_PASS_REQUIRED,
  affectedByParamChange,
  isActionable,
  scanKind,
  snapshotOf,
} from "./rules";

export type Action =
  | {
      type: "add_reading";
      batchId: string;
      minute: number;
      temp: number;
      ph: number;
      foam: number;
    }
  | {
      type: "temperature_makeup";
      batchId: string;
      anomalyId: string;
      minutes: number;
    }
  | {
      type: "ph_retest";
      batchId: string;
      anomalyId: string;
      ph: number;
    }
  | {
      type: "foam_defoam";
      batchId: string;
      anomalyId: string;
    }
  | {
      type: "foam_retest";
      batchId: string;
      anomalyId: string;
      foam: number;
    }
  | {
      type: "set_rush";
      batchId: string;
      anomalyId: string;
      rushed: boolean;
    }
  | {
      type: "change_param";
      batchId: string;
      key: keyof BatchParams;
      value: number;
    }
  | { type: "review"; batchId: string }
  | { type: "reset"; state: AppState };

export interface ActionResult {
  state: AppState;
  ok: boolean;
  message?: string;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function uid(state: AppState, prefix: string): string {
  return `${prefix}-${state.nextId}`;
}

function addEvent(
  state: AppState,
  batchId: string,
  type: TimelineType,
  text: string,
  extra?: Partial<TimelineEvent>
) {
  state.events.push({
    id: uid(state, "ev"),
    batchId,
    at: Date.now(),
    type,
    text,
    ...extra,
  });
  state.nextId += 1;
}

function patchBatch(state: AppState, batchId: string): Batch {
  const b = state.batches.find((x) => x.id === batchId);
  if (!b) throw new Error("批次不存在");
  return b;
}

function findAnomaly(batch: Batch, anomalyId: string): Anomaly {
  const a = batch.anomalies.find((x) => x.id === anomalyId);
  if (!a) throw new Error("待处置记录不存在");
  return a;
}

function requireActionable(batch: Batch, anomaly: Anomaly) {
  if (anomaly.status !== "open") throw new Error("该异常已闭环");
  if (!isActionable(batch, anomaly))
    throw new Error("存在更早发生且未闭环的异常，不能插队处置");
}

/** 闭环异常：记录结论与参数版本，若批次已放行则同步撤回 */
function closeAnomaly(state: AppState, batch: Batch, anomaly: Anomaly) {
  anomaly.status = "closed";
  anomaly.closedAt = Date.now();
  anomaly.closedParamVersion = batch.paramVersion;
  // 闭环时刻之前的读数视为已处置，不计入下一轮连续窗口
  const maxMinute = batch.readings.reduce(
    (m, r) => Math.max(m, r.minute),
    batch.scannedUpTo[anomaly.kind]
  );
  batch.scannedUpTo[anomaly.kind] = maxMinute;
  if (batch.review === "approved") {
    batch.review = "pending";
    batch.reviewedAt = undefined;
    addEvent(
      state,
      batch.id,
      "reviewed",
      `新闭环结论产生，批次「${batch.code}」原放行结论撤回，需重新评审`
    );
  }
  addEvent(
    state,
    batch.id,
    "closed",
    `${batch.code} #${anomaly.seq} ${kindName(anomaly.kind)}已闭环放行（参数版本 v${batch.paramVersion}）`,
    { kind: anomaly.kind, anomalyId: anomaly.id }
  );
}

function kindName(kind: AnomalyKind): string {
  return kind === "temperature" ? "温度项" : kind === "ph" ? "酸碱项" : "泡沫项";
}

/**
 * 上报读数后执行增量检测：
 * 按 温度→酸碱→泡沫 顺序扫描，命中即生成待处置记录并推进扫描位置。
 * 一次读数最多每类各生成 1 条；同类型未闭环时不重复生成。
 */
function runDetection(state: AppState, batch: Batch) {
  // detectAll 在无新增时返回空；逐类扫描以便命中后推进游标
  (["temperature", "ph", "foam"] as AnomalyKind[]).forEach((kind) => {
    const hit = scanKind(batch, kind);
    if (!hit) return;
    const seq = batch.anomalies.length + 1;
    const anomaly: Anomaly = {
      id: uid(state, "an"),
      seq,
      batchId: batch.id,
      kind,
      detectedAt: Date.now(),
      triggerReading: clone(hit.trigger),
      evidence: clone(hit.evidence),
      snapshot: snapshotOf(batch.params) as RuleSnapshot,
      status: "open",
      actions: [],
      phPassCount: 0,
      defoamed: false,
    };
    state.nextId += 1;
    batch.anomalies.push(anomaly);
    batch.scannedUpTo[kind] = hit.trigger.minute;
    addEvent(
      state,
      batch.id,
      "detected",
      `${batch.code} #${seq} ${kindName(kind)}触发：${hit.reason}，生成待处置记录，批次锁定不得评审`,
      { kind, anomalyId: anomaly.id }
    );
  });
}

/** 修改参数：版本 +1，受影响的已闭环结论自最早一条起全部失效并重新打开，旧履历留档 */
function invalidateByParam(
  state: AppState,
  batch: Batch,
  key: keyof BatchParams
) {
  const ids = new Set(affectedByParamChange(batch, key));
  if (ids.size === 0) return;
  const now = Date.now();
  for (const a of batch.anomalies) {
    if (!ids.has(a.id)) continue;
    a.status = "open";
    a.voided = true;
    a.voidedAt = now;
    a.closedAt = undefined;
    a.closedParamVersion = undefined;
    // 失效后处置进度清零，按原规则重新处置
    a.phPassCount = 0;
    a.defoamed = false;
  }
  for (const ev of state.events) {
    if (ev.type === "closed" && ids.has(ev.anomalyId ?? "")) {
      ev.void = true;
    }
  }
  const kinds = [...ids]
    .map(
      (id) => batch.anomalies.find((a) => a.id === id)?.kind
    )
    .filter(Boolean) as AnomalyKind[];
  addEvent(
    state,
    batch.id,
    "voided",
    `${batch.code} 参数版本升至 v${batch.paramVersion}，${[...new Set(kinds)].map(kindName).join("、")}共 ${ids.size} 条旧闭环结论失效，重新进入待处置；旧履历已留档`
  );
  if (batch.review === "approved") {
    batch.review = "pending";
    batch.reviewedAt = undefined;
    addEvent(
      state,
      batch.id,
      "reviewed",
      `结论失效，批次「${batch.code}」原放行结论撤回，需重新评审`
    );
  }
}

export function reduce(prev: AppState, action: Action): ActionResult {
  if (action.type === "reset") {
    return { state: clone(action.state), ok: true };
  }
  const state = clone(prev);
  try {
    const batch = patchBatch(state, action.batchId);

    switch (action.type) {
      case "add_reading": {
        const reading: Reading = {
          id: uid(state, "rd"),
          minute: action.minute,
          temp: action.temp,
          ph: action.ph,
          foam: action.foam,
          at: Date.now(),
        };
        state.nextId += 1;
        if (batch.readings.some((r) => r.minute === reading.minute)) {
          throw new Error(`${reading.minute}分钟读数已存在`);
        }
        batch.readings.push(reading);
        addEvent(
          state,
          batch.id,
          "reading",
          `${batch.code} ${reading.minute}分钟读数：${reading.temp}℃ / pH ${reading.ph} / 泡沫 ${reading.foam}mm`
        );
        runDetection(state, batch);
        return { state, ok: true };
      }

      case "temperature_makeup": {
        const a = findAnomaly(batch, action.anomalyId);
        requireActionable(batch, a);
        if (a.kind !== "temperature")
          throw new Error("补时只能解除温度项");
        if (!(action.minutes > 0)) throw new Error("补时分钟数须大于 0");
        a.actions.push({
          type: "makeup",
          at: Date.now(),
          value: action.minutes,
          pass: true,
          detail: `温度补时 ${action.minutes} 分钟`,
        });
        addEvent(
          state,
          batch.id,
          "disposition",
          `${batch.code} #${a.seq} 温度项补时 ${action.minutes} 分钟`,
          { kind: "temperature", anomalyId: a.id }
        );
        closeAnomaly(state, batch, a);
        return { state, ok: true };
      }

      case "ph_retest": {
        const a = findAnomaly(batch, action.anomalyId);
        requireActionable(batch, a);
        if (a.kind !== "ph") throw new Error("复测操作仅适用于酸碱项");
        const pass = action.ph >= batch.params.phMin && action.ph <= batch.params.phMax;
        if (pass) a.phPassCount += 1;
        a.actions.push({
          type: "ph_retest",
          at: Date.now(),
          value: action.ph,
          pass,
          detail: `酸碱复测 pH ${action.ph}（${pass ? "合格" : "不合格"}，${Math.min(
            a.phPassCount,
            PH_RETEST_PASS_REQUIRED
          )}/${PH_RETEST_PASS_REQUIRED}）`,
        });
        addEvent(
          state,
          batch.id,
          "disposition",
          `${batch.code} #${a.seq} 酸碱复测 pH ${action.ph}：${
            pass ? "合格" : "不合格，合格计数不累计"
          }（${Math.min(a.phPassCount, PH_RETEST_PASS_REQUIRED)}/${
            PH_RETEST_PASS_REQUIRED
          }）`,
          { kind: "ph", anomalyId: a.id }
        );
        if (a.phPassCount >= PH_RETEST_PASS_REQUIRED) {
          closeAnomaly(state, batch, a);
        }
        return { state, ok: true };
      }

      case "foam_defoam": {
        const a = findAnomaly(batch, action.anomalyId);
        requireActionable(batch, a);
        if (a.kind !== "foam") throw new Error("排泡操作仅适用于泡沫项");
        if (a.defoamed) throw new Error("该异常已完成排泡");
        a.defoamed = true;
        a.actions.push({
          type: "foam_defoam",
          at: Date.now(),
          pass: true,
          detail: "已排泡",
        });
        addEvent(
          state,
          batch.id,
          "disposition",
          `${batch.code} #${a.seq} 已执行排泡，等待排泡后复测`,
          { kind: "foam", anomalyId: a.id }
        );
        return { state, ok: true };
      }

      case "foam_retest": {
        const a = findAnomaly(batch, action.anomalyId);
        requireActionable(batch, a);
        if (a.kind !== "foam") throw new Error("复测操作仅适用于泡沫项");
        if (!a.defoamed) throw new Error("泡沫项须先排泡，再复测");
        const pass = action.foam <= batch.params.foamLimit;
        a.actions.push({
          type: "foam_retest",
          at: Date.now(),
          value: action.foam,
          pass,
          detail: `排泡后复测 ${action.foam}mm（${pass ? "合格" : "仍超限"}）`,
        });
        addEvent(
          state,
          batch.id,
          "disposition",
          `${batch.code} #${a.seq} 排泡后复测 ${action.foam}mm：${
            pass ? "合格" : "仍超限，继续处置"
          }`,
          { kind: "foam", anomalyId: a.id }
        );
        if (pass) closeAnomaly(state, batch, a);
        return { state, ok: true };
      }

      case "set_rush": {
        const a = findAnomaly(batch, action.anomalyId);
        if (a.status !== "open") throw new Error("已闭环异常无需加急");
        if (action.rushed) {
          if (a.urgentAt !== undefined) throw new Error("该异常已加急");
          a.urgentAt = Date.now();
          a.actions.push({
            type: "rush",
            at: Date.now(),
            detail: "标记加急，插入处置队列队首",
          });
          addEvent(
            state,
            batch.id,
            "disposition",
            `${batch.code} #${a.seq} 加急，插到处置队列队首（仍不得跳过更早未闭环异常）`,
            { kind: a.kind, anomalyId: a.id, urgent: true }
          );
        } else {
          if (a.urgentAt === undefined) throw new Error("该异常未加急");
          a.urgentAt = undefined;
          a.actions.push({
            type: "unrush",
            at: Date.now(),
            detail: "撤销加急",
          });
          addEvent(
            state,
            batch.id,
            "disposition",
            `${batch.code} #${a.seq} 撤销加急，回到发生顺序`,
            { kind: a.kind, anomalyId: a.id }
          );
        }
        return { state, ok: true };
      }

      case "change_param": {
        const old = batch.params[action.key];
        if (!(typeof action.value === "number" && Number.isFinite(action.value)))
          throw new Error("参数值无效");
        if (action.value === old) throw new Error("参数未变化");
        batch.params[action.key] = action.value;
        batch.paramVersion += 1;
        addEvent(
          state,
          batch.id,
          "param",
          `${batch.code} 参数「${paramLabel(action.key)}」由 ${old} 改为 ${action.value}，版本 v${batch.paramVersion}`
        );
        invalidateByParam(state, batch, action.key);
        return { state, ok: true };
      }

      case "review": {
        if (batch.anomalies.some((a) => a.status === "open")) {
          throw new Error("仍存在未闭环异常，批次不得评审放行");
        }
        batch.review = "approved";
        batch.reviewedAt = Date.now();
        addEvent(
          state,
          batch.id,
          "reviewed",
          `${batch.code} 无未闭环异常，评审放行`
        );
        return { state, ok: true };
      }
    }
  } catch (err) {
    return { state: prev, ok: false, message: (err as Error).message };
  }
}

export function paramLabel(key: keyof BatchParams): string {
  return {
    targetTemp: "目标温度",
    tempTolerance: "温度偏离阈值",
    holdMinutes: "保温时长",
    phMin: "pH 下限",
    phMax: "pH 上限",
    foamLimit: "泡沫上限",
  }[key];
}
