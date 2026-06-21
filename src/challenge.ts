import type { Signal, ChallengeTarget, ChallengeResult, HintDifficulty, TunerState } from './types';
import type { SignalMatch } from './signal';
import { centerOfRange } from './signal';

const EASY_HINTS: Record<string, string> = {
  signal_01: '紧急频道 • 低频段 • 偏北方向',
  signal_02: '遗失磁带 • 中低频段 • 东南方向',
  signal_03: '静电低语 • 中高频段 • 正南方向',
  signal_04: 'VHS档案 • 高频段 • 西南方向'
};

const MEDIUM_HINTS: Record<string, string> = {
  signal_01: 'VHF 低段 • UHF 低段 • 小角度',
  signal_02: 'VHF 中低 • UHF 高段 • 东南',
  signal_03: 'VHF 中高 • UHF 中段 • 南向',
  signal_04: 'VHF 高段 • UHF 最高 • 西南向'
};

const HARD_HINTS: Record<string, string> = {
  signal_01: '低频 • 低温 • 警示',
  signal_02: '失落 • 回忆 • 寻找',
  signal_03: '数字 • 密码 • 7-4-9-2',
  signal_04: '1987 • 录像带 • 警告'
};

function generateHint(signal: Signal, difficulty: HintDifficulty): string {
  const hints = difficulty === 'easy' ? EASY_HINTS 
    : difficulty === 'medium' ? MEDIUM_HINTS 
    : HARD_HINTS;
  return hints[signal.id] || signal.description;
}

function getTimeLimit(difficulty: HintDifficulty): number {
  return difficulty === 'easy' ? 60000 
    : difficulty === 'medium' ? 45000 
    : 30000;
}

export class ChallengeSystem {
  private signals: Signal[];
  private usedSignals: Set<string> = new Set();
  private difficulty: HintDifficulty = 'medium';
  private currentMaxStrength: number = 0;
  private onCompleteCallback: ((result: ChallengeResult) => void) | null = null;
  private onFailCallback: (() => void) | null = null;

  constructor(signals: Signal[]) {
    this.signals = signals;
  }

  setDifficulty(difficulty: HintDifficulty): void {
    this.difficulty = difficulty;
  }

  setOnComplete(callback: (result: ChallengeResult) => void): void {
    this.onCompleteCallback = callback;
  }

  setOnFail(callback: () => void): void {
    this.onFailCallback = callback;
  }

  updateCurrentMatch(match: SignalMatch): void {
    if (match.strength > this.currentMaxStrength) {
      this.currentMaxStrength = match.strength;
    }
  }

  pickRandomTarget(): ChallengeTarget | null {
    const availableSignals = this.signals.filter(s => !this.usedSignals.has(s.id));
    if (availableSignals.length === 0) {
      this.usedSignals.clear();
      return this.pickRandomTarget();
    }
    
    const randomIndex = Math.floor(Math.random() * availableSignals.length);
    const signal = availableSignals[randomIndex];
    this.usedSignals.add(signal.id);
    
    return {
      signal,
      hint: generateHint(signal, this.difficulty),
      startTime: Date.now(),
      timeLimit: getTimeLimit(this.difficulty),
      isCompleted: false,
      isFailed: false
    };
  }

  getRemainingTime(target: ChallengeTarget): number {
    return Math.max(0, target.timeLimit - (Date.now() - target.startTime));
  }

  checkCompletion(target: ChallengeTarget, tuner: TunerState, match: SignalMatch): ChallengeResult | null {
    if (target.isCompleted || target.isFailed) return null;

    const timeTaken = Date.now() - target.startTime;
    
    if (timeTaken >= target.timeLimit) {
      target.isFailed = true;
      const result = this.buildResult(target, tuner, false);
      this.onFailCallback?.();
      return result;
    }

    if (match.signal?.id === target.signal.id && match.strength >= 0.7) {
      target.isCompleted = true;
      const result = this.buildResult(target, tuner, true);
      this.onCompleteCallback?.(result);
      return result;
    }

    return null;
  }

  private buildResult(target: ChallengeTarget, tuner: TunerState, success: boolean): ChallengeResult {
    const signal = target.signal;
    const timeTaken = Date.now() - target.startTime;
    
    const targetVhf = centerOfRange(signal.vhfRange as [number, number]);
    const targetUhf = centerOfRange(signal.uhfRange as [number, number]);
    const targetAntenna = centerOfRange(signal.antennaAngle as [number, number]);

    return {
      signal,
      timeTaken,
      maxStrength: this.currentMaxStrength,
      deviation: {
        vhf: Math.round(tuner.vhf - targetVhf),
        uhf: Math.round(tuner.uhf - targetUhf),
        antenna: Math.round(tuner.antenna - targetAntenna)
      },
      success
    };
  }

  resetMaxStrength(): void {
    this.currentMaxStrength = 0;
  }

  formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  reset(): void {
    this.usedSignals.clear();
    this.currentMaxStrength = 0;
  }
}
