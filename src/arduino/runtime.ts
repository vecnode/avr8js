// SPDX-License-Identifier: MIT
// Copyright (c) vecnode
//
// A CPU-independent, JS/TS-native Arduino-API runtime: sketches are
// interpreted directly (setup()/loop() as plain JS functions, no compiler
// involved), driving pin state and Serial output through the exact same
// shape a real board adapter already exposes (readPin/writePin/onPinChange -
// see physicalsim's SimulatorAdapter interface). This intentionally does
// NOT reuse the CPU-coupled peripherals in ../peripherals/* (AVRIOPort's
// output side, AVRTimer, AVRUSART's TX are all hard-wired to a CPU
// instance's memory-mapped registers) - it is a parallel, lower-fidelity
// execution mode, not a refactor of the cycle-accurate one.

export type PinMode = 'input' | 'output' | 'input_pullup';

export type PinChangeListener = (value: number) => void;
export type SerialByteListener = (byte: number) => void;

const DIGITAL_PIN_COUNT = 14; // D0-D13 (Uno/Nano/Leonardo's shape - the default)
const ANALOG_PIN_COUNT = 6; // A0-A5 (Uno/Nano/Leonardo's shape - the default)

/**
 * Arduino-style pin numbering: 0..(digitalCount-1) are the digital pins,
 * the next `analogCount` are A0..A(analogCount-1) (matching real Arduino
 * cores' own `#define A0 14` etc.) - the de facto standard numbering
 * every AVR Arduino board's core uses, not a physicalsim-specific
 * scheme. Defaults to the Uno/Nano/Leonardo shape (14 digital + 6
 * analog); a Mega-shaped board passes 54/16 (D0-D53, A0-A15).
 * `pinName()` turns a numeric pin back into the "D0".."D13"/"A0".."A5"
 * strings a board's own BoardPinMap is keyed by, so a host adapter can
 * resolve a real board pin without this class knowing anything about
 * board-specific pin ids; `parsePinName()` is its exact inverse.
 */
export function pinName(
  pin: number,
  digitalCount = DIGITAL_PIN_COUNT,
  analogCount = ANALOG_PIN_COUNT,
): string {
  if (pin < digitalCount) {
    return `D${pin}`;
  }
  const analogIndex = pin - digitalCount;
  if (analogIndex >= 0 && analogIndex < analogCount) {
    return `A${analogIndex}`;
  }
  throw new RangeError(`ArduinoRuntime: pin ${pin} is out of range`);
}

export function parsePinName(
  name: string,
  digitalCount = DIGITAL_PIN_COUNT,
  analogCount = ANALOG_PIN_COUNT,
): number {
  const letter = name.charAt(0).toUpperCase();
  const index = Number(name.slice(1));
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`ArduinoRuntime: invalid pin id "${name}"`);
  }
  if (letter === 'D' && index < digitalCount) {
    return index;
  }
  if (letter === 'A' && index < analogCount) {
    return digitalCount + index;
  }
  throw new Error(`ArduinoRuntime: invalid pin id "${name}"`);
}

export interface ArduinoRuntimeOptions {
  /**
   * Total addressable pins (digital 0-13 + analog A0-A5 = 20 by default,
   * matching the Uno). A future Mega-shaped runtime would pass a larger
   * count; this class doesn't otherwise know or care which board it's
   * standing in for.
   */
  pinCount?: number;
  /**
   * How many virtual milliseconds pass per real millisecond spent inside
   * delay()/delayMicroseconds(). 1 (the default) makes a `delay(500)`
   * sketch visibly blink at the same speed a human watching a real board
   * would see; a headless test suite can pass a very large value to make
   * delay() resolve near-instantly instead of burning real wall time.
   */
  timeScale?: number;
}

/**
 * Thrown out of delay()/delayMicroseconds() when stop() is called while a
 * sketch is blocked in one - unwinds back out through run()/step() rather
 * than the sketch's own loop() continuing to execute after a stop request.
 */
export class ArduinoRuntimeStoppedError extends Error {
  constructor() {
    super('ArduinoRuntime: stop() requested while inside delay()');
    this.name = 'ArduinoRuntimeStoppedError';
  }
}

export class ArduinoRuntime {
  private readonly pinCount: number;
  private readonly timeScale: number;

  private readonly modes: PinMode[];
  // Current logical value of every pin - for OUTPUT pins this is whatever
  // the sketch last wrote (digitalWrite: 0/1, analogWrite: a 0..1 duty
  // fraction); for INPUT/INPUT_PULLUP pins this is whatever an external
  // driver (setDigitalInput/setAnalogInput - a placed button, a wired
  // sensor, physicalsim's own writePin() call for user interaction) last
  // set it to.
  private readonly values: number[];
  private readonly listeners: Array<Set<PinChangeListener>>;

  private readonly serialListeners = new Set<SerialByteListener>();

  private readonly startTime: number;
  private stopRequested = false;

  constructor(options: ArduinoRuntimeOptions = {}) {
    this.pinCount = options.pinCount ?? DIGITAL_PIN_COUNT + ANALOG_PIN_COUNT;
    this.timeScale = options.timeScale ?? 1;
    this.modes = new Array(this.pinCount).fill('input') as PinMode[];
    this.values = new Array(this.pinCount).fill(0) as number[];
    this.listeners = Array.from({ length: this.pinCount }, () => new Set<PinChangeListener>());
    this.startTime = performance.now();
  }

  private checkPin(pin: number): void {
    if (pin < 0 || pin >= this.pinCount || !Number.isInteger(pin)) {
      throw new RangeError(`ArduinoRuntime: pin ${pin} is out of range`);
    }
  }

  private setValue(pin: number, value: number): void {
    if (this.values[pin] === value) {
      return;
    }
    this.values[pin] = value;
    for (const listener of this.listeners[pin]) {
      listener(value);
    }
  }

  // ---- Arduino API surface, called by the interpreted sketch ------------

  pinMode(pin: number, mode: PinMode): void {
    this.checkPin(pin);
    this.modes[pin] = mode;
    if (mode === 'input_pullup') {
      // Real hardware: enabling the pull-up immediately drives the pin
      // high until something else pulls it low (a pressed button, an
      // external driver) - matches AVRIOPort's own PORTx-bit-as-pullup
      // behavior for a pin configured as input.
      this.setValue(pin, 1);
    }
  }

  digitalWrite(pin: number, value: 0 | 1): void {
    this.checkPin(pin);
    this.setValue(pin, value ? 1 : 0);
  }

  digitalRead(pin: number): 0 | 1 {
    this.checkPin(pin);
    return this.values[pin] ? 1 : 0;
  }

  /** 0-255 PWM duty cycle - stored as a 0..1 fraction, no real timer/carrier-frequency waveform. */
  analogWrite(pin: number, value: number): void {
    this.checkPin(pin);
    const clamped = Math.max(0, Math.min(255, value));
    this.setValue(pin, clamped / 255);
  }

  /** 0-1023, matching the Uno's 10-bit ADC - value comes from setAnalogInput(), 0 if never driven. */
  analogRead(pin: number): number {
    this.checkPin(pin);
    return Math.round(this.values[pin] * 1023);
  }

  millis(): number {
    return Math.floor((performance.now() - this.startTime) * this.timeScale);
  }

  micros(): number {
    return Math.floor((performance.now() - this.startTime) * this.timeScale * 1000);
  }

  /**
   * Real, blocking wait (a busy-spin on performance.now(), not a true
   * async sleep - JS has no synchronous yield) so a sketch's delay(500)
   * actually takes ~500ms of wall-clock time and an LED blink is visibly
   * paced the way a human watching a real board would see it. Checks
   * stop() every ~4ms slice rather than spinning the whole duration in
   * one shot, so a stop request during a long delay() is honored
   * promptly instead of after the full delay elapses.
   */
  delay(ms: number): void {
    const deadline = performance.now() + ms / this.timeScale;
    while (performance.now() < deadline) {
      if (this.stopRequested) {
        throw new ArduinoRuntimeStoppedError();
      }
      const remaining = deadline - performance.now();
      const slice = Math.min(remaining, 4);
      const sliceDeadline = performance.now() + slice;
      while (performance.now() < sliceDeadline) {
        /* busy-wait */
      }
    }
  }

  delayMicroseconds(us: number): void {
    this.delay(us / 1000);
  }

  // ---- External drivers (physicalsim adapter / placed components) -------

  /** A wired button/switch/other digital source driving an INPUT pin. */
  setDigitalInput(pin: number, value: 0 | 1): void {
    this.checkPin(pin);
    this.setValue(pin, value ? 1 : 0);
  }

  /** A wired potentiometer/sensor driving an analogRead() pin, 0-1023. */
  setAnalogInput(pin: number, value: number): void {
    this.checkPin(pin);
    const clamped = Math.max(0, Math.min(1023, value));
    this.setValue(pin, clamped / 1023);
  }

  readPinDirection(pin: number): 'input' | 'output' {
    this.checkPin(pin);
    return this.modes[pin] === 'output' ? 'output' : 'input';
  }

  readPin(pin: number): number {
    this.checkPin(pin);
    return this.values[pin];
  }

  onPinChange(pin: number, listener: PinChangeListener): () => void {
    this.checkPin(pin);
    this.listeners[pin].add(listener);
    return () => this.listeners[pin].delete(listener);
  }

  // ---- Serial (UART TX only, matching the real adapters' current scope) -

  writeSerialByte(byte: number): void {
    const value = byte & 0xff;
    for (const listener of this.serialListeners) {
      listener(value);
    }
  }

  onSerialWrite(listener: SerialByteListener): () => void {
    this.serialListeners.add(listener);
    return () => this.serialListeners.delete(listener);
  }

  // ---- Lifecycle ----------------------------------------------------------

  requestStop(): void {
    this.stopRequested = true;
  }

  clearStopRequest(): void {
    this.stopRequested = false;
  }

  get stopped(): boolean {
    return this.stopRequested;
  }
}
