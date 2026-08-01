// SPDX-License-Identifier: MIT
// Copyright (c) vecnode

import { describe, expect, it } from 'vitest';
import { LiquidCrystal } from './liquid-crystal';
import { ArduinoRuntime } from './runtime';

// Pins matching the common `LiquidCrystal lcd(12, 11, 5, 4, 3, 2);` wiring.
const RS = 12;
const E = 11;
const D4 = 5;
const D5 = 4;
const D6 = 3;
const D7 = 2;

/** Replays physicalsim's own Hd44780Decoder logic against recorded pin events, without depending on physicalsim's package. */
class MiniHd44780Decoder {
  private pinValues = { rs: 0, e: 0, d4: 0, d5: 0, d6: 0, d7: 0 } as Record<string, number>;
  private pendingHighNibble: number | null = null;
  private pendingRs = 0;
  bytes: Array<{ rs: number; byte: number }> = [];

  onPinValue(key: string, value: number): void {
    const wasE = this.pinValues.e;
    this.pinValues[key] = value;
    if (key === 'e' && wasE === 1 && value === 0) {
      this.onNibbleLatched();
    }
  }

  private onNibbleLatched(): void {
    const nibble =
      (this.pinValues.d4 ? 0x1 : 0) |
      (this.pinValues.d5 ? 0x2 : 0) |
      (this.pinValues.d6 ? 0x4 : 0) |
      (this.pinValues.d7 ? 0x8 : 0);
    if (this.pendingHighNibble === null) {
      this.pendingHighNibble = nibble;
      this.pendingRs = this.pinValues.rs;
      return;
    }
    const byte = (this.pendingHighNibble << 4) | nibble;
    const rs = this.pendingRs;
    this.pendingHighNibble = null;
    this.bytes.push({ rs, byte });
  }
}

function attachDecoder(runtime: ArduinoRuntime, decoder: MiniHd44780Decoder): void {
  const pins: Record<string, number> = { rs: RS, e: E, d4: D4, d5: D5, d6: D6, d7: D7 };
  for (const [key, pin] of Object.entries(pins)) {
    runtime.onPinChange(pin, (value) => decoder.onPinValue(key, value));
  }
}

describe('LiquidCrystal', () => {
  it("write()'s two nibble pulses decode back to the original byte, RS=1 (character data)", () => {
    const runtime = new ArduinoRuntime({ timeScale: 1_000_000 });
    const decoder = new MiniHd44780Decoder();
    attachDecoder(runtime, decoder);

    const lcd = new LiquidCrystal(runtime, RS, E, D4, D5, D6, D7);
    lcd.begin(16, 2);
    decoder.bytes.length = 0; // begin() emits real init/clear commands - only care about the character below

    lcd.write(0x41); // 'A'

    expect(decoder.bytes).toEqual([{ rs: 1, byte: 0x41 }]);
  });

  it('print() writes one decoded byte per character, in order', () => {
    const runtime = new ArduinoRuntime({ timeScale: 1_000_000 });
    const decoder = new MiniHd44780Decoder();
    attachDecoder(runtime, decoder);

    const lcd = new LiquidCrystal(runtime, RS, E, D4, D5, D6, D7);
    lcd.begin(16, 2);
    decoder.bytes.length = 0;

    lcd.print('Hi');

    expect(decoder.bytes.map((b) => b.byte)).toEqual(['H'.charCodeAt(0), 'i'.charCodeAt(0)]);
    expect(decoder.bytes.every((b) => b.rs === 1)).toBe(true);
  });

  it('setCursor() decodes to a SETDDRAMADDR command, RS=0', () => {
    const runtime = new ArduinoRuntime({ timeScale: 1_000_000 });
    const decoder = new MiniHd44780Decoder();
    attachDecoder(runtime, decoder);

    const lcd = new LiquidCrystal(runtime, RS, E, D4, D5, D6, D7);
    lcd.begin(16, 2);
    decoder.bytes.length = 0;

    lcd.setCursor(3, 1); // row 1 offset is 0x40 (see rowOffsets)

    expect(decoder.bytes).toEqual([{ rs: 0, byte: 0x80 | (0x40 + 3) }]);
  });

  it('clear() decodes to the CLEARDISPLAY command, RS=0', () => {
    const runtime = new ArduinoRuntime({ timeScale: 1_000_000 });
    const decoder = new MiniHd44780Decoder();
    attachDecoder(runtime, decoder);

    const lcd = new LiquidCrystal(runtime, RS, E, D4, D5, D6, D7);
    lcd.begin(16, 2);
    decoder.bytes.length = 0;

    lcd.clear();

    expect(decoder.bytes).toEqual([{ rs: 0, byte: 0x01 }]);
  });
});
