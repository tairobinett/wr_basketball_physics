/**
 * Logging (DESIGN.md §8).
 *
 * The contract that matters for performance: callers MUST guard construction of an event behind
 * `logger.enabled(level)`. The event object is then never allocated when logging is off, which is
 * what makes `NULL_LOGGER` genuinely zero-cost and keeps the outcome-map sweep fast (§12). An
 * allocated-then-discarded object per substep would dominate a 40k-shot sweep.
 */

import type { LogEvent, LogLevel } from './events.js';
import { LEVEL_ORDER } from './events.js';

export interface Logger {
  enabled(level: LogLevel): boolean;
  /** Only call after checking `enabled()`. */
  emit(ev: LogEvent): void;
  /** True on steps that should emit a sampled `step` event. */
  shouldSampleStep(tick: number): boolean;
}

export const NULL_LOGGER: Logger = {
  enabled: () => false,
  emit: () => {},
  shouldSampleStep: () => false,
};

export interface RingLoggerOptions {
  capacity?: number;
  minLevel?: LogLevel;
  /** Emit a `step` event every Nth tick. 12 ticks at 240 Hz is 20 Hz (DESIGN.md §8). */
  stepSampleEvery?: number;
}

export class RingLogger implements Logger {
  private readonly buf: LogEvent[];
  private readonly capacity: number;
  private head = 0;
  private count = 0;
  private minLevel: LogLevel;
  private stepEvery: number;
  private readonly subscribers = new Set<(ev: LogEvent) => void>();
  /** Monotonic counter so the UI can tell cheaply whether anything changed. */
  private revision = 0;

  constructor(opts: RingLoggerOptions = {}) {
    this.capacity = opts.capacity ?? 50_000;
    this.minLevel = opts.minLevel ?? 'trace';
    this.stepEvery = opts.stepSampleEvery ?? 12;
    this.buf = new Array<LogEvent>(this.capacity);
  }

  enabled(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.minLevel];
  }

  shouldSampleStep(tick: number): boolean {
    return this.enabled('trace') && tick % this.stepEvery === 0;
  }

  emit(ev: LogEvent): void {
    this.buf[this.head] = ev;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
    this.revision++;
    for (const fn of this.subscribers) fn(ev);
  }

  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  getMinLevel(): LogLevel {
    return this.minLevel;
  }

  setStepSampleEvery(n: number): void {
    this.stepEvery = Math.max(1, Math.floor(n));
  }

  getStepSampleEvery(): number {
    return this.stepEvery;
  }

  get size(): number {
    return this.count;
  }

  get rev(): number {
    return this.revision;
  }

  /** Oldest to newest. */
  toArray(): LogEvent[] {
    const out: LogEvent[] = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const ev = this.buf[(start + i) % this.capacity];
      if (ev !== undefined) out.push(ev);
    }
    return out;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this.revision++;
  }

  subscribe(fn: (ev: LogEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }
}
