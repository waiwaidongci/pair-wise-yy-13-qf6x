// 持久化层：只负责 AppState 与 localStorage 之间的读写，不做业务判定。
import type { AppState } from "../domain/types";

const STORAGE_KEY = "hxyfront-62012.exception-release.v1";

export function loadState(fallback: AppState): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed || !Array.isArray(parsed.batches) || !Array.isArray(parsed.events)) {
      return fallback;
    }
    return parsed;
  } catch {
    return fallback;
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储空间不足或隐私模式下静默失败，内存状态仍可用
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export const storageKey = STORAGE_KEY;
