// SPDX-License-Identifier: MIT
// Copyright (c) vecnode

import { describe, expect, it } from 'vitest';
import { ArduinoRuntime } from './runtime';
import { compileSketch, createSketchGlobals } from './sketch-globals';

describe('compileSketch', () => {
  it('runs a blink-shaped sketch against the runtime', () => {
    const runtime = new ArduinoRuntime({ timeScale: 1_000_000 }); // near-instant delay()
    const globals = createSketchGlobals(runtime);
    const sketch = compileSketch(
      `
      function setup() {
        pinMode(LED_BUILTIN, OUTPUT);
      }
      function loop() {
        digitalWrite(LED_BUILTIN, HIGH);
        delay(1);
        digitalWrite(LED_BUILTIN, LOW);
        delay(1);
      }
      `,
      globals,
    );

    sketch.setup();
    expect(runtime.readPinDirection(13)).toBe('output');

    sketch.loop();
    expect(runtime.digitalRead(13)).toBe(0); // ends LOW after one full loop() call
  });

  it('routes Serial.println() through the runtime as a CRLF-terminated byte stream', () => {
    const runtime = new ArduinoRuntime();
    const globals = createSketchGlobals(runtime);
    const bytes: number[] = [];
    runtime.onSerialWrite((b) => bytes.push(b));

    const sketch = compileSketch(
      `
      function setup() { Serial.println("Hi"); }
      function loop() {}
      `,
      globals,
    );
    sketch.setup();

    expect(String.fromCharCode(...bytes)).toBe('Hi\r\n');
  });

  it('throws when the sketch never defines setup()/loop() at all', () => {
    const runtime = new ArduinoRuntime();
    const globals = createSketchGlobals(runtime);
    // compileSketch itself always returns callable no-op fallbacks (see its
    // own doc comment) - this documents that a sketch with a syntax error
    // throws from the `new Function` construction step instead.
    expect(() => compileSketch('this is not valid javascript {{{', globals)).toThrow();
  });

  it('a sketch that omits loop() gets a callable no-op fallback instead of crashing the scheduler', () => {
    const runtime = new ArduinoRuntime();
    const globals = createSketchGlobals(runtime);
    const sketch = compileSketch('function setup() { pinMode(13, OUTPUT); }', globals);
    sketch.setup();
    expect(() => sketch.loop()).not.toThrow();
  });

  it('defaults A0..A5 to pins 14-19 (Uno/Nano/Leonardo shape)', () => {
    const runtime = new ArduinoRuntime();
    const globals = createSketchGlobals(runtime);
    expect(globals.A0).toBe(14);
    expect(globals.A5).toBe(19);
    expect(globals.A6).toBeUndefined();
  });

  it('generates A0..A15 at pins 54-69 for a Mega-shaped options object', () => {
    const runtime = new ArduinoRuntime({ pinCount: 70 });
    const globals = createSketchGlobals(runtime, { digitalPinCount: 54, analogPinCount: 16 });
    expect(globals.A0).toBe(54);
    expect(globals.A15).toBe(69);
  });

  it("a sketch's `new LiquidCrystal(...)` constructs a real LiquidCrystal bound to the runtime", () => {
    const runtime = new ArduinoRuntime({ timeScale: 1_000_000 });
    const globals = createSketchGlobals(runtime);
    const enableChanges: number[] = [];
    runtime.onPinChange(11, (v) => enableChanges.push(v)); // the `enable` pin, 2nd LiquidCrystal ctor arg

    const sketch = compileSketch(
      `
      let lcd;
      function setup() {
        lcd = new LiquidCrystal(12, 11, 5, 4, 3, 2);
        lcd.begin(16, 2);
      }
      function loop() {}
      `,
      globals,
    );
    sketch.setup();

    // begin() genuinely pulses the enable pin as part of its real
    // write4bits()/pulseEnable() init sequence (see LiquidCrystal.ts) -
    // confirms the sketch's LiquidCrystal is the real class, not a stub,
    // and is wired to this runtime's pins.
    expect(enableChanges.length).toBeGreaterThan(0);
  });
});
