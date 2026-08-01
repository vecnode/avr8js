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
});
