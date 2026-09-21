import { useMemo, useState } from "react";
import type { AppState, TimelineType } from "../domain/types";
import { formatTime } from "./format";

const typeLabel: Record<TimelineType, string> = {
  created: "建档",
  reading: "读数",
  detected: "触发",
  disposition: "处置",
  closed: "闭环",
  voided: "失效",
  param: "改参",
  reviewed: "评审",
};

const dotClass: Record<TimelineType, string> = {
  created: "dot dot-created",
  reading: "dot dot-reading",
  detected: "dot dot-detected",
  disposition: "dot dot-disposition",
  closed: "dot dot-closed",
  voided: "dot dot-voided",
  param: "dot dot-param",
  reviewed: "dot dot-reviewed",
};

export function Timeline({ state }: { state: AppState }) {
  const [batchFilter, setBatchFilter] = useState<string>("all");

  const events = useMemo(() => {
    const list =
      batchFilter === "all"
        ? state.events
        : state.events.filter((e) => e.batchId === batchFilter);
    return [...list].sort((a, b) => b.at - a.at);
  }, [state.events, batchFilter]);

  return (
    <section className="panel timeline-panel">
      <div className="heading">
        <div>
          <p>履历留档</p>
          <h2>异常处置时间线</h2>
        </div>
        <select
          className="filter-select"
          value={batchFilter}
          onChange={(e) => setBatchFilter(e.target.value)}
        >
          <option value="all">全部批次</option>
          {state.batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code}
            </option>
          ))}
        </select>
      </div>
      <ol className="timeline">
        {events.map((e) => {
          const code =
            state.batches.find((b) => b.id === e.batchId)?.code ?? "—";
          return (
            <li key={e.id} className={e.void ? "is-void" : undefined}>
              <span className={dotClass[e.type]} />
              <span className="tl-time">{formatTime(e.at)}</span>
              <span className="tl-type">{typeLabel[e.type]}</span>
              <span className="tl-batch">{code}</span>
              <span
                className={
                  "tl-text" + (e.urgent ? " tl-urgent" : "") + (e.void ? " tl-void" : "")
                }
              >
                {e.text}
                {e.void && <em className="void-stamp">旧结论已失效</em>}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
