import { CRTRenderer } from './renderer';
import { AudioManager } from './audio';
import { KnobController, type KnobParam } from './knobs';
import {
  findBestSignalMatch,
  getSignalColor,
  WeatherSystem,
  lerp,
  type SignalMatch
} from './signal';
import { ChallengeSystem } from './challenge';
import type { Signal, SignalsData, TunerState, WeatherOffset, ChallengeState, ChallengeResult, HintDifficulty } from './types';

class Game {
  private renderer: CRTRenderer | null = null;
  private audioManager: AudioManager;
  private knobController: KnobController | null = null;
  private weatherSystem: WeatherSystem | null = null;

  private signals: Signal[] = [];
  private tuner: TunerState = { vhf: 100, uhf: 400, antenna: 180 };
  private weatherOffset: WeatherOffset = { vhfShift: 0, uhfShift: 0, antennaShift: 0 };
  private currentMatch: SignalMatch = { signal: null, strength: 0, vhfMatch: 0, uhfMatch: 0, antennaMatch: 0 };

  private smoothedStrength: number = 0;
  private smoothedDistortion: number = 1;
  private smoothedStatic: number = 1;
  private smoothedVhsTint: number = 0;
  private smoothedSignalColor: [number, number, number] = [0.08, 0.08, 0.1];

  private foundSignals: Set<string> = new Set();
  private signalOverlayActive: boolean = false;
  private binaryStream: string = '';
  private binaryTimer: number = 0;

  private challengeSystem: ChallengeSystem | null = null;
  private challengeState: ChallengeState = {
    isActive: false,
    currentTarget: null,
    results: [],
    round: 0,
    totalRounds: 3
  };

  private elements: {
    signalFill: HTMLElement;
    signalOverlay: HTMLElement;
    signalName: HTMLElement;
    signalDescription: HTMLElement;
    binaryStream: HTMLElement;
    foundCount: HTMLElement;
    audioToggle: HTMLButtonElement;
    challengePanel: HTMLElement;
    challengeToggle: HTMLButtonElement;
    difficultySelect: HTMLSelectElement;
    startChallengeBtn: HTMLButtonElement;
    hintText: HTMLElement;
    timerText: HTMLElement;
    roundText: HTMLElement;
    thresholdText: HTMLElement;
    resultPanel: HTMLElement;
    resultTime: HTMLElement;
    resultStrength: HTMLElement;
    resultDeviation: HTMLElement;
    resultStatus: HTMLElement;
    nextRoundBtn: HTMLButtonElement;
    closeResultBtn: HTMLButtonElement;
  };

  constructor() {
    this.audioManager = new AudioManager();
    this.elements = this.getElements();
  }

  private getElements() {
    const get = (id: string): HTMLElement => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`Element not found: ${id}`);
      return el;
    };

    return {
      signalFill: get('signalFill'),
      signalOverlay: get('signalOverlay'),
      signalName: get('signalOverlay').querySelector('.signal-name') as HTMLElement,
      signalDescription: get('signalOverlay').querySelector('.signal-description') as HTMLElement,
      binaryStream: get('signalOverlay').querySelector('.binary-stream') as HTMLElement,
      foundCount: get('foundCount'),
      audioToggle: get('audioToggle') as HTMLButtonElement,
      challengePanel: get('challengePanel'),
      challengeToggle: get('challengeToggle') as HTMLButtonElement,
      difficultySelect: get('difficultySelect') as HTMLSelectElement,
      startChallengeBtn: get('startChallengeBtn') as HTMLButtonElement,
      hintText: get('hintText'),
      timerText: get('timerText'),
      roundText: get('roundText'),
      thresholdText: get('thresholdText'),
      resultPanel: get('resultPanel'),
      resultTime: get('resultTime'),
      resultStrength: get('resultStrength'),
      resultDeviation: get('resultDeviation'),
      resultStatus: get('resultStatus'),
      nextRoundBtn: get('nextRoundBtn') as HTMLButtonElement,
      closeResultBtn: get('closeResultBtn') as HTMLButtonElement
    };
  }

  async init(): Promise<void> {
    try {
      const signalsData = await this.loadSignals();
      this.signals = signalsData.signals;
      this.weatherSystem = new WeatherSystem(signalsData.weatherConfig);
      this.challengeSystem = new ChallengeSystem(this.signals);
      this.setupChallengeEvents();
    } catch (e) {
      console.error('Failed to load signals:', e);
      return;
    }

    const canvas = document.getElementById('glCanvas') as HTMLCanvasElement;
    this.renderer = new CRTRenderer(canvas);

    this.knobController = new KnobController([
      {
        param: 'vhf',
        element: document.getElementById('vhfKnob')!,
        valueElement: document.getElementById('vhfValue')!,
        min: 0,
        max: 250,
        initialValue: 100,
        sensitivity: 0.8
      },
      {
        param: 'uhf',
        element: document.getElementById('uhfKnob')!,
        valueElement: document.getElementById('uhfValue')!,
        min: 100,
        max: 800,
        initialValue: 400,
        sensitivity: 1.2
      },
      {
        param: 'antenna',
        element: document.getElementById('antennaKnob')!,
        valueElement: document.getElementById('antennaValue')!,
        min: 0,
        max: 360,
        initialValue: 180,
        sensitivity: 1.5
      }
    ], (param: KnobParam, value: number) => {
      this.tuner[param] = value;
    });

    this.elements.audioToggle.addEventListener('click', async () => {
      if (!this.audioManager['isInitialized']) {
        await this.audioManager.init();
      }
      this.audioManager.resume();
      const enabled = this.audioManager.toggle();
      this.elements.audioToggle.classList.toggle('active', enabled);
    });

    window.addEventListener('resize', () => {
      this.renderer?.resize();
    });

    void this.knobController;

    this.animate();
  }

  private async loadSignals(): Promise<SignalsData> {
    const response = await fetch('/signals.json');
    if (!response.ok) throw new Error('Failed to load signals');
    return response.json();
  }

  private updateSignalMatch(): void {
    this.currentMatch = findBestSignalMatch(this.tuner, this.signals, this.weatherOffset);
    if (this.challengeSystem && this.challengeState.isActive) {
      this.challengeSystem.setWeatherOffset(this.weatherOffset);
      this.challengeSystem.updateCurrentMatch(this.currentMatch);
    }
  }

  private setupChallengeEvents(): void {
    this.elements.challengeToggle.addEventListener('click', () => {
      const isActive = this.elements.challengePanel.classList.toggle('active');
      this.elements.challengeToggle.classList.toggle('active', isActive);
      if (!isActive) {
        this.endChallenge();
      }
    });

    this.elements.difficultySelect.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      this.challengeSystem?.setDifficulty(target.value as HintDifficulty);
    });

    this.elements.startChallengeBtn.addEventListener('click', () => {
      this.startChallenge();
    });

    this.elements.nextRoundBtn.addEventListener('click', () => {
      this.startNextRound();
    });

    this.elements.closeResultBtn.addEventListener('click', () => {
      this.elements.resultPanel.classList.remove('active');
      if (this.challengeState.round >= this.challengeState.totalRounds) {
        this.endChallenge();
      }
    });
  }

  private startChallenge(): void {
    this.challengeState = {
      isActive: true,
      currentTarget: null,
      results: [],
      round: 0,
      totalRounds: 3
    };
    this.challengeSystem?.reset();
    this.elements.startChallengeBtn.style.display = 'none';
    this.startNextRound();
  }

  private startNextRound(): void {
    this.elements.resultPanel.classList.remove('active');
    
    if (this.challengeState.round >= this.challengeState.totalRounds) {
      this.showFinalSummary();
      return;
    }

    this.challengeState.round++;
    const target = this.challengeSystem?.pickRandomTarget();
    if (!target) return;

    this.challengeState.currentTarget = target;
    this.challengeSystem?.resetMaxStrength();

    this.elements.hintText.textContent = target.hint;
    this.elements.roundText.textContent = `Round ${this.challengeState.round} / ${this.challengeState.totalRounds}`;
    
    const maxReachable = this.challengeSystem?.getMaxReachable(target.signal) ?? 0;
    const threshold = this.challengeSystem?.getCurrentThreshold(target.signal) ?? 0;
    this.elements.thresholdText.textContent = `${(threshold * 100).toFixed(0)}% (理论最大: ${(maxReachable * 100).toFixed(0)}%)`;
    
    this.elements.timerText.classList.remove('warning');
    this.updateChallengeTimer();
  }

  private updateChallengeTimer(): void {
    if (!this.challengeState.isActive || !this.challengeState.currentTarget) return;

    const remaining = this.challengeSystem?.getRemainingTime(this.challengeState.currentTarget) ?? 0;
    this.elements.timerText.textContent = this.challengeSystem?.formatTime(remaining) ?? '0:00';

    if (remaining <= 10000) {
      this.elements.timerText.classList.add('warning');
    }

    if (remaining <= 0) {
      this.checkChallengeCompletion();
    }
  }

  private checkChallengeCompletion(): void {
    if (!this.challengeState.isActive || !this.challengeState.currentTarget || !this.challengeSystem) return;

    const result = this.challengeSystem.checkCompletion(
      this.challengeState.currentTarget,
      this.tuner,
      this.currentMatch
    );

    if (result) {
      this.challengeState.results.push(result);
      this.showResult(result);
    }
  }

  private showResult(result: ChallengeResult): void {
    this.elements.resultStatus.textContent = result.success ? '✓ CHANNEL LOCKED' : '✗ TIME OUT';
    this.elements.resultStatus.className = `result-status ${result.success ? 'success' : 'fail'}`;
    this.elements.resultTime.textContent = `用时: ${this.challengeSystem?.formatTime(result.timeTaken) ?? '0:00'}`;
    
    const maxReachable = this.challengeSystem?.getMaxReachable(result.signal) ?? 0;
    const threshold = this.challengeSystem?.getCurrentThreshold(result.signal) ?? 0;
    this.elements.resultStrength.textContent = `最高强度: ${(result.maxStrength * 100).toFixed(1)}% (阈值: ${(threshold * 100).toFixed(1)}% / 理论最大: ${(maxReachable * 100).toFixed(1)}%)`;
    
    const devSign = (n: number) => n > 0 ? `+${n}` : n.toString();
    this.elements.resultDeviation.textContent = `偏差: VHF ${devSign(result.deviation.vhf)} | UHF ${devSign(result.deviation.uhf)} | ANT ${devSign(result.deviation.antenna)}°`;

    if (this.challengeState.round >= this.challengeState.totalRounds) {
      this.elements.nextRoundBtn.textContent = '查看总结';
    } else {
      this.elements.nextRoundBtn.textContent = '下一轮';
    }

    this.elements.resultPanel.classList.add('active');
  }

  private showFinalSummary(): void {
    const successCount = this.challengeState.results.filter(r => r.success).length;
    const avgTime = this.challengeState.results.reduce((sum, r) => sum + r.timeTaken, 0) / this.challengeState.results.length;
    const avgStrength = this.challengeState.results.reduce((sum, r) => sum + r.maxStrength, 0) / this.challengeState.results.length;

    this.elements.resultStatus.textContent = `挑战完成! ${successCount}/${this.challengeState.totalRounds} 成功`;
    this.elements.resultStatus.className = 'result-status success';
    this.elements.resultTime.textContent = `平均用时: ${this.challengeSystem?.formatTime(avgTime) ?? '0:00'}`;
    this.elements.resultStrength.textContent = `平均最高强度: ${(avgStrength * 100).toFixed(1)}%`;
    this.elements.resultDeviation.textContent = '继续努力，成为调台大师!';
    this.elements.nextRoundBtn.style.display = 'none';
    this.elements.resultPanel.classList.add('active');
  }

  private endChallenge(): void {
    this.challengeState.isActive = false;
    this.challengeState.currentTarget = null;
    this.elements.hintText.textContent = '点击开始挑战';
    this.elements.timerText.textContent = '0:00';
    this.elements.roundText.textContent = '';
    this.elements.thresholdText.textContent = '—';
    this.elements.startChallengeBtn.style.display = 'block';
    this.elements.nextRoundBtn.style.display = 'block';
    this.elements.resultPanel.classList.remove('active');
  }

  private updateSmoothing(): void {
    const targetStrength = this.currentMatch.strength;
    this.smoothedStrength = lerp(this.smoothedStrength, targetStrength, 0.12);

    const targetDistortion = 1 - this.smoothedStrength * 0.85;
    this.smoothedDistortion = lerp(this.smoothedDistortion, targetDistortion, 0.1);

    const targetStatic = 1 - this.smoothedStrength * 0.7;
    this.smoothedStatic = lerp(this.smoothedStatic, targetStatic, 0.15);

    const targetVhsTint = this.smoothedStrength > 0.4 ? this.smoothedStrength : 0;
    this.smoothedVhsTint = lerp(this.smoothedVhsTint, targetVhsTint, 0.08);

    const targetColor = getSignalColor(this.currentMatch.signal, this.smoothedStrength);
    this.smoothedSignalColor = [
      lerp(this.smoothedSignalColor[0], targetColor[0], 0.1),
      lerp(this.smoothedSignalColor[1], targetColor[1], 0.1),
      lerp(this.smoothedSignalColor[2], targetColor[2], 0.1)
    ];
  }

  private updateUI(): void {
    const fillPercent = Math.min(100, this.smoothedStrength * 100);
    this.elements.signalFill.style.width = `${fillPercent.toFixed(1)}%`;

    const shouldShowOverlay = this.smoothedStrength > 0.7;
    if (shouldShowOverlay !== this.signalOverlayActive) {
      this.signalOverlayActive = shouldShowOverlay;
      this.elements.signalOverlay.classList.toggle('active', shouldShowOverlay);

      if (shouldShowOverlay && this.currentMatch.signal) {
        const signal = this.currentMatch.signal;
        this.elements.signalName.textContent = signal.name;
        this.elements.signalDescription.textContent = signal.description;
        this.binaryStream = signal.fragmentPath;

        if (!this.foundSignals.has(signal.id)) {
          this.foundSignals.add(signal.id);
          this.elements.foundCount.textContent = `Signals found: ${this.foundSignals.size} / ${this.signals.length}`;
        }
      }
    }

    this.binaryTimer += 1;
    if (this.binaryTimer > 3 && this.signalOverlayActive) {
      this.binaryTimer = 0;
      const len = this.binaryStream.length;
      const extra = Math.floor(Math.random() * 12) + 4;
      let display = this.binaryStream;
      for (let i = 0; i < extra; i++) {
        display += Math.random() > 0.5 ? '1' : '0';
      }
      this.elements.binaryStream.textContent = display.substring(0, Math.min(len + extra, 80));
    }
  }

  private lastChallengeUpdate: number = 0;

  private animate(): void {
    if (this.weatherSystem) {
      const weatherResult = this.weatherSystem.update();
      this.weatherOffset = weatherResult.offset;
      this.updateSignalMatch();
      this.updateSmoothing();

      if (this.renderer) {
        this.renderer.render({
          signalStrength: this.smoothedStrength,
          staticAmount: this.smoothedStatic,
          distortionAmount: this.smoothedDistortion,
          vhsTint: this.smoothedVhsTint,
          signalColor: this.smoothedSignalColor,
          rainIntensity: weatherResult.rainIntensity,
          flash: weatherResult.flash
        });
      }

      this.audioManager.setNoiseIntensity(this.smoothedStrength);
      if (this.currentMatch.signal && this.smoothedStrength > 0.3) {
        const baseFreq = this.currentMatch.signal.id === 'signal_01' ? 220
          : this.currentMatch.signal.id === 'signal_02' ? 440
          : this.currentMatch.signal.id === 'signal_03' ? 660
          : 330;
        const wobble = Math.sin(performance.now() * 0.008) * 15;
        this.audioManager.setSignalTone(baseFreq + wobble, this.smoothedStrength);
      } else {
        this.audioManager.setSignalTone(0, 0);
      }
      this.audioManager.update();

      this.updateUI();

      const now = Date.now();
      if (this.challengeState.isActive && now - this.lastChallengeUpdate > 100) {
        this.lastChallengeUpdate = now;
        this.updateChallengeTimer();
        this.checkChallengeCompletion();
      }
    }

    requestAnimationFrame(() => this.animate());
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const game = new Game();
  await game.init();
});
