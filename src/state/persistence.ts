// 持久化层：只负责 AppState 的读写，不包含任何业务计算。
// 页面状态、列表、时间线均从同一份持久化状态恢复，保证刷新后一致。
import type { AppState } from "../domain/types";
import { createSeedState } from "../domain/seed";

const KEY = "dye-release-station:v1";

function sanitize(raw: unknown): raw is AppState {
  if (!raw || typeof raw !== "object") return false;
  const s = raw as Partial<AppState>;
  if (s.version !== 1 || !Array.isArray(s.batches)) return false;
  for (const b of s.batches) {
    if (
      !b ||
      typeof b.id !== "string" ||
      !Array.isArray(b.incidents) ||
      !Array.isArray(b.readings) ||
      !Array.isArray(b.reviews) ||
      !b.params
    )
      return false;
  }
  return true;
}

const hasStorage = (): boolean =>
  typeof globalThis !== "undefined" &&
  typeof (globalThis as { localStorage?: Storage }).localStorage !== "undefined";

export function loadState(): AppState {
  if (hasStorage()) {
    try {
      const text = localStorage.getItem(KEY);
      if (text) {
        const parsed: unknown = JSON.parse(text);
        if (sanitize(parsed)) return parsed;
        console.warn("存档结构不兼容，已回退到演示数据");
      }
    } catch (err) {
      console.warn("读取存档失败：", err);
    }
  }
  const seed = createSeedState(Date.now());
  saveState(seed);
  return seed;
}

export function saveState(state: AppState): void {
  if (!hasStorage()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("写入存档失败：", err);
  }
}

export function resetState(): AppState {
  const seed = createSeedState(Date.now());
  saveState(seed);
  return seed;
}

export function storageKey(): string {
  return KEY;
}
