// 交互层：React 与纯 reducer 之间的订阅桥，持久化由 persistence 层承担。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppState } from "../domain/types";
import { reduce, type Action } from "../domain/store";
import { loadState, saveState } from "../persistence/storage";
import { buildSeedState } from "../persistence/seed";

export interface DispatchResult {
  ok: boolean;
  message?: string;
}

export function useStore() {
  // 首屏从 localStorage 读取；读取不到再生成演示数据。刷新后列表与时间线一致。
  const [state, setState] = useState<AppState>(() =>
    loadState(buildSeedState())
  );
  const [toast, setToast] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    []
  );

  const showToast = useCallback((kind: "ok" | "err", text: string) => {
    setToast({ kind, text });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const dispatch = useCallback(
    (action: Action, successText?: string): DispatchResult => {
      const result = reduce(state, action);
      if (result.ok) {
        setState(result.state);
        if (successText) showToast("ok", successText);
      } else {
        showToast("err", result.message ?? "操作未生效");
      }
      return result;
    },
    [state, showToast]
  );

  const resetToSeed = useCallback(() => {
    const fresh = buildSeedState();
    saveState(fresh);
    setState(fresh);
    showToast("ok", "已重置为演示数据");
  }, [showToast]);

  return useMemo(
    () => ({ state, dispatch, resetToSeed, toast }),
    [state, dispatch, resetToSeed, toast]
  );
}
