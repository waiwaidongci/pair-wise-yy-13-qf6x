// 领域层规则冒烟测试：npx tsx scripts/smoke.ts
// 不依赖 React/DOM，直接驱动纯 reducer 验证业务规则。
import { strict as assert } from "node:assert";
import { reduce, type Action } from "../src/domain/store";
import { buildSeedState } from "../src/persistence/seed";
import type { AppState } from "../src/domain/types";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function dispatch(state: AppState, action: Action) {
  const r = reduce(state, action);
  if (!r.ok) throw new Error(`action rejected: ${r.message}`);
  return r.state;
}

function freshBatch(state: AppState, code: string) {
  const b = state.batches.find((x) => x.code === code)!;
  return b;
}

// 构造一个干净批次的初始状态（取种子但只新建一个批次太重，直接用 LAB-624B 之外，这里手工构建）
function makeEmptyState(): AppState {
  const seed = buildSeedState(new Date("2026-09-21T08:00:00Z").getTime());
  const batchId = seed.batches[0].id;
  // 清空所有批次数据，留一个干净批次
  const b = seed.batches[0];
  b.code = "TEST-001";
  b.params = { targetTemp: 100, tempTolerance: 2, holdMinutes: 40, phMin: 4.5, phMax: 7.5, foamLimit: 20 };
  b.paramVersion = 1;
  b.readings = [];
  b.anomalies = [];
  b.review = "pending";
  b.reviewedAt = undefined;
  b.scannedUpTo = { temperature: 0, ph: 0, foam: 0 };
  seed.batches = [b];
  seed.events = [];
  return seed;
}

const rid = (state: AppState) => state.batches[0].id;

console.log("1) 温度连续三分钟偏离 2℃ 才触发");
{
  let s = makeEmptyState();
  const id = rid(s);
  const add = (m: number, t: number, ph = 6.5, foam = 10) => {
    s = dispatch(s, { type: "add_reading", batchId: id, minute: m, temp: t, ph, foam });
  };
  add(1, 99); // 偏 1，不算
  add(2, 97.8); // 偏 2.2
  assert.equal(freshBatch(s, "TEST-001").anomalies.length, 0, "仅 1 分钟偏离不触发");
  add(3, 97.5); // 第 2 分钟
  assert.equal(freshBatch(s, "TEST-001").anomalies.length, 0, "仅 2 分钟连续偏离不触发");
  add(4, 99); // 回到范围（偏 1），连续中断
  add(5, 97.6);
  assert.equal(freshBatch(s, "TEST-001").anomalies.length, 0, "中断后重新计数");
  add(6, 97.9);
  add(7, 97.7); // 5,6,7 连续 3 分钟
  const b = freshBatch(s, "TEST-001");
  assert.equal(b.anomalies.length, 1);
  assert.equal(b.anomalies[0].kind, "temperature");
  assert.equal(b.anomalies[0].status, "open");
  check("温度触发条件与连续性", () => {});
}

console.log("2) 批次有未闭环异常时不得评审");
{
  let s = makeEmptyState();
  const id = rid(s);
  s = dispatch(s, { type: "add_reading", batchId: id, minute: 1, temp: 97.5, ph: 6, foam: 5 });
  s = dispatch(s, { type: "add_reading", batchId: id, minute: 2, temp: 97.4, ph: 6, foam: 5 });
  const before = freshBatch(s, "TEST-001").anomalies.length;
  s = dispatch(s, { type: "add_reading", batchId: id, minute: 3, temp: 97.4, ph: 6, foam: 5 });
  assert.equal(before, 0);
  const r = reduce(s, { type: "review", batchId: id });
  assert.equal(r.ok, false);
  assert.match(r.message!, /未闭环/);
  check("未闭环异常锁定评审", () => {});
}

console.log("3) 温度项只认补时；补时后闭环、可评审");
{
  let s = makeEmptyState();
  const id = rid(s);
  for (const [m, t] of [[1, 97], [2, 97.2], [3, 97.1]] as const) {
    s = dispatch(s, { type: "add_reading", batchId: id, minute: m, temp: t, ph: 6, foam: 5 });
  }
  const anId = freshBatch(s, "TEST-001").anomalies[0].id;
  // pH 复测不能用于温度项
  const wrong = reduce(s, { type: "ph_retest", batchId: id, anomalyId: anId, ph: 6 });
  assert.equal(wrong.ok, false);
  // 补时 0 不行
  assert.equal(reduce(s, { type: "temperature_makeup", batchId: id, anomalyId: anId, minutes: 0 }).ok, false);
  s = dispatch(s, { type: "temperature_makeup", batchId: id, anomalyId: anId, minutes: 5 });
  const b = freshBatch(s, "TEST-001");
  assert.equal(b.anomalies[0].status, "closed");
  assert.equal(b.anomalies[0].closedParamVersion, 1);
  s = dispatch(s, { type: "review", batchId: id });
  assert.equal(freshBatch(s, "TEST-001").review, "approved");
  check("补时闭环温度项并放行", () => {});
}

console.log("4) pH 须两次复测合格，不合格不累计");
{
  let s = makeEmptyState();
  const id = rid(s);
  s = dispatch(s, { type: "add_reading", batchId: id, minute: 1, temp: 100, ph: 4.0, foam: 5 });
  const anId = freshBatch(s, "TEST-001").anomalies[0].id;
  assert.equal(freshBatch(s, "TEST-001").anomalies[0].kind, "ph");
  s = dispatch(s, { type: "ph_retest", batchId: id, anomalyId: anId, ph: 8.0 }); // 不合格
  assert.equal(freshBatch(s, "TEST-001").anomalies[0].phPassCount, 0);
  assert.equal(freshBatch(s, "TEST-001").anomalies[0].status, "open");
  s = dispatch(s, { type: "ph_retest", batchId: id, anomalyId: anId, ph: 6.0 }); // 1/2
  assert.equal(freshBatch(s, "TEST-001").anomalies[0].status, "open");
  s = dispatch(s, { type: "ph_retest", batchId: id, anomalyId: anId, ph: 7.2 }); // 2/2
  assert.equal(freshBatch(s, "TEST-001").anomalies[0].status, "closed");
  check("pH 两次复测合格才闭环", () => {});
}

console.log("5) 泡沫须先排泡再复测，未排泡复测被拒");
{
  let s = makeEmptyState();
  const id = rid(s);
  s = dispatch(s, { type: "add_reading", batchId: id, minute: 1, temp: 100, ph: 6, foam: 25 });
  const anId = freshBatch(s, "TEST-001").anomalies[0].id;
  assert.equal(freshBatch(s, "TEST-001").anomalies[0].kind, "foam");
  assert.equal(reduce(s, { type: "foam_retest", batchId: id, anomalyId: anId, foam: 10 }).ok, false);
  s = dispatch(s, { type: "foam_defoam", batchId: id, anomalyId: anId });
  assert.equal(reduce(s, { type: "foam_retest", batchId: id, anomalyId: anId, foam: 22 }).ok, true);
  assert.equal(freshBatch(s, "TEST-001").anomalies[0].status, "open", "复测仍超限保持打开");
  s = dispatch(s, { type: "foam_retest", batchId: id, anomalyId: anId, foam: 12 });
  assert.equal(freshBatch(s, "TEST-001").anomalies[0].status, "closed");
  check("排泡后复测合格闭环泡沫项", () => {});
}

console.log("6) 异常按发生顺序；加急插队首但不能跳过更早未闭环异常");
{
  let s = makeEmptyState();
  const id = rid(s);
  // 先触发温度（1,2,3 分钟偏离），再触发 pH（4 分钟超限）
  s = dispatch(s, { type: "add_reading", batchId: id, minute: 1, temp: 97, ph: 6, foam: 5 });
  s = dispatch(s, { type: "add_reading", batchId: id, minute: 2, temp: 97, ph: 6, foam: 5 });
  s = dispatch(s, { type: "add_reading", batchId: id, minute: 3, temp: 97, ph: 6, foam: 5 });
  s = dispatch(s, { type: "add_reading", batchId: id, minute: 4, temp: 100, ph: 4.2, foam: 5 });
  const b1 = freshBatch(s, "TEST-001");
  const tId = b1.anomalies.find((a) => a.kind === "temperature")!.id;
  const pId = b1.anomalies.find((a) => a.kind === "ph")!.id;
  assert.equal(b1.anomalies[0].seq, 1);
  assert.equal(b1.anomalies[1].seq, 2);
  // 加急 pH
  s = dispatch(s, { type: "set_rush", batchId: id, anomalyId: pId, rushed: true });
  // pH 仍不能复测（被温度阻塞）
  const blocked = reduce(s, { type: "ph_retest", batchId: id, anomalyId: pId, ph: 6 });
  assert.equal(blocked.ok, false);
  assert.match(blocked.message!, /更早/);
  // 温度补时后 pH 才能处置
  s = dispatch(s, { type: "temperature_makeup", batchId: id, anomalyId: tId, minutes: 3 });
  s = dispatch(s, { type: "ph_retest", batchId: id, anomalyId: pId, ph: 6 });
  s = dispatch(s, { type: "ph_retest", batchId: id, anomalyId: pId, ph: 6.5 });
  assert.equal(freshBatch(s, "TEST-001").anomalies.every((a) => a.status === "closed"), true);
  check("加急不越过顺序门槛", () => {});
}

console.log("7) 闭环后改相关参数：本项及后续结论失效重开，旧履历留档；无关参数不影响");
{
  let s = makeEmptyState();
  const id = rid(s);
  // 温度异常 + pH 异常均闭环并放行
  s = dispatch(s, { type: "add_reading", batchId: id, minute: 1, temp: 97, ph: 6, foam: 5 });
  s = dispatch(s, { type: "add_reading", batchId: id, minute: 2, temp: 97, ph: 6, foam: 5 });
  s = dispatch(s, { type: "add_reading", batchId: id, minute: 3, temp: 97, ph: 4.1, foam: 5 });
  const tId = freshBatch(s, "TEST-001").anomalies[0].id;
  const pId = freshBatch(s, "TEST-001").anomalies[1].id;
  s = dispatch(s, { type: "temperature_makeup", batchId: id, anomalyId: tId, minutes: 3 });
  s = dispatch(s, { type: "ph_retest", batchId: id, anomalyId: pId, ph: 6 });
  s = dispatch(s, { type: "ph_retest", batchId: id, anomalyId: pId, ph: 6.5 });
  s = dispatch(s, { type: "review", batchId: id });
  // 改无关参数（保温时长）：无失效
  s = dispatch(s, { type: "change_param", batchId: id, key: "holdMinutes", value: 50 });
  assert.equal(freshBatch(s, "TEST-001").anomalies.every((a) => a.status === "closed"), true);
  assert.equal(freshBatch(s, "TEST-001").review, "approved");
  // 改温度阈值：温度项（seq1）及其后所有闭环项（pH seq2）失效
  s = dispatch(s, { type: "change_param", batchId: id, key: "tempTolerance", value: 3 });
  const b = freshBatch(s, "TEST-001");
  assert.equal(b.anomalies.every((a) => a.status === "open"), true, "本项及后续全部重开");
  assert.equal(b.paramVersion, 3);
  assert.equal(b.review, "pending", "已放行批次撤回");
  // 旧履历保留：闭环事件仍在，但带 void 标记
  const closedEvents = s.events.filter((e) => e.type === "closed");
  assert.equal(closedEvents.length, 2);
  assert.equal(closedEvents.every((e) => e.void === true), true);
  assert.ok(s.events.some((e) => e.type === "voided"));
  // 失效重开后进度清零，温度需重新补时
  const reopenedT = b.anomalies.find((a) => a.kind === "temperature")!;
  assert.equal(reopenedT.actions.filter((a) => a.type === "makeup").length, 1, "旧补时履历仍在");
  check("改参失效、放行撤回、旧履历留档", () => {});
}

console.log("8) 同类型未闭环期间不重复生成异常；闭环后可再次检测");
{
  let s = makeEmptyState();
  const id = rid(s);
  s = dispatch(s, { type: "add_reading", batchId: id, minute: 1, temp: 97, ph: 6, foam: 5 });
  s = dispatch(s, { type: "add_reading", batchId: id, minute: 2, temp: 97, ph: 6, foam: 5 });
  s = dispatch(s, { type: "add_reading", batchId: id, minute: 3, temp: 97, ph: 6, foam: 5 });
  s = dispatch(s, { type: "add_reading", batchId: id, minute: 4, temp: 97, ph: 6, foam: 5 });
  assert.equal(freshBatch(s, "TEST-001").anomalies.filter((a) => a.kind === "temperature").length, 1);
  const tId = freshBatch(s, "TEST-001").anomalies[0].id;
  s = dispatch(s, { type: "temperature_makeup", batchId: id, anomalyId: tId, minutes: 5 });
  // 闭环后分钟 5,6,7 继续偏离 -> 再次触发
  s = dispatch(s, { type: "add_reading", batchId: id, minute: 5, temp: 97, ph: 6, foam: 5 });
  s = dispatch(s, { type: "add_reading", batchId: id, minute: 6, temp: 97, ph: 6, foam: 5 });
  s = dispatch(s, { type: "add_reading", batchId: id, minute: 7, temp: 97, ph: 6, foam: 5 });
  assert.equal(freshBatch(s, "TEST-001").anomalies.filter((a) => a.kind === "temperature").length, 2);
  check("同类型不重复生成且闭环后可再触发", () => {});
}

console.log("9) 种子数据自洽");
{
  const s = buildSeedState();
  assert.equal(s.batches.length, 3);
  // LAB-621C：pH 加急排在队首，但不可处置（温度 seq1 阻塞）
  const b2 = s.batches.find((b) => b.code === "LAB-621C")!;
  assert.equal(b2.anomalies.length, 2);
  const ph = b2.anomalies.find((a) => a.kind === "ph")!;
  assert.notEqual(ph.urgentAt, undefined);
  assert.equal(ph.phPassCount, 1);
  // LAB-620A 已放行
  assert.equal(s.batches.find((b) => b.code === "LAB-620A")!.review, "approved");
  // 时间线全部能关联到批次
  assert.ok(s.events.length > 10);
  assert.equal(s.events.every((e) => s.batches.some((b) => b.id === e.batchId)), true);
  check("种子场景（含加急被阻塞、已放行、排泡待复测）", () => {});
}

console.log(`\n全部 ${passed} 组规则冒烟通过 ✅`);
