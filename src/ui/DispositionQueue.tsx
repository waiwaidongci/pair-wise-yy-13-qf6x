import { useState } from "react";
import type { Anomaly, AppState, Batch } from "../domain/types";
import {
  PH_RETEST_PASS_REQUIRED,
  isActionable,
  sortDispositionQueue,
} from "../domain/rules";
import type { DispatchResult } from "../ui/useStore";
import type { Action } from "../domain/store";
import { formatClock } from "./format";

interface Props {
  state: AppState;
  dispatch: (a: Action, okText?: string) => DispatchResult;
  selectedBatchId: string;
  onSelectBatch: (id: string) => void;
}

const kindBadge: Record<Anomaly["kind"], string> = {
  temperature: "tag tag-temp",
  ph: "tag tag-ph",
  foam: "tag tag-foam",
};

const kindText: Record<Anomaly["kind"], string> = {
  temperature: "温度项",
  ph: "酸碱项",
  foam: "泡沫项",
};

export function DispositionQueue({
  state,
  dispatch,
  selectedBatchId,
  onSelectBatch,
}: Props) {
  const open = state.batches.flatMap((b) =>
    b.anomalies
      .filter((a) => a.status === "open")
      .map((a) => ({ batch: b, anomaly: a }))
  );
  const queue = sortDispositionQueue(open.map((x) => x.anomaly));
  const byId = new Map(open.map((x) => [x.anomaly.id, x]));

  return (
    <section className="panel queue-panel">
      <div className="heading">
        <div>
          <p>异常处置</p>
          <h2>待处置队列</h2>
        </div>
        <span className="queue-tip">
          加急插队首 · 不得跳过更早未闭环异常 · 按发生顺序闭环
        </span>
      </div>
      {queue.length === 0 ? (
        <p className="empty">当前没有未闭环异常，批次均可正常评审。</p>
      ) : (
        <div className="queue-list">
          {queue.map((anomaly, idx) => {
            const ctx = byId.get(anomaly.id)!;
            return (
              <QueueCard
                key={anomaly.id}
                position={idx + 1}
                batch={ctx.batch}
                anomaly={anomaly}
                dispatch={dispatch}
                active={ctx.batch.id === selectedBatchId}
                onSelectBatch={onSelectBatch}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function QueueCard({
  position,
  batch,
  anomaly,
  dispatch,
  active,
  onSelectBatch,
}: {
  position: number;
  batch: Batch;
  anomaly: Anomaly;
  dispatch: (a: Action, okText?: string) => DispatchResult;
  active: boolean;
  onSelectBatch: (id: string) => void;
}) {
  const [tempMin, setTempMin] = useState("5");
  const [ph, setPh] = useState("");
  const [foam, setFoam] = useState("");
  const actionable = isActionable(batch, anomaly);

  const blockReason = !actionable
    ? `同批次 #${
        batch.anomalies.find(
          (a) => a.status === "open" && a.seq < anomaly.seq
        )?.seq
      } 更早且未闭环，先解除它`
    : null;

  return (
    <article
      className={
        "queue-card" + (active ? " is-active" : "") + (anomaly.urgentAt ? " is-rush" : "")
      }
    >
      <header className="queue-head">
        <div className="queue-title">
          <b className="queue-pos">{position}</b>
          <span className={kindBadge[anomaly.kind]}>
            {kindText[anomaly.kind]}
          </span>
          <button
            className="link-btn"
            onClick={() => onSelectBatch(batch.id)}
            title="在批次工作台定位"
          >
            {batch.code} #{anomaly.seq}
          </button>
          {anomaly.urgentAt !== undefined && (
            <span className="tag tag-rush">加急</span>
          )}
          {anomaly.voided && <span className="tag tag-void">旧结论失效重开</span>}
        </div>
        <div className="queue-meta">
          触发 {formatClock(anomaly.detectedAt)} ·{" "}
          {anomaly.evidence.map((r) => `${r.minute}′`).join("/")}
          {anomaly.urgentAt !== undefined &&
            ` · 加急 ${formatClock(anomaly.urgentAt)}`}
        </div>
      </header>

      <p className="queue-evidence">
        {anomaly.kind === "temperature" &&
          `实测 ${anomaly.evidence
            .map((r) => `${r.temp}℃`)
            .join(" / ")}，目标 ${anomaly.snapshot.targetTemp}℃，连续 ${anomaly.snapshot.deviationMinutes} 分钟偏离 ≥ ${anomaly.snapshot.deviationC}℃`}
        {anomaly.kind === "ph" &&
          `触发 pH ${anomaly.triggerReading.ph}，允许区间 [${anomaly.snapshot.phMin}, ${anomaly.snapshot.phMax}]`}
        {anomaly.kind === "foam" &&
          `触发泡沫 ${anomaly.triggerReading.foam}mm，上限 ${anomaly.snapshot.foamLimit}mm`}
      </p>

      {anomaly.actions.length > 0 && (
        <ul className="action-log">
          {anomaly.actions.map((act, i) => (
            <li key={i}>
              {act.detail} · {formatClock(act.at)}
            </li>
          ))}
        </ul>
      )}

      <div className="queue-actions">
        {anomaly.kind === "temperature" && (
          <>
            <label className="inline-input">
              补时(分)
              <input
                value={tempMin}
                disabled={!actionable}
                onChange={(e) => setTempMin(e.target.value)}
                inputMode="numeric"
              />
            </label>
            <button
              disabled={!actionable}
              className="primary"
              onClick={() =>
                dispatch(
                  {
                    type: "temperature_makeup",
                    batchId: batch.id,
                    anomalyId: anomaly.id,
                    minutes: Number(tempMin),
                  },
                  "温度补时完成，异常闭环"
                )
              }
            >
              补时解除
            </button>
          </>
        )}

        {anomaly.kind === "ph" && (
          <>
            <span className="progress">
              合格复测 {Math.min(anomaly.phPassCount, PH_RETEST_PASS_REQUIRED)}/
              {PH_RETEST_PASS_REQUIRED}
            </span>
            <label className="inline-input">
              pH
              <input
                value={ph}
                disabled={!actionable}
                placeholder="如 6.5"
                onChange={(e) => setPh(e.target.value)}
              />
            </label>
            <button
              disabled={!actionable}
              onClick={() => {
                const v = Number(ph);
                if (!Number.isFinite(v)) return;
                const r = dispatch(
                  {
                    type: "ph_retest",
                    batchId: batch.id,
                    anomalyId: anomaly.id,
                    ph: v,
                  },
                  v >= batch.params.phMin && v <= batch.params.phMax
                    ? anomaly.phPassCount + 1 >= PH_RETEST_PASS_REQUIRED
                      ? "两次复测均合格，酸碱项闭环"
                      : "复测合格，还需一次合格复测"
                    : "复测不合格，合格计数不累计"
                );
                if (r.ok) setPh("");
              }}
            >
              提交复测
            </button>
          </>
        )}

        {anomaly.kind === "foam" && (
          <>
            {!anomaly.defoamed ? (
              <button
                disabled={!actionable}
                className="primary"
                onClick={() =>
                  dispatch(
                    {
                      type: "foam_defoam",
                      batchId: batch.id,
                      anomalyId: anomaly.id,
                    },
                    "排泡完成，请复测"
                  )
                }
              >
                执行排泡
              </button>
            ) : (
              <>
                <span className="progress">已排泡，待复测</span>
                <label className="inline-input">
                  泡沫(mm)
                  <input
                    value={foam}
                    disabled={!actionable}
                    placeholder="如 12"
                    onChange={(e) => setFoam(e.target.value)}
                  />
                </label>
                <button
                  disabled={!actionable}
                  className="primary"
                  onClick={() => {
                    const v = Number(foam);
                    if (!Number.isFinite(v)) return;
                    const r = dispatch(
                      {
                        type: "foam_retest",
                        batchId: batch.id,
                        anomalyId: anomaly.id,
                        foam: v,
                      },
                      v <= batch.params.foamLimit
                        ? "排泡后复测合格，泡沫项闭环"
                        : "复测仍超限，继续处置"
                    );
                    if (r.ok) setFoam("");
                  }}
                >
                  排泡后复测
                </button>
              </>
            )}
          </>
        )}

        <button
          className="ghost"
          onClick={() =>
            dispatch(
              {
                type: "set_rush",
                batchId: batch.id,
                anomalyId: anomaly.id,
                rushed: anomaly.urgentAt === undefined,
              },
              anomaly.urgentAt === undefined
                ? "已加急，插到队首"
                : "已撤销加急"
            )
          }
        >
          {anomaly.urgentAt === undefined ? "加急插队首" : "撤销加急"}
        </button>
      </div>

      {blockReason && <p className="block-reason">⛔ {blockReason}</p>}
    </article>
  );
}
