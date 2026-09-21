// 交互层桥接：把 React 事件翻译成域动作，并在每次状态计算后持久化。
// 组件不直接 import localStorage，也不自行修改业务状态。
import { useCallback, useMemo, useRef, useState } from "react";
import type { AppState } from "../domain/types";
import { reducer, type Action } from "../domain/reducer";
import { loadState, resetState, saveState } from "./persistence";

function makeUid(): () => string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return () => crypto.randomUUID();
  let n = 0;
  return () => `id-${Date.now().toString(36)}-${n++}`;
}

export interface StationApi {
  state: AppState;
  dispatch: (action: Action) => boolean;
  reset: () => void;
  toast: { kind: "error" | "info"; text: string } | null;
  clearToast: () => void;
}

export function useStation(): StationApi {
  const [state, setState] = useState<AppState>(() => loadState());
  const uidRef = useRef(makeUid());
  const [toast, setToast] = useState<StationApi["toast"]>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const flash = useCallback((t: StationApi["toast"]) => {
    setToast(t);
    window.clearTimeout(toastTimer.current);
    if (t) toastTimer.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  const dispatch = useCallback(
    (action: Action): boolean => {
      let ok = true;
      setState((prev) => {
        const result = reducer(prev, action, {
          now: Date.now(),
          uid: uidRef.current,
        });
        if (result.error) {
          ok = false;
          flash({ kind: "error", text: result.error });
          return prev;
        }
        saveState(result.state);
        return result.state;
      });
      return ok;
    },
    [flash]
  );

  const reset = useCallback(() => {
    setState(resetState());
    flash({ kind: "info", text: "已恢复演示数据" });
  }, [flash]);

  const clearToast = useCallback(() => setToast(null), []);

  return useMemo(
    () => ({ state, dispatch, reset, toast, clearToast }),
    [state, dispatch, reset, toast, clearToast]
  );
}
