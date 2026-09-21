// 首次启动的演示数据：通过 reducer 正常派发动作生成，
// 与真实操作走完全相同的状态计算路径，保证履历结构自洽。
import { reducer, type Action, type Ctx } from "./reducer";
import type { AppState } from "./types";

const MIN = 60_000;

export function createSeedState(base: number): AppState {
  let counter = 0;
  const uid = () => `seed-${counter++}`;
  let now = base;
  const ctx = (): Ctx => ({ now, uid });

  let state: AppState = { version: 1, batches: [], selectedBatchId: null };
  const doAt = (atMin: number, action: Action) => {
    now = base + atMin * MIN;
    const result = reducer(state, action, ctx());
    if (result.error) throw new Error(`seed error @${atMin}: ${result.error}`);
    state = result.state;
  };

  // ① 正常批次：读数全部合格，可直接评审
  doAt(0, {
    type: "addBatch",
    name: "LAB-630A 棉府绸120g",
    fabric: "棉100%",
    orderNo: "SO-1101",
    targetTemp: 98,
    holdMinutes: 30,
  });
  doAt(2, { type: "addReading", batchId: state.batches[0].id, temperature: 98.2, ph: 6.7, foam: 18, at: base + 2 * MIN });
  doAt(3, { type: "addReading", batchId: state.batches[0].id, temperature: 97.9, ph: 6.8, foam: 20, at: base + 3 * MIN });
  doAt(4, { type: "addReading", batchId: state.batches[0].id, temperature: 98.0, ph: 6.6, foam: 19, at: base + 4 * MIN });

  // ② 三条异常并存：温度#1 → pH#2 → 泡沫#3；对泡沫加急（插队首但不可跳序）
  doAt(5, {
    type: "addBatch",
    name: "LAB-631B 涤纶针织",
    fabric: "涤纶100%",
    orderNo: "SO-1102",
    targetTemp: 130,
    holdMinutes: 30,
  });
  const b2 = state.batches[0].id;
  [0, 1.08, 2.16, 3.25].forEach((m) =>
    doAt(6 + m, {
      type: "addReading",
      batchId: b2,
      temperature: 127.8,
      ph: 6.9,
      foam: 30,
      at: base + (6 + m) * MIN,
    })
  );
  doAt(10, { type: "addReading", batchId: b2, temperature: 129.5, ph: 8.3, foam: 32, at: base + 10 * MIN });
  doAt(11, { type: "addReading", batchId: b2, temperature: 129.4, ph: 7.0, foam: 64, at: base + 11 * MIN });
  const foamInc = state.batches[0].incidents.find((i) => i.type === "foam")!;
  doAt(11.5, { type: "toggleUrgent", batchId: b2, incidentId: foamInc.id });

  // ③ 泡沫异常：已排泡，待复测
  doAt(12, {
    type: "addBatch",
    name: "LAB-632C 锦纶经编",
    fabric: "锦纶100%",
    orderNo: "SO-1103",
    targetTemp: 98,
    holdMinutes: 30,
  });
  const b3 = state.batches[0].id;
  doAt(13, { type: "addReading", batchId: b3, temperature: 96.5, ph: 6.8, foam: 61, at: base + 13 * MIN });
  const foam3 = state.batches[0].incidents.find((i) => i.type === "foam")!;
  doAt(14, { type: "defoam", batchId: b3, incidentId: foam3.id });

  // ④ 完整闭环 + 放行：温度补时 → pH 两次复测 → 排泡复测 → 评审放行
  doAt(15, {
    type: "addBatch",
    name: "LAB-633D 混纺斜纹",
    fabric: "棉65/涤35",
    orderNo: "SO-1104",
    targetTemp: 98,
    holdMinutes: 30,
  });
  const b4 = state.batches[0].id;
  [0, 1.08, 2.16, 3.25].forEach((m) =>
    doAt(16 + m, {
      type: "addReading",
      batchId: b4,
      temperature: 95.6,
      ph: 6.5,
      foam: 20,
      at: base + (16 + m) * MIN,
    })
  );
  const temp4 = state.batches[0].incidents.find((i) => i.type === "temperature")!;
  doAt(20, { type: "makeup", batchId: b4, incidentId: temp4.id, minutes: 30 });
  doAt(21, { type: "addReading", batchId: b4, temperature: 98.0, ph: 4.2, foam: 20, at: base + 21 * MIN });
  const ph4 = state.batches[0].incidents.find((i) => i.type === "ph")!;
  doAt(22, { type: "retest", batchId: b4, incidentId: ph4.id, value: 6.8 });
  doAt(23, { type: "retest", batchId: b4, incidentId: ph4.id, value: 7.0 });
  doAt(24, { type: "addReading", batchId: b4, temperature: 98.1, ph: 6.6, foam: 55, at: base + 24 * MIN });
  const foam4 = state.batches[0].incidents.find((i) => i.type === "foam")!;
  doAt(25, { type: "defoam", batchId: b4, incidentId: foam4.id });
  doAt(26, { type: "retest", batchId: b4, incidentId: foam4.id, value: 25 });
  doAt(27, { type: "review", batchId: b4, verdict: "released", note: "ΔE 0.7 符合客户标样，工艺复现正常" });

  // ⑤ 解除后改参数：温度#1、pH#2 已闭环，收紧目标温度后两项结论失效留档并重新触发温度异常
  doAt(28, {
    type: "addBatch",
    name: "LAB-634E 锦棉罗马布",
    fabric: "锦60/棉40",
    orderNo: "SO-1105",
    targetTemp: 95,
    holdMinutes: 30,
  });
  const b5 = state.batches[0].id;
  [0, 1.08, 2.16, 3.25].forEach((m) =>
    doAt(29 + m, {
      type: "addReading",
      batchId: b5,
      temperature: 92.5,
      ph: 6.5,
      foam: 22,
      at: base + (29 + m) * MIN,
    })
  );
  const temp5 = state.batches[0].incidents.find((i) => i.type === "temperature")!;
  doAt(33, { type: "makeup", batchId: b5, incidentId: temp5.id, minutes: 30 });
  doAt(34, { type: "addReading", batchId: b5, temperature: 93.4, ph: 8.4, foam: 22, at: base + 34 * MIN });
  const ph5 = state.batches[0].incidents.find((i) => i.type === "ph")!;
  doAt(35, { type: "retest", batchId: b5, incidentId: ph5.id, value: 6.9 });
  doAt(36, { type: "retest", batchId: b5, incidentId: ph5.id, value: 7.1 });
  doAt(37, { type: "review", batchId: b5, verdict: "released", note: "首件放行，待大货复核" });
  // 新读数在旧参数(95℃)下合格（偏离 1.8℃）
  [0, 1.08, 2.16, 3.25, 4.33].forEach((m) =>
    doAt(40 + m, {
      type: "addReading",
      batchId: b5,
      temperature: 93.2,
      ph: 6.6,
      foam: 22,
      at: base + (40 + m) * MIN,
    })
  );
  // 工艺收紧到 95.2℃ → 93.2 偏离恰为 2℃，连续超 3 分钟：旧结论失效并重新生成待处置记录
  doAt(46, { type: "updateParams", batchId: b5, patch: { targetTemp: 95.2 } });

  // 最新创建的批次在列表最前；默认展示异常最丰富的批次②
  const focus = state.batches.find((b) => b.orderNo === "SO-1102")!;
  state.selectedBatchId = focus.id;
  return state;
}
