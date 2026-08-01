// SPDX-License-Identifier: MIT
// Copyright (c) vecnode
//
// A JS reimplementation of the Arduino LiquidCrystal library's 4-bit-mode,
// no-RW-pin constructor (`LiquidCrystal(rs, enable, d4, d5, d6, d7)`) - the
// shape physicalsim's own hd44780-decoder.ts (web/common/src/circuit/
// protocols/hd44780-decoder.ts) already expects and decodes.
//
// This is deliberately NOT a display simulator: it doesn't track
// characters, cursor position, or DDRAM at all. It only needs to toggle
// the RS/E/D4-D7 pins in the exact same order the real
// simulators/LiquidCrystal/src/LiquidCrystal.cpp does (write4bits() sets
// all four data pins, then pulseEnable() strobes E) - every existing
// protocol decoder and visual element then does the actual work,
// completely unaware whether a real CPU or this class drove those pins.
// Every method here is a line-for-line port of the real source's own
// logic, cited by name, not derived from general HD44780 folklore.

import type { ArduinoRuntime } from './runtime';

const LCD_CLEARDISPLAY = 0x01;
const LCD_RETURNHOME = 0x02;
const LCD_ENTRYMODESET = 0x04;
const LCD_DISPLAYCONTROL = 0x08;
const LCD_FUNCTIONSET = 0x20;
const LCD_SETDDRAMADDR = 0x80;

const LCD_ENTRYLEFT = 0x02;
const LCD_ENTRYSHIFTDECREMENT = 0x00;

const LCD_DISPLAYON = 0x04;
const LCD_CURSOROFF = 0x00;
const LCD_BLINKOFF = 0x00;

const LCD_4BITMODE = 0x00;
const LCD_1LINE = 0x00;
const LCD_5X8DOTS = 0x00;

export class LiquidCrystal {
  private readonly dataPins: [number, number, number, number];
  private rowOffsets: [number, number, number, number] = [0x00, 0x40, 0x00, 0x40];
  private numLines = 1;
  private displayControl = LCD_DISPLAYON | LCD_CURSOROFF | LCD_BLINKOFF;
  private displayMode = LCD_ENTRYLEFT | LCD_ENTRYSHIFTDECREMENT;

  constructor(
    private readonly runtime: ArduinoRuntime,
    private readonly rsPin: number,
    private readonly enablePin: number,
    d4: number,
    d5: number,
    d6: number,
    d7: number,
  ) {
    this.dataPins = [d4, d5, d6, d7];
  }

  /** Mirrors LiquidCrystal::begin() - see LiquidCrystal.cpp:78-165. */
  begin(cols: number, lines = 1): void {
    if (lines > 1) {
      this.numLines = lines;
    }
    this.rowOffsets = [0x00, 0x40, cols, 0x40 + cols];

    this.runtime.pinMode(this.rsPin, 'output');
    this.runtime.pinMode(this.enablePin, 'output');
    for (const pin of this.dataPins) {
      this.runtime.pinMode(pin, 'output');
    }

    this.runtime.delayMicroseconds(50000);
    this.runtime.digitalWrite(this.rsPin, 0);
    this.runtime.digitalWrite(this.enablePin, 0);

    // Hitachi HD44780 datasheet figure 24: three blind write4bits(0x03)
    // attempts, then switch to 4-bit interface.
    this.write4bits(0x03);
    this.runtime.delayMicroseconds(4500);
    this.write4bits(0x03);
    this.runtime.delayMicroseconds(4500);
    this.write4bits(0x03);
    this.runtime.delayMicroseconds(150);
    this.write4bits(0x02);

    const displayFunction = LCD_4BITMODE | LCD_1LINE | LCD_5X8DOTS;
    this.command(LCD_FUNCTIONSET | displayFunction);

    this.displayControl = LCD_DISPLAYON | LCD_CURSOROFF | LCD_BLINKOFF;
    this.command(LCD_DISPLAYCONTROL | this.displayControl);

    this.clear();

    this.displayMode = LCD_ENTRYLEFT | LCD_ENTRYSHIFTDECREMENT;
    this.command(LCD_ENTRYMODESET | this.displayMode);
  }

  clear(): void {
    this.command(LCD_CLEARDISPLAY);
    this.runtime.delayMicroseconds(2000);
  }

  home(): void {
    this.command(LCD_RETURNHOME);
    this.runtime.delayMicroseconds(2000);
  }

  setCursor(col: number, row: number): void {
    const maxLines = this.rowOffsets.length;
    let clampedRow = row;
    if (clampedRow >= maxLines) {
      clampedRow = maxLines - 1;
    }
    if (clampedRow >= this.numLines) {
      clampedRow = this.numLines - 1;
    }
    this.command(LCD_SETDDRAMADDR | (col + this.rowOffsets[clampedRow]));
  }

  print(text: string): void {
    for (let i = 0; i < text.length; i++) {
      this.write(text.charCodeAt(i));
    }
  }

  write(charCode: number): void {
    this.send(charCode, 1);
  }

  /** Mirrors LiquidCrystal::command() - LiquidCrystal.cpp:275-277. */
  private command(value: number): void {
    this.send(value, 0);
  }

  /** Mirrors LiquidCrystal::send() - LiquidCrystal.cpp:287-301 (4-bit path only, no RW pin). */
  private send(value: number, mode: 0 | 1): void {
    this.runtime.digitalWrite(this.rsPin, mode);
    this.write4bits(value >> 4);
    this.write4bits(value);
  }

  /** Mirrors LiquidCrystal::pulseEnable() - LiquidCrystal.cpp:303-310. */
  private pulseEnable(): void {
    this.runtime.digitalWrite(this.enablePin, 0);
    this.runtime.delayMicroseconds(1);
    this.runtime.digitalWrite(this.enablePin, 1);
    this.runtime.delayMicroseconds(1);
    this.runtime.digitalWrite(this.enablePin, 0);
    this.runtime.delayMicroseconds(100);
  }

  /** Mirrors LiquidCrystal::write4bits() - LiquidCrystal.cpp:312-318: all four data lines set, then one pulseEnable(). */
  private write4bits(value: number): void {
    for (let i = 0; i < 4; i++) {
      this.runtime.digitalWrite(this.dataPins[i], ((value >> i) & 0x01) as 0 | 1);
    }
    this.pulseEnable();
  }
}
