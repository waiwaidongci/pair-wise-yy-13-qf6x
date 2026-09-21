// 状态计算层：纯 reducer。所有业务规则的"写"路径只允许经过这里。
// 时间与 id 由调用方注入（ctx），保证本文件无副作用、可确定性测试。
import type {
  AnomalyType,
  AppState,
  Batch,
  Incident,
  IncidentEvent,
  ParamKey,
  Reading,
  ReviewVerdict,
} from "./types";
import {
  DEFAULT_FOAM_LIMIT,
  isFoamOverLimit,
  isPhOutOfRange,
  isTempDeviating,
  PARAM_LABEL,
  PARAM_TO_TYPE,
  PH_RANGE,
  REQUIRED_PASS,
  TYPE_LABEL,
} from "./rules";
import {
  earliestOpen,
  evaluateTriggers,
  foamDefoamReady,
  phProgress,
  sortedIncidents,
  sortedReadings,
  type TriggerHit,
} from "./selectors";

export interface Ctx {
  now: number;
  uid: () => string;
}

export interface ActionResult {
  state: AppState;
  error?: string;
}

export type Action =
  | { type: "selectBatch"; id: string | null }
  | {
      type: "addBatch";
      name: string;
      fabric: string;
      orderNo: string;
      targetTemp: number;
      holdMinutes: number;
    }
  | {
      type: "addReading";
      batchId: string;
      temperature: number;
      ph: number;
      foam: number;
      at?: number;
    }
  | { type: "toggleUrgent"; batchId: string; incidentId: string }
  | { type: "makeup"; batchId: string; incidentId: string; minutes: number }
  | { type: "defoam"; batchId: string; incidentId: string }
  | { type: "retest"; batchId: string; incidentId: string; value: number }
  | { type: "review"; batchId: string; verdict: ReviewVerdict; note: string }
  | {
      type: "updateParams";
      batchId: string;
      patch: Partial<{
        targetTemp: number;
        holdMinutes: number;
        phLimit: [number, number];
        foamLimit: number;
      }>;
    };

const MIN = 60_000;

function event(
  ctx: Ctx,
  kind: IncidentEvent["kind"],
  at: number,
  note?: string
): IncidentEvent {
  return { id: ctx.uid(), at, kind, note };
}

function nextSeq(batch: Batch): number {
  return batch.incidents.reduce((m, i) => Math.max(m, i.seq), 0) + 1;
}

function supersedeReview(batch: Batch): boolean {
  const active = [...batch.reviews].reverse().find((r) => !r.superseded);
  if (active) {
    active.superseded = true;
    return true;
  }
  return false;
}

function triggerSnapshot(hit: TriggerHit): Incident["trigger"] {
  if (hit.type === "temperature") return { temperature: hit.value };
  if (hit.type === "ph") return { ph: hit.value };
  return { foam: hit.value };
}

/**
 * 根据触发检测结果生成待处置记录。
 * 新温度异常生成时，批次补时累计清零（旧补时不能抵新偏离）。
 */
function raiseHits(batch: Batch, hits: TriggerHit[], ctx: Ctx): boolean {
  if (hits.length === 0) return false;
  for (const hit of hits) {
    const inc: Incident = {
      id: ctx.uid(),
      batchId: batch.id,
      seq: nextSeq(batch),
      type: hit.type,
      raisedAt: hit.at,
      status: "open",
      trigger: triggerSnapshot(hit),
      urgent: false,
      events: [event(ctx, "raised", hit.at)],
    };
    if (hit.type === "temperature") {
      batch.makeupMinutes = 0;
      inc.events[0].note = "温度连续 3 分钟偏离 ≥2℃；补时计数重新起算";
    }
    if (hit.type === "ph")
      inc.events[0].note = `酸碱值超出 ${batch.params.phLimit[0]}–${batch.params.phLimit[1]}`;
    if (hit.type === "foam")
      inc.events[0].note = `泡沫超过上限 ${batch.params.foamLimit}mm`;
    batch.incidents.push(inc);
  }
  supersedeReview(batch); // 批次存在待处置记录，既有评审结论作废留档
  return true;
}

/** 采样后：用全部读数重新检测应生成的异常 */
function detectFromReadings(batch: Batch, ctx: Ctx): void {
  raiseHits(batch, evaluateTriggers(batch), ctx);
}

/**
 * 改参数后：用新口径立即重新判定"当前"状态。
 * 只重判受本次变更影响的异常类型（被改参数对应类型，或本次结论被失效的类型）；
 * 未涉及的类型沿用原结论，不凭空生成记录。温度仍要求连续 3 分钟偏离。
 * 与采样触发不同：口径刚变，当前读数无论产生于闭环前/后，都直接按新口径判断。
 */
function reevaluateCurrent(
  batch: Batch,
  affected: ReadonlySet<AnomalyType>,
  ctx: Ctx
): void {
  const all = sortedReadings(batch);
  const latest = all.length ? all[all.length - 1] : undefined;
  if (!latest) return;
  const hits: TriggerHit[] = [];

  if (
    affected.has("temperature") &&
    !batch.incidents.some((i) => i.type === "temperature" && i.status === "open")
  ) {
    // 以最新读数为结尾反向扫描连续偏离窗口（间隔 > 90 秒即断）
    let runStart = latest.at;
    for (let k = all.length - 1; k >= 1; k--) {
      const cur = all[k];
      const prev = all[k - 1];
      if (
        !isTempDeviating(cur.temperature, batch.params.targetTemp) ||
        cur.at - prev.at > 90_000 ||
        !isTempDeviating(prev.temperature, batch.params.targetTemp)
      ) {
        break;
      }
      runStart = prev.at;
    }
    if (
      isTempDeviating(latest.temperature, batch.params.targetTemp) &&
      latest.at - runStart >= 3 * MIN - 1e-9
    ) {
      // raisedAt 取判定所依据的最新读数时刻，不能晚于读数自身
      hits.push({ type: "temperature", at: latest.at, value: latest.temperature });
    }
  }

  if (
    affected.has("ph") &&
    !batch.incidents.some((i) => i.type === "ph" && i.status === "open") &&
    isPhOutOfRange(latest.ph, batch.params.phLimit)
  ) {
    hits.push({ type: "ph", at: latest.at, value: latest.ph });
  }

  if (
    affected.has("foam") &&
    !batch.incidents.some((i) => i.type === "foam" && i.status === "open") &&
    isFoamOverLimit(latest.foam, batch.params.foamLimit)
  ) {
    hits.push({ type: "foam", at: latest.at, value: latest.foam });
  }

  raiseHits(batch, hits, ctx);
}

/** FIFO 守卫：只允许处置发生最早的未闭环异常（加急不改变该约束） */
function requireHead(
  batch: Batch,
  inc: Incident
): string | undefined {
  const head = earliestOpen(batch);
  if (!head) return "该异常已闭环";
  if (head.id !== inc.id)
    return `存在更早未闭环异常 #${head.seq}（${TYPE_LABEL[head.type]}），须按发生顺序先解除`;
}

function closeIncident(batch: Batch, inc: Incident, ctx: Ctx, note: string) {
  inc.status = "closed";
  inc.closedAt = ctx.now;
  inc.closeNote = note;
  inc.events.push(event(ctx, "closed", ctx.now, note));
}

// ───────────────────────── 各动作处理（直接改写 draft 副本） ─────────────────────────

function addReading(batch: Batch, action: Extract<Action, { type: "addReading" }>, ctx: Ctx) {
  const reading: Reading = {
    id: ctx.uid(),
    at: action.at ?? ctx.now,
    temperature: action.temperature,
    ph: action.ph,
    foam: action.foam,
  };
  batch.readings.push(reading);
  batch.readings.sort((a, b) => a.at - b.at);
  if (batch.readings.length > 240) batch.readings.splice(0, batch.readings.length - 240);
  detectFromReadings(batch, ctx);
}

function makeup(batch: Batch, inc: Incident, minutes: number, ctx: Ctx) {
  batch.makeupMinutes = Math.round((batch.makeupMinutes + minutes) * 100) / 100;
  inc.events.push(
    event(
      ctx,
      "timeMadeUp",
      ctx.now,
      `补时 +${minutes} 分钟（累计 ${batch.makeupMinutes}/${batch.params.holdMinutes}）`
    )
  );
  if (batch.makeupMinutes >= batch.params.holdMinutes - 1e-9) {
    closeIncident(
      batch,
      inc,
      ctx,
      `累计补时 ${batch.makeupMinutes} 分钟，满足 ${batch.params.holdMinutes} 分钟保温要求`
    );
  }
}

function retest(batch: Batch, inc: Incident, value: number, ctx: Ctx): string | undefined {
  if (inc.type === "temperature")
    return "温度异常只可通过补时解除，不能复测";

  if (inc.type === "foam" && !foamDefoamReady(inc))
    return "泡沫项须先排泡，再复测";

  if (inc.type === "ph") {
    const ok = !isPhOutOfRange(value, batch.params.phLimit);
    if (!ok) {
      inc.events.push(
        event(ctx, "retestFail", ctx.now, `复测 pH ${value} 不合格，连续合格计数清零`)
      );
      return;
    }
    inc.events.push(
      event(
        ctx,
        "retestPass",
        ctx.now,
        `复测 pH ${value} 合格（${phProgress(inc) + 1}/${REQUIRED_PASS.ph}）`
      )
    );
    if (phProgress(inc) >= REQUIRED_PASS.ph) {
      closeIncident(batch, inc, ctx, "两次复测均合格");
    }
    return;
  }

  // foam
  const ok = !isFoamOverLimit(value, batch.params.foamLimit);
  if (!ok) {
    inc.events.push(
      event(ctx, "retestFail", ctx.now, `排泡后复测泡沫 ${value}mm 仍超限，须重新排泡`)
    );
    return;
  }
  inc.events.push(
    event(ctx, "retestPass", ctx.now, `排泡后复测泡沫 ${value}mm 合格`)
  );
  closeIncident(batch, inc, ctx, "排泡复测合格");
}

/**
 * 解除后改参数：本项（该参数对应类型最早的已闭环异常）
 * 及其后所有已闭环异常结论失效、打回重处；履历与事件保留。
 */
function updateParams(
  batch: Batch,
  patch: Extract<Action, { type: "updateParams" }>["patch"],
  ctx: Ctx
) {
  const changedKeys = Object.keys(patch) as ParamKey[];
  if (changedKeys.length === 0) return;

  const thresholdSeqs: number[] = [];
  const changedLabels: string[] = [];
  const affected = new Set<AnomalyType>();
  for (const key of changedKeys) {
    changedLabels.push(PARAM_LABEL[key]);
    affected.add(PARAM_TO_TYPE[key]);
    const t = PARAM_TO_TYPE[key];
    const firstClosed = sortedIncidents(batch).find(
      (i) => i.type === t && i.status === "closed"
    );
    if (firstClosed) thresholdSeqs.push(firstClosed.seq);
  }

  if (thresholdSeqs.length > 0) {
    const k = Math.min(...thresholdSeqs);
    const reason = `工艺参数变更（${changedLabels.join("、")}），#${k} 及之后已闭环结论失效，打回重处`;
    for (const inc of sortedIncidents(batch)) {
      if (inc.seq >= k && inc.status === "closed") {
        inc.status = "voided";
        inc.invalidatedAt = ctx.now;
        inc.invalidateReason = reason;
        inc.events.push(event(ctx, "invalidated", ctx.now, reason));
        affected.add(inc.type); // 本次被失效的类型也要按新口径重判
        if (inc.type === "temperature") batch.makeupMinutes = 0;
      }
    }
  }

  if (patch.targetTemp !== undefined)
    batch.params.targetTemp = patch.targetTemp;
  if (patch.holdMinutes !== undefined)
    batch.params.holdMinutes = patch.holdMinutes;
  if (patch.phLimit !== undefined) batch.params.phLimit = patch.phLimit;
  if (patch.foamLimit !== undefined)
    batch.params.foamLimit = patch.foamLimit;

  // 参数口径已变，既有评审结论不再可信，作废留档
  supersedeReview(batch);
  reevaluateCurrent(batch, affected, ctx);
}

export function reducer(state: AppState, action: Action, ctx: Ctx): ActionResult {
  const next: AppState = structuredClone(state);

  switch (action.type) {
    case "selectBatch":
      next.selectedBatchId = action.id;
      return { state: next };

    case "addBatch": {
      if (!action.name.trim()) return { state, error: "请填写批次/缸号" };
      const id = `LAB-${Math.abs(hashString(action.name + ctx.now)).toString(36).slice(0, 4).toUpperCase()}`;
      const batch: Batch = {
        id,
        name: action.name.trim(),
        fabric: action.fabric.trim() || "未填写",
        orderNo: action.orderNo.trim() || "—",
        params: {
          targetTemp: action.targetTemp,
          holdMinutes: action.holdMinutes,
          phLimit: PH_RANGE,
          foamLimit: DEFAULT_FOAM_LIMIT,
        },
        makeupMinutes: 0,
        readings: [],
        incidents: [],
        reviews: [],
        createdAt: ctx.now,
      };
      next.batches.unshift(batch);
      next.selectedBatchId = batch.id;
      return { state: next };
    }

    case "addReading": {
      const batch = next.batches.find((b) => b.id === action.batchId);
      if (!batch) return { state, error: "批次不存在" };
      if ([action.temperature, action.ph, action.foam].some((n) => !Number.isFinite(n)))
        return { state, error: "请输入有效的采样数值" };
      addReading(batch, action, ctx);
      return { state: next };
    }

    case "toggleUrgent": {
      const batch = next.batches.find((b) => b.id === action.batchId);
      const inc = batch?.incidents.find((i) => i.id === action.incidentId);
      if (!batch || !inc) return { state, error: "记录不存在" };
      if (inc.status !== "open") return { state, error: "已闭环项不可加急" };
      inc.urgent = !inc.urgent;
      if (inc.urgent) inc.urgedAt = ctx.now;
      else inc.urgedAt = undefined;
      inc.events.push(
        event(ctx, inc.urgent ? "urged" : "deurged", ctx.now)
      );
      return { state: next };
    }

    case "makeup": {
      const batch = next.batches.find((b) => b.id === action.batchId);
      const inc = batch?.incidents.find((i) => i.id === action.incidentId);
      if (!batch || !inc) return { state, error: "记录不存在" };
      if (inc.type !== "temperature")
        return { state, error: "补时只能解除温度项" };
      const blocked = requireHead(batch, inc);
      if (blocked) return { state, error: blocked };
      if (!(action.minutes > 0) || action.minutes > 120)
        return { state, error: "补时时长需在 0–120 分钟之间" };
      makeup(batch, inc, action.minutes, ctx);
      return { state: next };
    }

    case "defoam": {
      const batch = next.batches.find((b) => b.id === action.batchId);
      const inc = batch?.incidents.find((i) => i.id === action.incidentId);
      if (!batch || !inc) return { state, error: "记录不存在" };
      if (inc.type !== "foam") return { state, error: "仅泡沫项需要排泡" };
      const blocked = requireHead(batch, inc);
      if (blocked) return { state, error: blocked };
      inc.events.push(event(ctx, "defoamed", ctx.now, "排泡完成，待复测"));
      return { state: next };
    }

    case "retest": {
      const batch = next.batches.find((b) => b.id === action.batchId);
      const inc = batch?.incidents.find((i) => i.id === action.incidentId);
      if (!batch || !inc) return { state, error: "记录不存在" };
      if (!Number.isFinite(action.value))
        return { state, error: "请输入复测数值" };
      const blocked = requireHead(batch, inc);
      if (blocked) return { state, error: blocked };
      const err = retest(batch, inc, action.value, ctx);
      return err ? { state, error: err } : { state: next };
    }

    case "review": {
      const batch = next.batches.find((b) => b.id === action.batchId);
      if (!batch) return { state, error: "批次不存在" };
      const open = batch.incidents.filter((i) => i.status === "open");
      if (open.length > 0)
        return {
          state,
          error: `仍有 ${open.length} 条待处置异常未闭环，批次不得评审`,
        };
      supersedeReview(batch);
      batch.reviews.push({
        at: ctx.now,
        verdict: action.verdict,
        note: action.note.trim(),
        superseded: false,
      });
      return { state: next };
    }

    case "updateParams": {
      const batch = next.batches.find((b) => b.id === action.batchId);
      if (!batch) return { state, error: "批次不存在" };
      const p = action.patch;
      if (
        (p.targetTemp !== undefined && !(p.targetTemp > 0 && p.targetTemp < 250)) ||
        (p.holdMinutes !== undefined && !(p.holdMinutes > 0 && p.holdMinutes <= 600)) ||
        (p.foamLimit !== undefined && !(p.foamLimit > 0 && p.foamLimit <= 500)) ||
        (p.phLimit !== undefined &&
          !(p.phLimit[0] < p.phLimit[1] && p.phLimit[0] >= 0 && p.phLimit[1] <= 14))
      )
        return { state, error: "参数超出合理范围" };
      updateParams(batch, p, ctx);
      return { state: next };
    }
  }
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}
