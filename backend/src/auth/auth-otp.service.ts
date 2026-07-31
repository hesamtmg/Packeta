import { Injectable } from '@nestjs/common';

interface OtpEntry {
  code: string;
  expiresAt: number;
  used: boolean;
}

const OTP_TTL_MS = 5 * 60 * 1000;

// In-memory sandbox OTP for phone-based login/signup — same spirit as
// PurchaseGatewayService's OtpService (no real SMS provider), but keyed
// directly by phone number since there's no charge/authority context here.
@Injectable()
export class AuthOtpService {
  private readonly otps = new Map<string, OtpEntry>();

  // Requesting a new code for the same phone overwrites the previous one
  // (acts as "resend").
  generateOtp(phoneNumber: string): string {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    this.otps.set(phoneNumber, {
      code,
      expiresAt: Date.now() + OTP_TTL_MS,
      used: false,
    });
    return code;
  }

  // One-time use: a matched code is immediately marked used so replaying it
  // (or racing two verify calls) can't succeed twice.
  verifyOtp(phoneNumber: string, code: string): boolean {
    const entry = this.otps.get(phoneNumber);
    if (!entry || entry.used || entry.expiresAt < Date.now()) {
      return false;
    }
    if (entry.code !== code) {
      return false;
    }
    entry.used = true;
    return true;
  }
}
