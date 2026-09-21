import { useMemo, useState } from "react";
import type { AppState, Batch, BatchParams } from "../domain/types";
import { canReview, readingStatus } from "../domain/rules";
import type { Action } from "../domain/store";
import { paramLabel } from "../domain/store";
import type { DispatchResult } from "./useStore";
import { formatClock } from "./format";

interface Props {
  state: AppState;
  selectedId: string;
  onSelect: (id: string) => void;
  dispatch: (a: Action, okText?: string) => DispatchResult;
}

export function BatchWorkspace({ state, selectedId, onSelect, dispatch }: Props) {
  const batch = state.batches.find((b) => b.id === selectedId) ?? state.batches[0];

  return (
    <>
      <aside className="panel batch-list">
        <h2>小样批次</h2>
        <div className="batch-cards">
          {state.batches.map((b) => {
            const openCount = b.anomalies.filter((a) => a.status === "open").length;
            return (
              <button
                key={b.id}
                className={
                  "batch-card" + (b.id === batch.id ? " selected" : "")
                }
                onClick={() => onSelect(b.id)}
              >
                <div className="batch-card-top">
                  <b>{b.code}</b>
                  {b.review === "approved" ? (
                    <span className="tag tag-ok">已放行</span>
                  ) : openCount > 0 ? (
                    <span className="tag tag-lock">锁定 · {openCount}</span>
                  ) : (
                    <span className="tag tag-idle">可评审</span>
                  )}
                </div>
                <small>{b.fabric}</small>
                <small>订单 {b.orderNo}</small>
              </button>
            );
          })}
        </div>
        <div className="rules-card">
          <h3>放行规则</h3>
          <ul>
            <li>温度连续 3 分钟偏离目标 ≥ 2℃</li>
            <li>pH 超出 4.5 – 7.5 区间</li>
            <li>泡沫超过 {state.batches[0]?.params.foamLimit ?? 20}mm 上限</li>
          </ul>
          <p>命中任一即生成待处置记录，批次锁定不得评审。温度项只认补时，pH 须两次复测合格，泡沫须先排泡再复测。</p>
        </div>
      </aside>

      {batch && <BatchDetail key={batch.id} batch={batch} dispatch={dispatch} />}
    </>
  );
}

const PARAM_KEYS: (keyof BatchParams)[] = [
  "targetTemp",
  "tempTolerance",
  "holdMinutes",
  "phMin",
  "phMax",
  "foamLimit",
];

const PARAM_UNIT: Record<keyof BatchParams, string> = {
  targetTemp: "℃",
  tempTolerance: "℃",
  holdMinutes: "分",
  phMin: "",
  phMax: "",
  foamLimit: "mm",
};

function BatchDetail({
  batch,
  dispatch,
}: {
  batch: Batch;
  dispatch: (a: Action, okText?: string) => DispatchResult;
}) {
  const [minute, setMinute] = useState("");
  const [temp, setTemp] = useState("");
  const [ph, setPh] = useState("");
  const [foam, setFoam] = useState("");
  const [paramDrafts, setParamDrafts] = useState<Record<string, string>>({});

  const reviewable = canReview(batch);
  const openCount = batch.anomalies.filter((a) => a.status === "open").length;
  const readings = useMemo(
    () => [...batch.readings].sort((a, b) => a.minute - b.minute),
    [batch.readings]
  );

  const submitReading = () => {
    const m = Number(minute);
    const t = Number(temp);
    const pv = Number(ph);
    const f = Number(foam);
    if (![m, t, pv, f].every((v) => Number.isFinite(v))) return;
    const r = dispatch(
      { type: "add_reading", batchId: batch.id, minute: m, temp: t, ph: pv, foam: f },
      "读数已上报，规则已自动判定"
    );
    if (r.ok) {
      setMinute("");
      setTemp("");
      setPh("");
      setFoam("");
    }
  };

  return (
    <section className="panel detail-panel">
      <div className="heading">
        <div>
          <p>批次工作台</p>
          <h2>
            {batch.code}{" "}
            {batch.review === "approved" ? (
              <span className="tag tag-ok">已评审放行</span>
            ) : openCount > 0 ? (
              <span className="tag tag-lock">异常锁定 · 不得评审</span>
            ) : (
              <span className="tag tag-idle">可评审</span>
            )}
          </h2>
        </div>
        <button
          className="primary"
          disabled={!reviewable || batch.review === "approved"}
          onClick={() =>
            dispatch({ type: "review", batchId: batch.id }, "批次评审放行")
          }
        >
          {batch.review === "approved"
            ? "已放行"
            : reviewable
            ? "批次放行评审"
            : `${openCount} 项异常未闭环`}
        </button>
      </div>

      <div className="batch-meta">
        <span>{batch.fabric}</span>
        <span>配方：{batch.recipe}</span>
        <span>参数版本：v{batch.paramVersion}</span>
      </div>

      <div className="detail-grid">
        <div className="subpanel">
          <h3>上报读数</h3>
          <div className="reading-form">
            <label>
              <span>工艺分钟</span>
              <input
                value={minute}
                placeholder="如 7"
                inputMode="numeric"
                onChange={(e) => setMinute(e.target.value)}
              />
            </label>
            <label>
              <span>温度 ℃</span>
              <input
                value={temp}
                placeholder={`目标 ${batch.params.targetTemp}`}
                onChange={(e) => setTemp(e.target.value)}
              />
            </label>
            <label>
              <span>pH（4.5–7.5）</span>
              <input value={ph} placeholder="如 6.6" onChange={(e) => setPh(e.target.value)} />
            </label>
            <label>
              <span>泡沫 mm（≤{batch.params.foamLimit}）</span>
              <input
                value={foam}
                placeholder="如 12"
                onChange={(e) => setFoam(e.target.value)}
              />
            </label>
          </div>
          <button className="primary wide" onClick={submitReading}>
            上报并自动判定
          </button>
        </div>

        <div className="subpanel">
          <h3>工艺参数（修改将使相关旧闭环结论失效）</h3>
          <div className="param-grid">
            {PARAM_KEYS.map((key) => {
              const draft = paramDrafts[key] ?? "";
              return (
                <div key={key} className="param-row">
                  <span>
                    {paramLabel(key)}
                    {PARAM_UNIT[key] ? ` (${PARAM_UNIT[key]})` : ""}
                  </span>
                  <b>{batch.params[key]}</b>
                  <input
                    value={draft}
                    placeholder="新值"
                    onChange={(e) =>
                      setParamDrafts((d) => ({ ...d, [key]: e.target.value }))
                    }
                  />
                  <button
                    disabled={draft === "" || Number(draft) === batch.params[key]}
                    onClick={() => {
                      const v = Number(draft);
                      const r = dispatch(
                        {
                          type: "change_param",
                          batchId: batch.id,
                          key,
                          value: v,
                        },
                        "参数已更新，相关结论有效性已重算"
                      );
                      if (r.ok)
                        setParamDrafts((d) => ({ ...d, [key]: "" }));
                    }}
                  >
                    改参数
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="subpanel">
        <h3>读数记录（最近 {Math.min(readings.length, 8)} 条）</h3>
        <table className="reading-table">
          <thead>
            <tr>
              <th>分钟</th>
              <th>温度</th>
              <th>pH</th>
              <th>泡沫</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {readings.slice(-8).map((r) => {
              const bad = readingStatus(r, batch.params);
              return (
                <tr key={r.id}>
                  <td>{r.minute}′</td>
                  <td className={bad.temp ? "cell-bad" : ""}>
                    {r.temp}℃{bad.temp && " ⚠"}
                  </td>
                  <td className={bad.ph ? "cell-bad" : ""}>
                    {r.ph}{bad.ph && " ⚠"}
                  </td>
                  <td className={bad.foam ? "cell-bad" : ""}>
                    {r.foam}mm{bad.foam && " ⚠"}
                  </td>
                  <td className="cell-time">{formatClock(r.at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
