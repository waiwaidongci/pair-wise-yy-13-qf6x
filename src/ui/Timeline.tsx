import type { Batch } from "../domain/types";
import { selectTimeline } from "../domain/selectors";
import { formatClock } from "./format";

const DOT_CLASS: Record<string, string> = {
  raise: "dot-raise",
  action: "dot-action",
  close: "dot-close",
  void: "dot-void",
  review: "dot-review",
  flag: "dot-flag",
};

export function Timeline({ batch }: { batch: Batch }) {
  const items = selectTimeline(batch).slice().reverse();

  return (
    <section className="panel timeline">
      <div className="heading">
        <div>
          <p>履历留档</p>
          <h2>处置时间线</h2>
        </div>
        <span className="badge badge-muted">{items.length} 条事件</span>
      </div>

      {items.length === 0 ? (
        <div className="empty">暂无事件</div>
      ) : (
        <ol className="tl-list">
          {items.map((it) => (
            <li key={it.key} className={it.dimmed ? "tl-dimmed" : ""}>
              <span className={`tl-dot ${DOT_CLASS[it.tone]}`} />
              <div className="tl-body">
                <div className="tl-title">
                  <time>{formatClock(it.at)}</time>
                  {it.title}
                </div>
                {it.detail && <p>{it.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}

      <small className="tl-note">
        时间线与批次列表、处置队列由同一份状态派生；闭环后改参数导致的失效结论及作废评审均保留可查。
      </small>
    </section>
  );
}
