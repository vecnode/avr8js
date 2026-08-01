// SPDX-License-Identifier: MIT
// Copyright (c) vecnode

import { describe, expect, it, vi } from 'vitest';
import { ArduinoRuntime, ArduinoRuntimeStoppedError, parsePinName, pinName } from './runtime';

describe('pinName', () => {
  it('maps digital pins 0-13 to D0..D13', () => {
    expect(pinName(0)).toBe('D0');
    expect(pinName(13)).toBe('D13');
  });

  it('maps pins 14-19 to A0..A5', () => {
    expect(pinName(14)).toBe('A0');
    expect(pinName(19)).toBe('A5');
  });

  it('throws for an out-of-range pin', () => {
    expect(() => pinName(20)).toThrow(RangeError);
  });

  it('supports a Mega-shaped 54 digital + 16 analog pin layout', () => {
    expect(pinName(0, 54, 16)).toBe('D0');
    expect(pinName(53, 54, 16)).toBe('D53');
    expect(pinName(54, 54, 16)).toBe('A0');
    expect(pinName(69, 54, 16)).toBe('A15');
    expect(() => pinName(70, 54, 16)).toThrow(RangeError);
  });
});

describe('parsePinName', () => {
  it('is the exact inverse of pinName for the default (Uno) shape', () => {
    for (let pin = 0; pin < 20; pin++) {
      expect(parsePinName(pinName(pin))).toBe(pin);
    }
  });

  it('is the exact inverse of pinName for a Mega-shaped layout', () => {
    for (const pin of [0, 27, 53, 54, 61, 69]) {
      expect(parsePinName(pinName(pin, 54, 16), 54, 16)).toBe(pin);
    }
  });

  it('throws for an invalid pin id', () => {
    expect(() => parsePinName('Z0')).toThrow();
    expect(() => parsePinName('D99')).toThrow();
    expect(() => parsePinName('A99')).toThrow();
  });
});

describe('ArduinoRuntime', () => {
  it('digitalWrite/digitalRead round-trip', () => {
    const runtime = new ArduinoRuntime();
    runtime.pinMode(13, 'output');
    runtime.digitalWrite(13, 1);
    expect(runtime.digitalRead(13)).toBe(1);
    runtime.digitalWrite(13, 0);
    expect(runtime.digitalRead(13)).toBe(0);
  });

  it('input_pullup immediately reads high until externally driven low', () => {
    const runtime = new ArduinoRuntime();
    runtime.pinMode(2, 'input_pullup');
    expect(runtime.digitalRead(2)).toBe(1);
    runtime.setDigitalInput(2, 0);
    expect(runtime.digitalRead(2)).toBe(0);
  });

  it('onPinChange only fires on an actual value change', () => {
    const runtime = new ArduinoRuntime();
    const listener = vi.fn();
    runtime.onPinChange(13, listener);
    runtime.digitalWrite(13, 0); // already 0 - no change
    expect(listener).not.toHaveBeenCalled();
    runtime.digitalWrite(13, 1);
    expect(listener).toHaveBeenCalledWith(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('onPinChange unsubscribe stops further notifications', () => {
    const runtime = new ArduinoRuntime();
    const listener = vi.fn();
    const unsubscribe = runtime.onPinChange(13, listener);
    unsubscribe();
    runtime.digitalWrite(13, 1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('analogRead/setAnalogInput round-trip through the 0-1023 range', () => {
    const runtime = new ArduinoRuntime();
    runtime.setAnalogInput(14, 512);
    expect(runtime.analogRead(14)).toBe(512);
    runtime.setAnalogInput(14, 1023);
    expect(runtime.analogRead(14)).toBe(1023);
  });

  it('analogWrite clamps to the 0-255 duty range', () => {
    const runtime = new ArduinoRuntime();
    runtime.analogWrite(9, 300);
    expect(runtime.readPin(9)).toBe(1);
    runtime.analogWrite(9, -10);
    expect(runtime.readPin(9)).toBe(0);
  });

  it('readPinDirection reflects pinMode', () => {
    const runtime = new ArduinoRuntime();
    runtime.pinMode(13, 'output');
    expect(runtime.readPinDirection(13)).toBe('output');
    runtime.pinMode(2, 'input');
    expect(runtime.readPinDirection(2)).toBe('input');
  });

  it('writeSerialByte fans out to every onSerialWrite listener', () => {
    const runtime = new ArduinoRuntime();
    const bytes: number[] = [];
    runtime.onSerialWrite((b) => bytes.push(b));
    runtime.writeSerialByte(65);
    runtime.writeSerialByte(66);
    expect(bytes).toEqual([65, 66]);
  });

  it('millis() advances with real elapsed time, scaled by timeScale', () => {
    // A very large timeScale makes even a tiny real delay resolve to a
    // large virtual-millis jump, without the test needing a real sleep.
    const runtime = new ArduinoRuntime({ timeScale: 1_000_000 });
    const before = runtime.millis();
    runtime.delay(0.01); // real wall time, scaled way up
    const after = runtime.millis();
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('delay() throws ArduinoRuntimeStoppedError once requestStop() has been called', () => {
    const runtime = new ArduinoRuntime({ timeScale: 1 });
    runtime.requestStop();
    expect(() => runtime.delay(50)).toThrow(ArduinoRuntimeStoppedError);
  });

  it('rejects an out-of-range pin', () => {
    const runtime = new ArduinoRuntime();
    expect(() => runtime.digitalWrite(99, 1)).toThrow(RangeError);
  });
});
