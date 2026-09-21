import { useState } from "react";
import type { Batch } from "../domain/types";
import type { StationApi } from "../state/useStation";
import {
  activeReview,
  batchStatus,
  openIncidents,
  sortedReadings,
} from "../domain/selectors";
import {
  isFoamOverLimit,
  isPhOutOfRange,
  isTempDeviating,
} from "../domain/rules";
import { formatTime } from "./format";

export function MonitoringPanel({
  batch,
  api,
}: {
  batch: Batch;
  api: StationApi;
}) {
  const { dispatch } = api;
  const [sample, setSample] = useState({
    temperature: String(batch.params.targetTemp),
    ph: "6.5",
    foam: "20",
  });
  const [editParams, setEditParams] = useState(false);
  const [params, setParams] = useState({
    targetTemp: String(batch.params.targetTemp),
    holdMinutes: String(batch.params.holdMinutes),
    phLow: String(batch.params.phLimit[0]),
    phHigh: String(batch.params.phLimit[1]),
    foamLimit: String(batch.params.foamLimit),
  });
  const [reviewNote, setReviewNote] = useState("");

  const readings = sortedReadings(batch).slice(-10).reverse();
  const blocked = openIncidents(batch).length > 0;
  const review = activeReview(batch);

  const addSample = () =>
    dispatch({
      type: "addReading",
      batchId: batch.id,
      temperature: parseFloat(sample.temperature),
      ph: parseFloat(sample.ph),
      foam: parseFloat(sample.foam),
    });

  // 一键模拟连续 3 分钟偏离，便于现场演示温度判定（跨度 190 秒 > 180 秒）
  const simulateTempRun = () => {
    const t = batch.params.targetTemp - 2.3;
    for (let i = 0; i < 3; i++) {
      dispatch({
        type: "addReading",
        batchId: batch.id,
        temperature: t,
        ph: 6.5,
        foam: 20,
        at: Date.now() - (2 - i) * 95_000,
      });
    }
  };

  const saveParams = () => {
    const ok = dispatch({
      type: "updateParams",
      batchId: batch.id,
      patch: {
        targetTemp: parseFloat(params.targetTemp),
        holdMinutes: parseFloat(params.holdMinutes),
        phLimit: [parseFloat(params.phLow), parseFloat(params.phHigh)],
        foamLimit: parseFloat(params.foamLimit),
      },
    });
    if (ok) setEditParams(false);
  };

  return (
    <section className="panel monitor">
      <div className="heading">
        <div>
          <p>工艺监控</p>
          <h2>{batch.name}</h2>
        </div>
        <button className="mini" onClick={() => setEditParams((v) => !v)}>
          {editParams ? "取消修改" : "修改工艺参数"}
        </button>
      </div>

      <div className="param-strip">
        <span>
          目标温度 <b>{batch.params.targetTemp}℃</b>
        </span>
        <span>
          保温 <b>{batch.params.holdMinutes}min</b>
        </span>
        <span>
          pH 区间 <b>{batch.params.phLimit[0]}–{batch.params.phLimit[1]}</b>
        </span>
        <span>
          泡沫上限 <b>{batch.params.foamLimit}mm</b>
        </span>
        <span>
          订单 <b>{batch.orderNo}</b> · {batch.fabric}
        </span>
      </div>

      {editParams && (
        <div className="params-editor">
          <p className="warn-line">
            注意：异常解除后修改对应参数，会使本项及之后的闭环结论失效并打回重处，旧履历留档。
          </p>
          <div className="param-grid">
            <label>
              <span>目标温度 ℃</span>
              <input
                value={params.targetTemp}
                onChange={(e) => setParams({ ...params, targetTemp: e.target.value })}
              />
            </label>
            <label>
              <span>保温分钟</span>
              <input
                value={params.holdMinutes}
                onChange={(e) => setParams({ ...params, holdMinutes: e.target.value })}
              />
            </label>
            <label>
              <span>pH 下限</span>
              <input
                value={params.phLow}
                onChange={(e) => setParams({ ...params, phLow: e.target.value })}
              />
            </label>
            <label>
              <span>pH 上限</span>
              <input
                value={params.phHigh}
                onChange={(e) => setParams({ ...params, phHigh: e.target.value })}
              />
            </label>
            <label>
              <span>泡沫上限 mm</span>
              <input
                value={params.foamLimit}
                onChange={(e) => setParams({ ...params, foamLimit: e.target.value })}
              />
            </label>
          </div>
          <button className="primary" onClick={saveParams}>
            保存参数并重判当前状态
          </button>
        </div>
      )}

      <div className="sample-box">
        <h3>采样录入</h3>
        <div className="sample-form">
          <label>
            <span>温度 ℃</span>
            <input
              type="number"
              step="0.1"
              value={sample.temperature}
              onChange={(e) => setSample({ ...sample, temperature: e.target.value })}
            />
          </label>
          <label>
            <span>酸碱值 pH</span>
            <input
              type="number"
              step="0.1"
              value={sample.ph}
              onChange={(e) => setSample({ ...sample, ph: e.target.value })}
            />
          </label>
          <label>
            <span>泡沫 mm</span>
            <input
              type="number"
              value={sample.foam}
              onChange={(e) => setSample({ ...sample, foam: e.target.value })}
            />
          </label>
          <button className="primary" onClick={addSample}>
            提交采样
          </button>
          <button className="mini sim" onClick={simulateTempRun}>
            模拟连续3分钟偏离
          </button>
        </div>
        <small>
          触发口径：温度相对目标偏离 ≥2℃ 且连续 3 分钟；pH 超出
          {batch.params.phLimit[0]}–{batch.params.phLimit[1]}；泡沫 &gt;
          {batch.params.foamLimit}mm。触发即生成待处置记录。
        </small>
      </div>

      <div className="reading-table">
        <h3>最近读数（越限标红）</h3>
        {readings.length === 0 ? (
          <div className="empty">暂无采样</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>温度 ℃</th>
                <th>pH</th>
                <th>泡沫 mm</th>
              </tr>
            </thead>
            <tbody>
              {readings.map((r) => {
                const tBad = isTempDeviating(r.temperature, batch.params.targetTemp);
                const pBad = isPhOutOfRange(r.ph, batch.params.phLimit);
                const fBad = isFoamOverLimit(r.foam, batch.params.foamLimit);
                return (
                  <tr key={r.id}>
                    <td>{formatTime(r.at)}</td>
                    <td className={tBad ? "bad" : ""}>
                      {r.temperature}
                      {tBad && <i>偏离{Math.abs(r.temperature - batch.params.targetTemp).toFixed(1)}℃</i>}
                    </td>
                    <td className={pBad ? "bad" : ""}>{r.ph}</td>
                    <td className={fBad ? "bad" : ""}>{r.foam}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="review-box">
        <h3>批次评审</h3>
        {review && (
          <p className={`review-current review-${review.verdict}`}>
            当前结论：{review.verdict === "released" ? "放行" : "拒收"} ·{" "}
            {review.note}
          </p>
        )}
        {blocked ? (
          <div className="lock-notice">
            存在 {openIncidents(batch).length} 条待处置异常，批次锁定，
            <b>不得评审</b>。全部按序闭环后方可评审。
          </div>
        ) : (
          <div className="review-actions">
            <input
              placeholder="评审备注（色差、客户确认情况等）"
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
            />
            <button
              onClick={() =>
                dispatch({
                  type: "review",
                  batchId: batch.id,
                  verdict: "released",
                  note: reviewNote,
                })
              }
            >
              评审放行
            </button>
            <button
              className="reject"
              onClick={() =>
                dispatch({
                  type: "review",
                  batchId: batch.id,
                  verdict: "rejected",
                  note: reviewNote,
                })
              }
            >
              评审拒收
            </button>
          </div>
        )}
        {batchStatus(batch) === "normal" && (
          <small>无异常记录，可直接评审。</small>
        )}
      </div>
    </section>
  );
}
