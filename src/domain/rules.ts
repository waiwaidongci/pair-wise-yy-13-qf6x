// 放行判定规则常量 —— 全部阈值集中在此
import type { AnomalyType, ParamKey } from "./types";

/** 温度偏离目标值多少（含）即判异常，单位 ℃ */
export const TEMP_DEVIATION = 2;
/** 温度偏离须连续持续的分钟数 */
export const TEMP_DEVIATION_MINUTES = 3;
/** pH 合格区间（闭区间） */
export const PH_RANGE: [number, number] = [4.5, 7.5];
/** 默认泡沫上限 mm */
export const DEFAULT_FOAM_LIMIT = 50;

/** pH / 泡沫复测合格要求的连续合格次数（pH 须两次，泡沫为一次） */
export const REQUIRED_PASS: Record<AnomalyType, number> = {
  temperature: 0,
  ph: 2,
  foam: 1,
};

export const TYPE_LABEL: Record<AnomalyType, string> = {
  temperature: "温度",
  ph: "酸碱值",
  foam: "泡沫",
};

/** 各异常类别对应的工艺参数：改该参数会从对应类型的已闭环项起失效 */
export const PARAM_TO_TYPE: Record<ParamKey, AnomalyType> = {
  targetTemp: "temperature",
  holdMinutes: "temperature",
  phLimit: "ph",
  foamLimit: "foam",
};

export const PARAM_LABEL: Record<ParamKey, string> = {
  targetTemp: "目标温度",
  holdMinutes: "保温时长",
  phLimit: "酸碱区间",
  foamLimit: "泡沫上限",
};

/** 判断读数是否触发三类异常 */
export function isTempDeviating(temp: number, target: number): boolean {
  return Math.abs(temp - target) >= TEMP_DEVIATION - 1e-9;
}

export function isPhOutOfRange(ph: number, range: [number, number]): boolean {
  return ph < range[0] - 1e-9 || ph > range[1] + 1e-9;
}

export function isFoamOverLimit(foam: number, limit: number): boolean {
  return foam > limit + 1e-9;
}
