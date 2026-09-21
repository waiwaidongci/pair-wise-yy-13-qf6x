import "./styles.css";
import { useStation } from "./state/useStation";
import { BatchList } from "./ui/BatchList";
import { DisposalPanel } from "./ui/DisposalPanel";
import { MonitoringPanel } from "./ui/MonitoringPanel";
import { Timeline } from "./ui/Timeline";
import { getBatch, selectMetrics } from "./domain/selectors";

function App() {
  const api = useStation();
  const { state, reset, toast, clearToast } = api;
  const batch = getBatch(state, state.selectedBatchId) ?? state.batches[0];
  const metrics = selectMetrics(state);

  return (
    <main className="app station-app">
      <section className="hero station-hero">
        <p>hxyfront-62012 · 染整车间 · 异常放行台</p>
        <h1>染整小样异常放行台</h1>
        <span>
          温度连续三分钟偏离两度、酸碱值超出 4.5–7.5 或泡沫超限时自动生成待处置记录并锁定评审；
          异常按发生顺序解除（补时只解温度、酸碱须两次复测合格、泡沫须排泡复测），
          加急插队首但不可跳序；解除后改参数使本项及后续结论失效，履历全程留档。
        </span>
        <div className="hero-actions">
          <button className="mini" onClick={reset}>
            恢复演示数据
          </button>
        </div>
      </section>

      <section className="metrics">
        {metrics.map((m) => (
          <article key={m.label}>
            <small>{m.label}</small>
            <strong>{m.value}</strong>
            <em>{m.hint}</em>
          </article>
        ))}
      </section>

      <section className="workspace station-layout">
        <BatchList api={api} />
        <div className="main-col">
          {batch ? (
            <>
              <DisposalPanel batch={batch} api={api} />
              <div className="two-col">
                <MonitoringPanel batch={batch} api={api} />
                <Timeline batch={batch} />
              </div>
            </>
          ) : (
            <section className="panel empty-panel">
              <div className="empty">请先新建一个小样批次</div>
            </section>
          )}
        </div>
      </section>

      {toast && (
        <div
          className={`toast toast-${toast.kind}`}
          onClick={clearToast}
          role="status"
        >
          {toast.kind === "error" ? "操作被规则拦截：" : ""}
          {toast.text}
        </div>
      )}
    </main>
  );
}

export default App;
