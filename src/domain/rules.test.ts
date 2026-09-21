// 域逻辑规则测试：直接运行 reducer/selectors（无 React、无 DOM）。
// 运行：npm test（用 esbuild 即时编译后由 node 执行）。
import assert from "node:assert/strict";
import { reducer, type Action, type Ctx } from "./reducer";
import type { AppState, Batch } from "./types";
import {
  batchStatus,
  disposalQueue,
  earliestOpen,
  evaluateTriggers,
  foamDefoamReady,
  isFifoBlocked,
  openIncidents,
  phProgress,
  selectTimeline,
  sortedIncidents,
} from "./selectors";
import { createSeedState } from "./seed";

const MIN = 60_000;
// 一段连续偏离的采样时刻表：间隔 66 秒，首尾跨度 198 秒（>180 秒），
// 第 4 个读数时满足"连续 3 分钟"。
const RUN = [0, 1.1, 2.2, 3.3];
let clock = 0;
let counter = 0;
// 处置动作的时刻独立单调递增（始终晚于采样），避免被读数锚点回退
let actionClock = 10_000 * MIN;
const ctxAt = (at: number): Ctx => ({
  now: at,
  uid: () => `u${counter++}`,
});

let state: AppState = { version: 1, batches: [], selectedBatchId: null };

function send(action: Action, at?: number) {
  clock = at ?? ++actionClock;
  const r = reducer(state, action, ctxAt(clock));
  if (r.error) throw new Error(`意外报错：${r.error}`);
  state = r.state;
  return state;
}

function sendExpectError(action: Action, at?: number): string {
  const r = reducer(state, action, ctxAt(at ?? ++actionClock));
  assert.ok(r.error, `动作本应被拦截：${action.type}`);
  assert.equal(r.state, state, "报错时状态不得变更");
  return r.error;
}

function firstBatch(): Batch {
  return state.batches[0];
}

function getInc(bid: string, id: string) {
  const b = state.batches.find((x) => x.id === bid)!;
  return b.incidents.find((i) => i.id === id)!;
}

function newBatch(targetTemp = 98) {
  send(
    {
      type: "addBatch",
      name: `TEST-${counter}`,
      fabric: "棉",
      orderNo: "SO-T",
      targetTemp,
      holdMinutes: 30,
    },
    ++clock
  );
  return firstBatch().id;
}

/** 以 t0 为起点安排一段读数 */
function sample(
  bid: string,
  at: number,
  temperature = 98,
  ph = 6.5,
  foam = 20
) {
  send({ type: "addReading", batchId: bid, temperature, ph, foam, at }, at);
}

function tempRun(bid: string, temp: number, t0: number) {
  RUN.forEach((m) => sample(bid, t0 + m * MIN, temp, 6.5, 20));
}

// ───────────────────────── 1. 温度触发口径 ─────────────────────────
{
  const bid = newBatch(98);
  const t0 = clock;
  // 前两次跨度 66 秒、第三次跨度 132 秒 → 均不触发
  sample(bid, t0 + 1 * MIN, 96);
  sample(bid, t0 + 2.1 * MIN, 96);
  assert.equal(openIncidents(firstBatch()).length, 0, "不足 3 分钟不应触发");
  sample(bid, t0 + 3.2 * MIN, 96);
  assert.equal(openIncidents(firstBatch()).length, 0, "跨度 132 秒仍不足 3 分钟");
  // 第四次使连续跨度达到 198 秒 → 触发（偏离恰好 2℃，按"两度"取闭区间）
  sample(bid, t0 + 4.3 * MIN, 96);
  const ops = openIncidents(firstBatch());
  assert.equal(ops.length, 1);
  assert.equal(ops[0].type, "temperature");
  assert.equal(ops[0].trigger.temperature, 96);

  // 偏离 1.9℃，即使连续超 3 分钟也不触发
  const bid2 = newBatch(98);
  tempRun(bid2, 96.1, clock);
  assert.equal(openIncidents(state.batches[0]).length, 0, "偏离 1.9℃ 不触发");
}

// ───────────────────────── 2. 采样间隔中断连续性 ─────────────────────────
{
  const bid = newBatch(100);
  const t0 = clock;
  sample(bid, t0 + 0.5 * MIN, 98);
  sample(bid, t0 + 1.5 * MIN, 98); // 与上点间隔恰 60 秒，连续
  // 与上一点间隔 150 秒（>90 秒），连续计时从头开始
  sample(bid, t0 + 4 * MIN, 98);
  sample(bid, t0 + 5 * MIN, 98);
  assert.equal(
    evaluateTriggers(firstBatch()).filter((h) => h.type === "temperature").length,
    0,
    "间隔过大不能主张连续 3 分钟"
  );
}

// ───────────────────────── 3. 补时只解温度项 & 评审锁定 ─────────────────────────
{
  const bid = newBatch(98);
  tempRun(bid, 96, clock);
  const inc = earliestOpen(firstBatch())!;

  sendExpectError(
    { type: "retest", batchId: bid, incidentId: inc.id, value: 98 },
    ++clock
  );
  // 补时 20 分钟不足 → 仍待处置，批次锁定不得评审
  send({ type: "makeup", batchId: bid, incidentId: inc.id, minutes: 20 });
  assert.equal(earliestOpen(firstBatch())?.status, "open");
  assert.equal(batchStatus(firstBatch()), "blocked");
  sendExpectError(
    { type: "review", batchId: bid, verdict: "released", note: "" },
    ++clock
  );
  // 再补 10 → 累计 30 闭环，方可评审放行
  send({ type: "makeup", batchId: bid, incidentId: inc.id, minutes: 10 });
  assert.equal(openIncidents(firstBatch()).length, 0);
  assert.equal(getInc(bid, inc.id).status, "closed");
  send({ type: "review", batchId: bid, verdict: "released", note: "ok" });
  assert.equal(batchStatus(firstBatch()), "released");
}

// ───────────────────────── 4. pH 两次复测、失败断链 ─────────────────────────
{
  const bid = newBatch(98);
  sample(bid, clock + 1 * MIN, 98, 8.2, 20);
  const inc = earliestOpen(firstBatch())!;
  assert.equal(inc.type, "ph");

  send({ type: "retest", batchId: bid, incidentId: inc.id, value: 6.8 });
  assert.equal(phProgress(getInc(bid, inc.id)), 1);
  assert.equal(getInc(bid, inc.id).status, "open", "一次合格不能闭环");
  // 第二次不合格 → 连续合格计数清零
  send({ type: "retest", batchId: bid, incidentId: inc.id, value: 7.9 });
  assert.equal(phProgress(getInc(bid, inc.id)), 0);
  // 重新连续两次合格 → 闭环
  send({ type: "retest", batchId: bid, incidentId: inc.id, value: 6.9 });
  send({ type: "retest", batchId: bid, incidentId: inc.id, value: 7.1 });
  assert.equal(getInc(bid, inc.id).status, "closed");
}

// ───────────────────────── 5. 泡沫：未排泡不能复测，失败须重新排泡 ─────────────────────────
{
  const bid = newBatch(98);
  sample(bid, clock + 1 * MIN, 98, 6.5, 60);
  const inc = earliestOpen(firstBatch())!;
  assert.equal(inc.type, "foam");
  sendExpectError(
    { type: "retest", batchId: bid, incidentId: inc.id, value: 20 },
    ++clock
  );
  send({ type: "defoam", batchId: bid, incidentId: inc.id });
  assert.equal(foamDefoamReady(getInc(bid, inc.id)), true);
  // 排泡后仍超限 → 打回，须重新排泡
  send({ type: "retest", batchId: bid, incidentId: inc.id, value: 58 });
  assert.equal(foamDefoamReady(getInc(bid, inc.id)), false);
  assert.equal(getInc(bid, inc.id).status, "open");
  send({ type: "defoam", batchId: bid, incidentId: inc.id });
  send({ type: "retest", batchId: bid, incidentId: inc.id, value: 22 });
  assert.equal(getInc(bid, inc.id).status, "closed");
}

// ───────────────────────── 6. 发生顺序解除 + 加急插队不跳序 ─────────────────────────
{
  const bid = newBatch(98);
  const t0 = clock;
  tempRun(bid, 96, t0); // #1 温度
  sample(bid, t0 + 5 * MIN, 98, 8.1, 20); // #2 pH
  sample(bid, t0 + 6 * MIN, 98, 6.5, 60); // #3 泡沫
  const incs = sortedIncidents(firstBatch());
  assert.deepEqual(
    incs.map((i) => [i.seq, i.type]),
    [
      [1, "temperature"],
      [2, "ph"],
      [3, "foam"],
    ]
  );

  // 对 #3 加急：队列展示排到首位
  send({ type: "toggleUrgent", batchId: bid, incidentId: incs[2].id });
  const queue = disposalQueue(firstBatch());
  assert.equal(queue[0].id, incs[2].id, "加急项在处置队列插队首");

  // 但闭环操作不能跳过更早的 #1 #2
  const blockedMsg = sendExpectError(
    { type: "defoam", batchId: bid, incidentId: incs[2].id },
    ++clock
  );
  assert.match(blockedMsg, /#1/);
  assert.equal(isFifoBlocked(firstBatch(), incs[2]), true);
  assert.equal(isFifoBlocked(firstBatch(), incs[0]), false);

  // 依次闭环：#1 补时 → #2 两次复测 → #3 排泡复测
  send({ type: "makeup", batchId: bid, incidentId: incs[0].id, minutes: 30 });
  send({ type: "retest", batchId: bid, incidentId: incs[1].id, value: 6.8 });
  send({ type: "retest", batchId: bid, incidentId: incs[1].id, value: 7.0 });
  assert.equal(isFifoBlocked(firstBatch(), incs[2]), false);
  send({ type: "defoam", batchId: bid, incidentId: incs[2].id });
  send({ type: "retest", batchId: bid, incidentId: incs[2].id, value: 20 });
  assert.equal(openIncidents(firstBatch()).length, 0);
}

// ───────────────────────── 7. 解除后改参数：本项及后续失效、履历留档、评审作废 ─────────────────────────
{
  const bid = newBatch(95);
  const t0 = clock;
  tempRun(bid, 92.8, t0); // #1 温度（偏离 2.2℃）
  const tempInc = sortedIncidents(firstBatch())[0];
  send({ type: "makeup", batchId: bid, incidentId: tempInc.id, minutes: 30 });
  sample(bid, t0 + 5 * MIN, 93.5, 8.1, 20); // #2 pH（93.5 偏离 1.5 不触发温度）
  const phInc = sortedIncidents(firstBatch()).find((i) => i.type === "ph")!;
  send({ type: "retest", batchId: bid, incidentId: phInc.id, value: 6.8 });
  send({ type: "retest", batchId: bid, incidentId: phInc.id, value: 7.0 });
  send({ type: "review", batchId: bid, verdict: "released", note: "首件" });
  assert.equal(batchStatus(firstBatch()), "released");

  // 改目标温度：#1 及其后（#2）已闭环结论失效
  const eventsBefore = tempInc.events.length;
  send({ type: "updateParams", batchId: bid, patch: { targetTemp: 95.2 } });
  assert.equal(getInc(bid, tempInc.id).status, "voided", "#1 温度结论失效");
  assert.equal(getInc(bid, phInc.id).status, "voided", "#2 作为后续项一并失效");
  assert.ok(getInc(bid, tempInc.id).invalidatedAt);
  assert.ok(getInc(bid, tempInc.id).events.length > eventsBefore, "失效事件写入旧履历");
  // 最新读数 93.5 对新目标 95.2 偏离 1.7℃，不立即重触发 → 回到可评审态
  // #2 pH 失效后，当前最新读数 pH 8.1 仍越限 → 按新口径重新生成 #3 待处置
  const reopenedPh = openIncidents(firstBatch());
  assert.equal(reopenedPh.length, 1);
  assert.equal(reopenedPh[0].seq, 3);
  assert.equal(reopenedPh[0].type, "ph");
  assert.equal(batchStatus(firstBatch()), "blocked");
  assert.equal(firstBatch().reviews[0].superseded, true, "旧评审作废留档");
  // 时间线仍含失效与作废记录
  const tl = selectTimeline(firstBatch());
  assert.ok(tl.some((t) => t.tone === "void"));
  assert.ok(tl.some((t) => t.tone === "review" && t.dimmed));
}

// ───────────────────────── 8. 改参数后当前状态立即重判 ─────────────────────────
{
  const bid = newBatch(98);
  tempRun(bid, 97.0, clock); // 偏离 1.0℃，连续再久也不触发
  assert.equal(openIncidents(firstBatch()).length, 0);
  // 目标提到 99 → 97 偏离恰为 2℃ 且连续超 3 分钟 → 立即生成待处置记录
  send({ type: "updateParams", batchId: bid, patch: { targetTemp: 99 } });
  const ops = openIncidents(firstBatch());
  assert.equal(ops.length, 1);
  assert.equal(ops[0].type, "temperature");
}

// ───────────────────────── 9. 失效后按新参数立即重触发，旧记录留档、序号顺延 ─────────────────────────
{
  const bid = newBatch(98);
  tempRun(bid, 96, clock);
  const t1 = earliestOpen(firstBatch())!;
  send({ type: "makeup", batchId: bid, incidentId: t1.id, minutes: 30 });
  send({ type: "updateParams", batchId: bid, patch: { targetTemp: 98.5 } });
  assert.equal(getInc(bid, t1.id).status, "voided");
  // 当前读数 96 对 98.5 偏离 2.5℃、连续 198 秒 → 立即重新生成 #2
  const ops = openIncidents(firstBatch());
  assert.equal(ops.length, 1);
  assert.equal(ops[0].seq, 2);
  assert.equal(sortedIncidents(firstBatch()).length, 2, "旧履历仍在");
}

// ───────────────────────── 10. 种子数据自洽 + 列表/时间线一致派生 ─────────────────────────
{
  const seed = createSeedState(Date.now());
  assert.equal(seed.batches.length, 5);
  for (const b of seed.batches) {
    // 每个 open 异常都在处置队列与时间线中；时间线条数 = 全部事件 + 评审
    const open = openIncidents(b);
    const queueIds = new Set(disposalQueue(b).map((i) => i.id));
    for (const o of open) assert.ok(queueIds.has(o.id));
    const expectedEvents = b.incidents.reduce((n, i) => n + i.events.length, 0);
    assert.equal(selectTimeline(b).length, expectedEvents + b.reviews.length);
  }
  // 批次⑤：参数改动后 #1/#2 失效留档、#3 温度重新待处置、评审作废
  const b5 = seed.batches.find((b) => b.orderNo === "SO-1105")!;
  assert.equal(b5.incidents.filter((i) => i.status === "voided").length, 2);
  const reopened = openIncidents(b5);
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0].type, "temperature");
  assert.equal(batchStatus(b5), "blocked");
  assert.ok(b5.reviews.every((r) => r.superseded));
  // 批次④：完整闭环并放行
  const b4 = seed.batches.find((b) => b.orderNo === "SO-1104")!;
  assert.equal(batchStatus(b4), "released");
  // 批次②：三条待处置，泡沫加急但队列 FIFO 闭环约束仍以温度为首
  const b2 = seed.batches.find((b) => b.orderNo === "SO-1102")!;
  assert.equal(openIncidents(b2).length, 3);
  assert.equal(disposalQueue(b2)[0].type, "foam");
  assert.equal(earliestOpen(b2)!.type, "temperature");
}

console.log("全部 10 组域规则测试通过 ✔");
