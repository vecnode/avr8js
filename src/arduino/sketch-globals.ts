// SPDX-License-Identifier: MIT
// Copyright (c) vecnode
//
// Builds the global-scope object bag a JS-interpreted sketch runs against -
// the same names a real Arduino sketch uses (pinMode, digitalWrite, HIGH,
// Serial.println, ...), bound to one ArduinoRuntime instance.

import { ArduinoRuntime, type PinMode } from './runtime';

export const HIGH = 1;
export const LOW = 0;
export const INPUT: PinMode = 'input';
export const OUTPUT: PinMode = 'output';
export const INPUT_PULLUP: PinMode = 'input_pullup';
// Real Arduino core numbering (`#define A0 14` etc. in pins_arduino.h) -
// see runtime.ts's pinName() for why this project uses the same scheme.
export const A0 = 14;
export const A1 = 15;
export const A2 = 16;
export const A3 = 17;
export const A4 = 18;
export const A5 = 19;
export const LED_BUILTIN = 13;

/**
 * Arduino's `Serial` object, TX-only (matching every real adapter's
 * current scope - see AVRUSART/adapter.ts's own onSerialData). `begin()`
 * is a no-op (no real baud-rate/framing to configure without a real
 * UART peripheral) kept only so sketches that call `Serial.begin(9600)`
 * don't need editing to run here.
 */
export class SketchSerial {
  constructor(private readonly runtime: ArduinoRuntime) {}

  begin(baud: number): void {
    void baud; // no-op: see class doc comment.
  }

  write(byte: number): void {
    this.runtime.writeSerialByte(byte);
  }

  print(value: unknown): void {
    const text = String(value);
    for (let i = 0; i < text.length; i++) {
      this.runtime.writeSerialByte(text.charCodeAt(i));
    }
  }

  println(value: unknown = ''): void {
    this.print(value);
    this.runtime.writeSerialByte(0x0d);
    this.runtime.writeSerialByte(0x0a);
  }
}

export interface SketchGlobals {
  pinMode: (pin: number, mode: PinMode) => void;
  digitalWrite: (pin: number, value: 0 | 1 | boolean) => void;
  digitalRead: (pin: number) => 0 | 1;
  analogWrite: (pin: number, value: number) => void;
  analogRead: (pin: number) => number;
  millis: () => number;
  micros: () => number;
  delay: (ms: number) => void;
  delayMicroseconds: (us: number) => void;
  Serial: SketchSerial;
  HIGH: number;
  LOW: number;
  INPUT: PinMode;
  OUTPUT: PinMode;
  INPUT_PULLUP: PinMode;
  A0: number;
  A1: number;
  A2: number;
  A3: number;
  A4: number;
  A5: number;
  LED_BUILTIN: number;
}

export function createSketchGlobals(runtime: ArduinoRuntime): SketchGlobals {
  return {
    pinMode: (pin, mode) => runtime.pinMode(pin, mode),
    digitalWrite: (pin, value) => runtime.digitalWrite(pin, value ? 1 : 0),
    digitalRead: (pin) => runtime.digitalRead(pin),
    analogWrite: (pin, value) => runtime.analogWrite(pin, value),
    analogRead: (pin) => runtime.analogRead(pin),
    millis: () => runtime.millis(),
    micros: () => runtime.micros(),
    delay: (ms) => runtime.delay(ms),
    delayMicroseconds: (us) => runtime.delayMicroseconds(us),
    Serial: new SketchSerial(runtime),
    HIGH,
    LOW,
    INPUT,
    OUTPUT,
    INPUT_PULLUP,
    A0,
    A1,
    A2,
    A3,
    A4,
    A5,
    LED_BUILTIN,
  };
}

export interface CompiledSketch {
  setup: () => void;
  loop: () => void;
}

/**
 * Interprets sketch source text as a JS function body exposing `setup`
 * and `loop` (either `function setup() {...}` declarations, matching real
 * Arduino sketch shape, or `const setup = () => {...}`) against the given
 * globals - no compiler involved, this is `new Function(...)` running the
 * sketch's own top-level code once to capture its declared setup/loop,
 * then handing back those two functions for the caller's own scheduler
 * to invoke. Runs whatever scope calls this in (a Worker, in
 * physicalsim's case - see ARCHITECTURE.md's adapter-worker isolation),
 * which is the sandboxing boundary: no DOM/network access from inside a
 * Worker, same posture a real compiled sketch's machine code already had.
 */
export function compileSketch(source: string, globals: SketchGlobals): CompiledSketch {
  const globalNames = Object.keys(globals);
  const globalValues = Object.values(globals);
  const factory = new Function(
    ...globalNames,
    `"use strict";\n${source}\nreturn { setup: typeof setup === 'function' ? setup : function(){}, loop: typeof loop === 'function' ? loop : function(){} };`,
  ) as (...args: unknown[]) => CompiledSketch;
  const compiled = factory(...globalValues);
  if (typeof compiled.setup !== 'function' || typeof compiled.loop !== 'function') {
    throw new Error('Sketch must define setup() and loop() functions');
  }
  return compiled;
}
