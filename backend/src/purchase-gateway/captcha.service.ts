import { randomInt, randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';

interface CaptchaEntry {
  answer: string;
  expiresAt: number;
  used: boolean;
}

const CAPTCHA_TTL_MS = 5 * 60 * 1000;
const DIGIT_COUNT = 5;

const IMAGE_WIDTH = 150;
const IMAGE_HEIGHT = 56;
const TEXT_COLORS = ['#2b2d42', '#5b3a29', '#1d3557', '#6a4c93', '#3a5a40'];
const NOISE_COLORS = ['#adb5bd', '#ced4da', '#dee2e6'];

// A lightweight, self-hosted CAPTCHA gating the OTP request step — no
// external CAPTCHA provider/API key involved. Not meant to stop a
// determined attacker, just to make scripted OTP-request spam (phone number
// enumeration, SMS-bombing a real provider in production) more than a
// one-line curl loop. Shared by every OTP-gated flow (purchase-gateway and
// phone-auth) — a single shared instance, so raising the difficulty here
// raises it everywhere it's used.
//
// Just a handful of random digits placed side by side — no arithmetic to
// work out, so it's quick to read and retype for any user regardless of
// language or math comfort, while still requiring a script to actually
// parse an image instead of reading a JSON field.
//
// The digits are never sent to the client as plain text — only as a
// distorted SVG image (renderImage), the same way a conventional image
// CAPTCHA works.
@Injectable()
export class CaptchaService {
  private readonly captchas = new Map<string, CaptchaEntry>();

  generate(): { captchaId: string; image: string } {
    let digits = '';
    for (let i = 0; i < DIGIT_COUNT; i++) {
      digits += randomInt(0, 10).toString();
    }

    const captchaId = randomUUID();
    this.captchas.set(captchaId, {
      answer: digits,
      expiresAt: Date.now() + CAPTCHA_TTL_MS,
      used: false,
    });
    return { captchaId, image: this.renderImage(digits) };
  }

  // One-time use: a correct answer is immediately consumed so it can't be
  // replayed across multiple OTP requests.
  verify(captchaId: string, answer: string): boolean {
    const entry = this.captchas.get(captchaId);
    if (!entry || entry.used || entry.expiresAt < Date.now()) {
      return false;
    }
    if (answer.trim() !== entry.answer) {
      return false;
    }
    entry.used = true;
    return true;
  }

  // Draws `digits` as randomly jittered/rotated/colored glyphs over a
  // handful of noise lines and dots, wrapped as a data: URI so the frontend
  // can drop it straight into an <img src>. Pure SVG (no canvas/image
  // library or native dependency needed) — SVG is just XML text that any
  // browser rasterizes on its own.
  private renderImage(digits: string): string {
    let glyphs = '';
    let x = 14;
    for (const ch of digits) {
      const size = 26 + randomInt(0, 8);
      const y = IMAGE_HEIGHT / 2 + randomInt(-6, 7);
      const rotation = randomInt(-18, 19);
      const color = TEXT_COLORS[randomInt(0, TEXT_COLORS.length)];
      glyphs +=
        `<text x="${x}" y="${y}" font-size="${size}" font-family="monospace" ` +
        `font-weight="700" fill="${color}" ` +
        `transform="rotate(${rotation} ${x} ${y})">${ch}</text>`;
      x += size * 0.72;
    }

    let noise = '';
    for (let i = 0; i < 6; i++) {
      const x1 = randomInt(0, IMAGE_WIDTH);
      const y1 = randomInt(0, IMAGE_HEIGHT);
      const x2 = randomInt(0, IMAGE_WIDTH);
      const y2 = randomInt(0, IMAGE_HEIGHT);
      const color = NOISE_COLORS[randomInt(0, NOISE_COLORS.length)];
      noise += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.5" />`;
    }
    for (let i = 0; i < 24; i++) {
      const cx = randomInt(0, IMAGE_WIDTH);
      const cy = randomInt(0, IMAGE_HEIGHT);
      const color = NOISE_COLORS[randomInt(0, NOISE_COLORS.length)];
      noise += `<circle cx="${cx}" cy="${cy}" r="1" fill="${color}" />`;
    }

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" ` +
      `viewBox="0 0 ${IMAGE_WIDTH} ${IMAGE_HEIGHT}">` +
      `<rect width="100%" height="100%" fill="#f1f3f5" />${noise}${glyphs}</svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }
}
