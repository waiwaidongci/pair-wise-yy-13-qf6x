import { useState } from "react";
import "./styles.css";
import { useStore } from "./ui/useStore";
import { BatchWorkspace } from "./ui/BatchWorkspace";
import { DispositionQueue } from "./ui/DispositionQueue";
import { Timeline } from "./ui/Timeline";

function App() {
  const { state, dispatch, resetToSeed, toast } = useStore();
  const [selectedId, setSelectedId] = useState(state.batches[0]?.id ?? "");

  const total = state.batches.length;
  const openCount = state.batches.reduce(
    (n, b) => n + b.anomalies.filter((a) => a.status === "open").length,
    0
  );
  const rushCount = state.batches.reduce(
    (n, b) =>
      n +
      b.anomalies.filter((a) => a.status === "open" && a.urgentAt !== undefined)
        .length,
    0
  );
  const releasedCount = state.batches.filter((b) => b.review === "approved").length;

  const metrics = [
    { label: "受控批次", value: total },
    { label: "待处置异常", value: openCount, alert: openCount > 0 },
    { label: "加急异常", value: rushCount },
    { label: "已放行批次", value: releasedCount },
  ];

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62012 · 源提示词7 · Port 62012</p>
        <h1>染整异常放行台</h1>
        <span>
          小样台读数自动判定：温度连续三分钟偏离两度、酸碱值超出 4.5–7.5 或泡沫超限即生成待处置记录，批次锁定不得评审。
          异常按发生顺序解除——温度项只解补时，酸碱项须两次复测合格，泡沫项须排泡后复测；加急可插队首但跳不过更早未闭环异常；
          闭环后改参数会使本项及后续结论失效，旧履历全程留档。
        </span>
      </section>

      <section className="metrics">
        {metrics.map((m) => (
          <article key={m.label} className={m.alert ? "alert" : ""}>
            <small>{m.label}</small>
            <strong>{m.value}</strong>
          </article>
        ))}
      </section>

      <DispositionQueue
        state={state}
        dispatch={dispatch}
        selectedBatchId={selectedId}
        onSelectBatch={setSelectedId}
      />

      <section className="workspace">
        <BatchWorkspace
          state={state}
          selectedId={selectedId}
          onSelect={setSelectedId}
          dispatch={dispatch}
        />
      </section>

      <Timeline state={state} />

      <footer className="page-foot">
        <span>状态计算（domain）· 持久化（persistence/localStorage）· 页面交互（ui）三层分离，刷新后列表、队列与时间线一致</span>
        <button className="ghost" onClick={resetToSeed}>
          重置演示数据
        </button>
      </footer>

      {toast && <div className={"toast toast-" + toast.kind}>{toast.text}</div>}
    </main>
  );
}

export default App;
