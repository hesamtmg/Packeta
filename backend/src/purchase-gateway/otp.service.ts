import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';

interface OtpEntry {
  code: string;
  userId: string;
  expiresAt: number;
  used: boolean;
}

interface SessionEntry {
  userId: string;
  authority: string;
  expiresAt: number;
}

const OTP_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 10 * 60 * 1000;

// In-memory only — this is a sandbox OTP, same spirit as the rest of the IPG
// (no real SMS provider, no real bank accounts). State resets on restart and
// doesn't survive multiple backend instances, which is fine for local/dev
// use; a real deployment would move this to Redis or a DB table with the
// same shape.
@Injectable()
export class OtpService {
  private readonly otps = new Map<string, OtpEntry>();
  private readonly sessions = new Map<string, SessionEntry>();

  // Keyed by authority: requesting a new code for the same payment page
  // simply overwrites the previous one (acts as "resend").
  generateOtp(authority: string, userId: string): string {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    this.otps.set(authority, {
      code,
      userId,
      expiresAt: Date.now() + OTP_TTL_MS,
      used: false,
    });
    return code;
  }

  // One-time use: a matched code is immediately marked used so replaying it
  // (or racing two verify calls) can't succeed twice.
  verifyOtp(authority: string, code: string): string | null {
    const entry = this.otps.get(authority);
    if (!entry || entry.used || entry.expiresAt < Date.now()) {
      return null;
    }
    if (entry.code !== code) {
      return null;
    }
    entry.used = true;
    return entry.userId;
  }

  createSession(authority: string, userId: string): string {
    const token = randomUUID();
    this.sessions.set(token, {
      userId,
      authority,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    return token;
  }

  // Proof that this browser already passed OTP for this specific payment —
  // required before attach-wallet will bind a chosen wallet to the charge.
  resolveSession(authority: string, sessionToken: string): string | null {
    const entry = this.sessions.get(sessionToken);
    if (
      !entry ||
      entry.authority !== authority ||
      entry.expiresAt < Date.now()
    ) {
      return null;
    }
    return entry.userId;
  }
}
