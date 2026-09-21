import { useState } from "react";
import type { Batch, Incident } from "../domain/types";
import type { StationApi } from "../state/useStation";
import {
  batchStatus,
  BATCH_STATUS_LABEL,
  disposalQueue,
  earliestOpen,
  foamDefoamReady,
  incidentHeadline,
  isFifoBlocked,
  phProgress,
  sortedIncidents,
} from "../domain/selectors";
import { REQUIRED_PASS, TYPE_LABEL } from "../domain/rules";
import { formatClock, formatTime } from "./format";

const TYPE_CLASS: Record<string, string> = {
  temperature: "type-temp",
  ph: "type-ph",
  foam: "type-foam",
};

function IncidentCard({
  batch,
  inc,
  api,
}: {
  batch: Batch;
  inc: Incident;
  api: StationApi;
}) {
  const { dispatch } = api;
  const blocked = isFifoBlocked(batch, inc);
  const head = earliestOpen(batch);
  const [minutes, setMinutes] = useState("15");
  const [value, setValue] = useState("");

  return (
    <article className={`incident ${inc.urgent ? "urgent" : ""}`}>
      <header className="incident-head">
        <span className={`type-tag ${TYPE_CLASS[inc.type]}`}>
          #{inc.seq} {TYPE_LABEL[inc.type]}
        </span>
        {inc.urgent && <span className="flag-urgent">加急</span>}
        <span className="incident-time">{formatClock(inc.raisedAt)}</span>
      </header>

      <p className="incident-trigger">{incidentHeadline(inc)}</p>

      {blocked && head && (
        <p className="block-hint">
          待更早异常 #{head.seq}（{TYPE_LABEL[head.type]}）闭环后处置
        </p>
      )}

      {!blocked && inc.type === "temperature" && (
        <div className="action-box">
          <div className="progress">
            补时进度：
            <b>
              {batch.makeupMinutes}/{batch.params.holdMinutes} 分钟
            </b>
            <div className="bar">
              <i
                style={{
                  width: `${Math.min(100, (batch.makeupMinutes / batch.params.holdMinutes) * 100)}%`,
                }}
              />
            </div>
          </div>
          <div className="inline-form">
            <input
              type="number"
              min="1"
              max="120"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              disabled={blocked}
            />
            <span>分钟</span>
            <button
              disabled={blocked}
              onClick={() =>
                dispatch({
                  type: "makeup",
                  batchId: batch.id,
                  incidentId: inc.id,
                  minutes: parseFloat(minutes),
                })
              }
            >
              补时
            </button>
          </div>
          <small>补时只解温度项，累计达到 {batch.params.holdMinutes} 分钟即闭环</small>
        </div>
      )}

      {!blocked && inc.type === "ph" && (
        <div className="action-box">
          <div className="progress">
            复测合格：
            <b>
              {phProgress(inc)}/{REQUIRED_PASS.ph}
            </b>
            <small>须连续两次合格；任一次不合格即清零重来</small>
          </div>
          <div className="inline-form">
            <input
              type="number"
              step="0.1"
              placeholder="复测 pH"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <button
              onClick={() =>
                dispatch({
                  type: "retest",
                  batchId: batch.id,
                  incidentId: inc.id,
                  value: parseFloat(value),
                })
              }
            >
              提交复测
            </button>
          </div>
        </div>
      )}

      {!blocked && inc.type === "foam" && (
        <div className="action-box">
          {foamDefoamReady(inc) ? (
            <>
              <p className="ready-hint">已排泡，等待复测结果</p>
              <div className="inline-form">
                <input
                  type="number"
                  placeholder="复测泡沫 mm"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
                <button
                  onClick={() =>
                    dispatch({
                      type: "retest",
                      batchId: batch.id,
                      incidentId: inc.id,
                      value: parseFloat(value),
                    })
                  }
                >
                  复测提交
                </button>
              </div>
            </>
          ) : (
            <button
              className="primary soft"
              onClick={() =>
                dispatch({ type: "defoam", batchId: batch.id, incidentId: inc.id })
              }
            >
              执行排泡
            </button>
          )}
          <small>泡沫项须先排泡、复测合格方可闭环；复测不合格须重新排泡</small>
        </div>
      )}

      <footer className="incident-foot">
        <button
          className="mini"
          onClick={() =>
            dispatch({ type: "toggleUrgent", batchId: batch.id, incidentId: inc.id })
          }
        >
          {inc.urgent ? "取消加急" : "标记加急"}
        </button>
      </footer>
    </article>
  );
}

export function DisposalPanel({
  batch,
  api,
}: {
  batch: Batch;
  api: StationApi;
}) {
  const queue = disposalQueue(batch);
  const archived = sortedIncidents(batch).filter((i) => i.status !== "open");

  return (
    <section className="panel disposal">
      <div className="heading">
        <div>
          <p>待处置记录</p>
          <h2>异常解除队列</h2>
        </div>
        <span className={`badge ${queue.length ? "badge-danger" : "badge-ok"}`}>
          {queue.length ? `${queue.length} 条待闭环` : "队列已清空"}
        </span>
      </div>

      <div className="rule-strip">
        异常按发生顺序解除；加急项在队列中插队首，但闭环时不能跳过更早未闭环异常。
        批次状态：<b>{BATCH_STATUS_LABEL[batchStatus(batch)]}</b>
      </div>

      {queue.length === 0 ? (
        <div className="empty">本批次没有待处置异常</div>
      ) : (
        <div className="incident-list">
          {queue.map((inc, idx) => (
            <div key={inc.id} className="queue-slot">
              <span className={`queue-pos ${inc.urgent ? "pos-urgent" : ""}`}>
                {idx + 1}
              </span>
              <IncidentCard batch={batch} inc={inc} api={api} />
            </div>
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div className="archive">
          <h3>历史记录（闭环 / 失效留档）</h3>
          {archived.map((inc) => (
            <div
              key={inc.id}
              className={`archive-row ${inc.status === "voided" ? "voided" : ""}`}
            >
              <span className={`type-tag ${TYPE_CLASS[inc.type]}`}>
                #{inc.seq} {TYPE_LABEL[inc.type]}
              </span>
              <span>{incidentHeadline(inc)}</span>
              {inc.status === "closed" ? (
                <em className="flag-ok">
                  已闭环 {inc.closedAt ? formatTime(inc.closedAt) : ""}
                  {inc.closeNote ? ` · ${inc.closeNote}` : ""}
                </em>
              ) : (
                <em className="flag-void">
                  已失效 · {inc.invalidateReason}
                </em>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
