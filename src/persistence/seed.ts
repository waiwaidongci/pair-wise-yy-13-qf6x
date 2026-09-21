// 演示数据（首次加载时作为持久化兜底）
import type {
  Anomaly,
  AppState,
  Batch,
  BatchParams,
  Reading,
  TimelineEvent,
} from "../domain/types";

const DEFAULT_PARAMS: BatchParams = {
  targetTemp: 98,
  tempTolerance: 2,
  holdMinutes: 40,
  phMin: 4.5,
  phMax: 7.5,
  foamLimit: 20,
};

interface SeedReadingInput {
  minute: number;
  temp: number;
  ph: number;
  foam: number;
  agoMin: number;
}

export function buildSeedState(now: number = Date.now()): AppState {
  let nid = 1;
  const nidp = (p: string) => `${p}-${nid++}`;
  const events: TimelineEvent[] = [];
  const ev = (
    batchId: string,
    agoMin: number,
    type: TimelineEvent["type"],
    text: string,
    extra?: Partial<TimelineEvent>
  ) =>
    events.push({
      id: nidp("ev"),
      batchId,
      at: now - agoMin * 60_000,
      type,
      text,
      ...extra,
    });

  const mkReadings = (
    batchId: string,
    inputs: SeedReadingInput[]
  ): Reading[] =>
    inputs.map((i) => ({
      id: nidp("rd"),
      minute: i.minute,
      temp: i.temp,
      ph: i.ph,
      foam: i.foam,
      at: now - i.agoMin * 60_000,
    }));

  // ── 批次 1：温度异常已补时闭环，批次已放行（展示历史履历） ──
  const b1: Batch = {
    id: nidp("b"),
    code: "LAB-620A",
    fabric: "棉府绸 120g",
    recipe: "活性红 3BS 1.2% / 元明粉 40g/L",
    orderNo: "SO-20260901",
    params: { ...DEFAULT_PARAMS, holdMinutes: 48 },
    paramVersion: 2,
    readings: [],
    anomalies: [],
    review: "pending",
    scannedUpTo: { temperature: 0, ph: 0, foam: 0 },
    createdAt: now - 180 * 60_000,
  };
  b1.readings = mkReadings(b1.id, [
    { minute: 1, temp: 98.2, ph: 6.8, foam: 8, agoMin: 170 },
    { minute: 2, temp: 98.0, ph: 6.7, foam: 9, agoMin: 160 },
    { minute: 3, temp: 95.6, ph: 6.8, foam: 10, agoMin: 150 },
    { minute: 4, temp: 95.4, ph: 6.6, foam: 10, agoMin: 140 },
    { minute: 5, temp: 95.7, ph: 6.7, foam: 11, agoMin: 130 },
    { minute: 6, temp: 97.8, ph: 6.8, foam: 10, agoMin: 120 },
  ]);
  b1.scannedUpTo = { temperature: 5, ph: 6, foam: 6 };
  const a1: Anomaly = {
    id: nidp("an"),
    seq: 1,
    batchId: b1.id,
    kind: "temperature",
    detectedAt: now - 130 * 60_000,
    triggerReading: b1.readings[4],
    evidence: b1.readings.slice(2, 5),
    snapshot: {
      targetTemp: 98,
      deviationC: 2,
      deviationMinutes: 3,
      phMin: 4.5,
      phMax: 7.5,
      foamLimit: 20,
    },
    status: "closed",
    closedAt: now - 100 * 60_000,
    closedParamVersion: 1,
    actions: [
      {
        type: "makeup",
        at: now - 100 * 60_000,
        value: 5,
        pass: true,
        detail: "温度补时 5 分钟",
      },
    ],
    phPassCount: 0,
    defoamed: false,
  };
  b1.anomalies.push(a1);

  // ── 批次 2：温度异常未闭环（最早），pH 异常加急插到队首但被顺序门槛挡住 ──
  const b2: Batch = {
    id: nidp("b"),
    code: "LAB-621C",
    fabric: "涤纶针织 180g",
    recipe: "分散蓝 HGL 1.8% / 匀染剂 1g/L",
    orderNo: "SO-20260914",
    params: { ...DEFAULT_PARAMS, targetTemp: 130, tempTolerance: 2 },
    paramVersion: 1,
    readings: [],
    anomalies: [],
    review: "pending",
    scannedUpTo: { temperature: 0, ph: 0, foam: 0 },
    createdAt: now - 90 * 60_000,
  };
  b2.readings = mkReadings(b2.id, [
    { minute: 1, temp: 130.1, ph: 6.2, foam: 12, agoMin: 80 },
    { minute: 2, temp: 129.8, ph: 6.1, foam: 13, agoMin: 70 },
    { minute: 3, temp: 127.4, ph: 6.0, foam: 12, agoMin: 60 },
    { minute: 4, temp: 127.6, ph: 6.0, foam: 13, agoMin: 50 },
    { minute: 5, temp: 127.5, ph: 6.1, foam: 14, agoMin: 40 },
    { minute: 6, temp: 129.6, ph: 4.1, foam: 15, agoMin: 30 },
  ]);
  b2.scannedUpTo = { temperature: 5, ph: 6, foam: 6 };
  const a2t: Anomaly = {
    id: nidp("an"),
    seq: 1,
    batchId: b2.id,
    kind: "temperature",
    detectedAt: now - 40 * 60_000,
    triggerReading: b2.readings[4],
    evidence: b2.readings.slice(2, 5),
    snapshot: {
      targetTemp: 130,
      deviationC: 2,
      deviationMinutes: 3,
      phMin: 4.5,
      phMax: 7.5,
      foamLimit: 20,
    },
    status: "open",
    actions: [],
    phPassCount: 0,
    defoamed: false,
  };
  const a2p: Anomaly = {
    id: nidp("an"),
    seq: 2,
    batchId: b2.id,
    kind: "ph",
    detectedAt: now - 30 * 60_000,
    triggerReading: b2.readings[5],
    evidence: [b2.readings[5]],
    snapshot: {
      targetTemp: 130,
      deviationC: 2,
      deviationMinutes: 3,
      phMin: 4.5,
      phMax: 7.5,
      foamLimit: 20,
    },
    status: "open",
    actions: [
      {
        type: "ph_retest",
        at: now - 18 * 60_000,
        value: 6.4,
        pass: true,
        detail: "酸碱复测 pH 6.4（合格，1/2）",
      },
      {
        type: "rush",
        at: now - 12 * 60_000,
        detail: "标记加急，插入处置队列队首",
      },
    ],
    phPassCount: 1,
    defoamed: false,
    urgentAt: now - 12 * 60_000,
  };
  b2.anomalies.push(a2t, a2p);

  // ── 批次 3：泡沫超限，已排泡，等待排泡后复测 ──
  const b3: Batch = {
    id: nidp("b"),
    code: "LAB-624B",
    fabric: "涤棉混纺斜纹 220g",
    recipe: "分散/活性一浴 + 柔软剂 2%",
    orderNo: "SO-20260918",
    params: { ...DEFAULT_PARAMS, targetTemp: 100 },
    paramVersion: 1,
    readings: [],
    anomalies: [],
    review: "pending",
    scannedUpTo: { temperature: 0, ph: 0, foam: 0 },
    createdAt: now - 45 * 60_000,
  };
  b3.readings = mkReadings(b3.id, [
    { minute: 1, temp: 100.0, ph: 6.6, foam: 15, agoMin: 36 },
    { minute: 2, temp: 100.2, ph: 6.5, foam: 18, agoMin: 30 },
    { minute: 3, temp: 99.8, ph: 6.5, foam: 24, agoMin: 24 },
  ]);
  b3.scannedUpTo = { temperature: 3, ph: 3, foam: 3 };
  const a3f: Anomaly = {
    id: nidp("an"),
    seq: 1,
    batchId: b3.id,
    kind: "foam",
    detectedAt: now - 24 * 60_000,
    triggerReading: b3.readings[2],
    evidence: [b3.readings[2]],
    snapshot: {
      targetTemp: 100,
      deviationC: 2,
      deviationMinutes: 3,
      phMin: 4.5,
      phMax: 7.5,
      foamLimit: 20,
    },
    status: "open",
    actions: [
      {
        type: "foam_defoam",
        at: now - 10 * 60_000,
        pass: true,
        detail: "已排泡",
      },
    ],
    phPassCount: 0,
    defoamed: true,
  };
  b3.anomalies.push(a3f);

  const batches = [b1, b2, b3];

  // 时间线（按时间升序推入）
  ev(b1.id, 180, "created", `${b1.code} 小样批次建档（${b1.fabric}，订单 ${b1.orderNo}）`);
  [1, 2, 3, 4, 5, 6].forEach((m) => {
    const r = b1.readings[m - 1];
    ev(
      b1.id,
      170 - (m - 1) * 10,
      "reading",
      `${b1.code} ${m}分钟读数：${r.temp}℃ / pH ${r.ph} / 泡沫 ${r.foam}mm`
    );
  });
  ev(
    b1.id,
    130,
    "detected",
    `${b1.code} #1 温度项触发：3–5分钟连续偏离目标 98℃ ≥ 2℃，生成待处置记录，批次锁定不得评审`,
    { kind: "temperature", anomalyId: a1.id }
  );
  ev(b1.id, 115, "param", `${b1.code} 参数「保温时长」由 40 改为 45，版本 v1（与异常项无关，温度结论保持有效）`);
  ev(b1.id, 100, "disposition", `${b1.code} #1 温度项补时 5 分钟`, {
    kind: "temperature",
    anomalyId: a1.id,
  });
  ev(
    b1.id,
    100,
    "closed",
    `${b1.code} #1 温度偏离已闭环放行（参数版本 v1）`,
    { kind: "temperature", anomalyId: a1.id }
  );
  ev(b1.id, 95, "param", `${b1.code} 参数「保温时长」由 45 改为 48，版本 v2（与异常项无关，结论保持有效）`);
  ev(b1.id, 90, "reviewed", `${b1.code} 无未闭环异常，评审放行`);
  b1.review = "approved";
  b1.reviewedAt = now - 90 * 60_000;

  ev(b2.id, 90, "created", `${b2.code} 小样批次建档（${b2.fabric}，订单 ${b2.orderNo}）`);
  [1, 2, 3, 4, 5, 6].forEach((m) => {
    const r = b2.readings[m - 1];
    ev(
      b2.id,
      80 - (m - 1) * 10,
      "reading",
      `${b2.code} ${m}分钟读数：${r.temp}℃ / pH ${r.ph} / 泡沫 ${r.foam}mm`
    );
  });
  ev(
    b2.id,
    40,
    "detected",
    `${b2.code} #1 温度项触发：3–5分钟连续偏离目标 130℃ ≥ 2℃，生成待处置记录，批次锁定不得评审`,
    { kind: "temperature", anomalyId: a2t.id }
  );
  ev(
    b2.id,
    30,
    "detected",
    `${b2.code} #2 酸碱项触发：6分钟 pH 4.1 超出 [4.5, 7.5]，生成待处置记录，批次锁定不得评审`,
    { kind: "ph", anomalyId: a2p.id }
  );
  ev(b2.id, 18, "disposition", `${b2.code} #2 酸碱复测 pH 6.4：合格（1/2）`, {
    kind: "ph",
    anomalyId: a2p.id,
  });
  ev(b2.id, 12, "disposition", `${b2.code} #2 加急，插到处置队列队首（仍不得跳过更早未闭环异常）`, {
    kind: "ph",
    anomalyId: a2p.id,
    urgent: true,
  });

  ev(b3.id, 45, "created", `${b3.code} 小样批次建档（${b3.fabric}，订单 ${b3.orderNo}）`);
  [1, 2, 3].forEach((m) => {
    const r = b3.readings[m - 1];
    ev(
      b3.id,
      36 - (m - 1) * 6,
      "reading",
      `${b3.code} ${m}分钟读数：${r.temp}℃ / pH ${r.ph} / 泡沫 ${r.foam}mm`
    );
  });
  ev(
    b3.id,
    24,
    "detected",
    `${b3.code} #1 泡沫项触发：3分钟泡沫 24mm 超过上限 20mm，生成待处置记录，批次锁定不得评审`,
    { kind: "foam", anomalyId: a3f.id }
  );
  ev(b3.id, 10, "disposition", `${b3.code} #1 已执行排泡，等待排泡后复测`, {
    kind: "foam",
    anomalyId: a3f.id,
  });

  return { batches, events, nextId: nid };
}
