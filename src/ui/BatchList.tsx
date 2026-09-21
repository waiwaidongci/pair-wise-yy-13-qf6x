import { useState } from "react";
import type { StationApi } from "../state/useStation";
import {
  batchStatus,
  BATCH_STATUS_LABEL,
  openIncidents,
} from "../domain/selectors";

const STATUS_CLASS: Record<string, string> = {
  blocked: "badge-danger",
  released: "badge-ok",
  rejected: "badge-warn",
  normal: "badge-muted",
};

export function BatchList({ api }: { api: StationApi }) {
  const { state, dispatch } = api;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    orderNo: "",
    fabric: "",
    targetTemp: "98",
    holdMinutes: "30",
  });

  const submit = () => {
    const ok = dispatch({
      type: "addBatch",
      name: form.name,
      orderNo: form.orderNo,
      fabric: form.fabric,
      targetTemp: parseFloat(form.targetTemp),
      holdMinutes: parseFloat(form.holdMinutes),
    });
    if (ok) {
      setForm({ name: "", orderNo: "", fabric: "", targetTemp: "98", holdMinutes: "30" });
      setOpen(false);
    }
  };

  return (
    <aside className="panel batch-list">
      <div className="heading">
        <div>
          <p>染整车间</p>
          <h2>小样批次</h2>
        </div>
        <button className="mini" onClick={() => setOpen((v) => !v)}>
          {open ? "收起" : "＋新批次"}
        </button>
      </div>

      {open && (
        <div className="new-batch">
          <input
            placeholder="批次/缸号（如 LAB-635F）"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <div className="two">
            <input
              placeholder="客户订单号"
              value={form.orderNo}
              onChange={(e) => setForm({ ...form, orderNo: e.target.value })}
            />
            <input
              placeholder="面料成分"
              value={form.fabric}
              onChange={(e) => setForm({ ...form, fabric: e.target.value })}
            />
          </div>
          <div className="two">
            <label>
              <span>目标温度 ℃</span>
              <input
                type="number"
                value={form.targetTemp}
                onChange={(e) => setForm({ ...form, targetTemp: e.target.value })}
              />
            </label>
            <label>
              <span>保温分钟</span>
              <input
                type="number"
                value={form.holdMinutes}
                onChange={(e) => setForm({ ...form, holdMinutes: e.target.value })}
              />
            </label>
          </div>
          <button className="primary" onClick={submit}>
            建档并选中
          </button>
        </div>
      )}

      <div className="batch-items">
        {state.batches.map((b) => {
          const status = batchStatus(b);
          const ops = openIncidents(b);
          const urgent = ops.filter((i) => i.urgent).length;
          const active = state.selectedBatchId === b.id;
          return (
            <button
              key={b.id}
              className={`batch-item${active ? " active" : ""}`}
              onClick={() => dispatch({ type: "selectBatch", id: b.id })}
            >
              <div className="batch-row">
                <b>{b.name}</b>
                <span className={`badge ${STATUS_CLASS[status]}`}>
                  {BATCH_STATUS_LABEL[status]}
                </span>
              </div>
              <div className="batch-meta">
                {b.orderNo} · {b.fabric}
              </div>
              <div className="batch-row">
                <span className="batch-flags">
                  {ops.length > 0 && (
                    <em className="flag-danger">待处置 {ops.length}</em>
                  )}
                  {urgent > 0 && <em className="flag-urgent">加急 {urgent}</em>}
                  {ops.length === 0 && <em className="flag-ok">无未闭环项</em>}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
