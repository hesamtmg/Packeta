import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';

interface CaptchaEntry {
  answer: number;
  expiresAt: number;
  used: boolean;
}

const CAPTCHA_TTL_MS = 5 * 60 * 1000;

// A lightweight, self-hosted math challenge gating the OTP request step —
// no external CAPTCHA provider/API key involved. Not meant to stop a
// determined attacker, just to make scripted OTP-request spam (phone number
// enumeration, SMS-bombing a real provider in production) more than a
// one-line curl loop.
@Injectable()
export class CaptchaService {
  private readonly captchas = new Map<string, CaptchaEntry>();

  generate(): { captchaId: string; question: string } {
    const a = 1 + Math.floor(Math.random() * 8);
    const b = 1 + Math.floor(Math.random() * 8);
    const captchaId = randomUUID();
    this.captchas.set(captchaId, {
      answer: a + b,
      expiresAt: Date.now() + CAPTCHA_TTL_MS,
      used: false,
    });
    return { captchaId, question: `${a} + ${b} = ?` };
  }

  // One-time use: a correct answer is immediately consumed so it can't be
  // replayed across multiple OTP requests.
  verify(captchaId: string, answer: string): boolean {
    const entry = this.captchas.get(captchaId);
    if (!entry || entry.used || entry.expiresAt < Date.now()) {
      return false;
    }
    const numericAnswer = Number(answer);
    if (Number.isNaN(numericAnswer) || numericAnswer !== entry.answer) {
      return false;
    }
    entry.used = true;
    return true;
  }
}
