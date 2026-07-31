import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';

interface CaptchaEntry {
  answer: number;
  expiresAt: number;
  used: boolean;
}

const CAPTCHA_TTL_MS = 5 * 60 * 1000;
const OPERATORS = ['+', '-', '×'] as const;
type Operator = (typeof OPERATORS)[number];

// A lightweight, self-hosted math challenge gating the OTP request step —
// no external CAPTCHA provider/API key involved. Not meant to stop a
// determined attacker, just to make scripted OTP-request spam (phone number
// enumeration, SMS-bombing a real provider in production) more than a
// one-line curl loop. Shared by every OTP-gated flow (purchase-gateway and
// phone-auth) — a single shared instance, so raising the difficulty here
// raises it everywhere it's used.
//
// Three operands and two randomly-picked operators (+, -, ×), evaluated with
// normal operator precedence (multiplication before addition/subtraction) so
// the expression reads and computes the way a person expects — this is
// meaningfully harder to brute-force than the old single-digit addition
// while still being quick mental math for a real user.
@Injectable()
export class CaptchaService {
  private readonly captchas = new Map<string, CaptchaEntry>();

  generate(): { captchaId: string; question: string } {
    const a = 2 + Math.floor(Math.random() * 11);
    const b = 2 + Math.floor(Math.random() * 11);
    const c = 2 + Math.floor(Math.random() * 11);
    const op1 = OPERATORS[Math.floor(Math.random() * OPERATORS.length)];
    const op2 = OPERATORS[Math.floor(Math.random() * OPERATORS.length)];

    const captchaId = randomUUID();
    this.captchas.set(captchaId, {
      answer: this.evaluate(a, op1, b, op2, c),
      expiresAt: Date.now() + CAPTCHA_TTL_MS,
      used: false,
    });
    return { captchaId, question: `${a} ${op1} ${b} ${op2} ${c} = ?` };
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

  private evaluate(
    a: number,
    op1: Operator,
    b: number,
    op2: Operator,
    c: number,
  ): number {
    if (op1 === '×' && op2 === '×') return a * b * c;
    if (op1 === '×') return this.applyAdditive(a * b, op2, c);
    if (op2 === '×') return this.applyAdditive(a, op1, b * c);
    return this.applyAdditive(this.applyAdditive(a, op1, b), op2, c);
  }

  private applyAdditive(x: number, op: Operator, y: number): number {
    return op === '-' ? x - y : x + y;
  }
}
