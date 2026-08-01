import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { isEmail, matches } from 'class-validator';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { WalletTypesService } from '../wallet-types/wallet-types.service';
import {
  normalizePhoneNumber,
  PHONE_NUMBER_REGEX,
} from '../common/phone-number';
import { parseXlsxRows } from './xlsx-rows';

const SALT_ROUNDS = 10;

export interface BatchRowError {
  row: number;
  message: string;
}

export interface BatchResult {
  totalRows: number;
  created: number;
  errors: BatchRowError[];
}

// Bulk onboarding for the admin panel: an admin drops in a spreadsheet of
// customers or wallets instead of creating them one at a time. Each row is
// its own transaction, so one bad row is reported and skipped rather than
// aborting the whole file — the summary tells the admin exactly which rows
// need fixing and re-uploading.
@Injectable()
export class BatchImportService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly walletTypesService: WalletTypesService,
  ) {}

  // Columns: email, password, phoneNumber (optional).
  async importCustomers(buffer: Buffer): Promise<BatchResult> {
    const rows = await parseXlsxRows(buffer);
    const errors: BatchRowError[] = [];
    let created = 0;

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2; // header is row 1
      const email = row.email?.trim();
      const password = row.password ?? '';
      const phoneNumber = row.phoneNumber?.trim()
        ? normalizePhoneNumber(row.phoneNumber.trim())
        : null;

      if (!email || !isEmail(email)) {
        errors.push({ row: rowNumber, message: 'email is missing or invalid' });
        continue;
      }
      if (password.length < 8) {
        errors.push({
          row: rowNumber,
          message: 'password must be at least 8 characters',
        });
        continue;
      }
      if (phoneNumber && !matches(phoneNumber, PHONE_NUMBER_REGEX)) {
        errors.push({ row: rowNumber, message: 'phoneNumber is invalid' });
        continue;
      }

      const existingEmail = await this.usersService.findByEmail(email);
      if (existingEmail) {
        errors.push({
          row: rowNumber,
          message: `${email} is already registered`,
        });
        continue;
      }
      if (phoneNumber) {
        const existingPhone =
          await this.usersService.findByPhoneNumber(phoneNumber);
        if (existingPhone) {
          errors.push({
            row: rowNumber,
            message: `${phoneNumber} is already registered to another account`,
          });
          continue;
        }
      }

      try {
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        await this.dataSource.transaction(async (manager) => {
          const savedUser = await manager.save(
            manager.create(User, { email, passwordHash, phoneNumber }),
          );
          await this.walletsService.createDefaultWalletsForUser(
            manager,
            savedUser.id,
          );
        });
        created += 1;
      } catch (error) {
        errors.push({
          row: rowNumber,
          message: (error as Error).message || 'Failed to create this row',
        });
      }
    }

    return { totalRows: rows.length, created, errors };
  }

  // Columns: ownerEmail, walletTypeCode, currencyCode, and optionally
  // terminalId, acceptorCode, purchaseTimeoutMinutes, restrictedCounterparties
  // (comma-separated emails) — same fields CreateWalletDto accepts, just
  // flattened for a spreadsheet row.
  async importWallets(buffer: Buffer): Promise<BatchResult> {
    const rows = await parseXlsxRows(buffer);
    const errors: BatchRowError[] = [];
    let created = 0;
    const walletTypes = await this.walletTypesService.findAll();

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const ownerEmail = row.ownerEmail?.trim();
      const walletTypeCode = row.walletTypeCode?.trim().toUpperCase();
      const currencyCode = row.currencyCode?.trim().toUpperCase();

      if (!ownerEmail || !isEmail(ownerEmail)) {
        errors.push({
          row: rowNumber,
          message: 'ownerEmail is missing or invalid',
        });
        continue;
      }
      if (!walletTypeCode || !currencyCode) {
        errors.push({
          row: rowNumber,
          message: 'walletTypeCode and currencyCode are required',
        });
        continue;
      }

      const owner = await this.usersService.findByEmail(ownerEmail);
      if (!owner) {
        errors.push({
          row: rowNumber,
          message: `No account found with email ${ownerEmail}`,
        });
        continue;
      }

      const walletType = walletTypes.find(
        (type) =>
          type.code === walletTypeCode && type.currency.code === currencyCode,
      );
      if (!walletType) {
        errors.push({
          row: rowNumber,
          message: `No wallet type "${walletTypeCode}" in ${currencyCode}`,
        });
        continue;
      }

      const purchaseTimeoutMinutesRaw = row.purchaseTimeoutMinutes?.trim();
      const terminalId = row.terminalId?.trim() || undefined;
      const acceptorCode = row.acceptorCode?.trim() || undefined;
      const needsPurchaseIn =
        !!purchaseTimeoutMinutesRaw || !!terminalId || !!acceptorCode;
      if (needsPurchaseIn && !walletType.allowPurchaseIn) {
        errors.push({
          row: rowNumber,
          message: `${walletTypeCode}/${currencyCode} does not accept purchases, so a purchase timeout, terminal id, or acceptor code is not applicable`,
        });
        continue;
      }
      let purchaseTimeoutSeconds: number | undefined;
      if (purchaseTimeoutMinutesRaw) {
        const minutes = Number(purchaseTimeoutMinutesRaw);
        if (!Number.isFinite(minutes) || minutes < 1) {
          errors.push({
            row: rowNumber,
            message: 'purchaseTimeoutMinutes must be a positive number',
          });
          continue;
        }
        purchaseTimeoutSeconds = Math.round(minutes * 60);
      }

      const restrictedCounterparties = row.restrictedCounterparties
        ? row.restrictedCounterparties
            .split(',')
            .map((e) => e.trim())
            .filter(Boolean)
        : [];
      if (
        restrictedCounterparties.length &&
        !restrictedCounterparties.every((e) => isEmail(e))
      ) {
        errors.push({
          row: rowNumber,
          message:
            'restrictedCounterparties must be a comma-separated list of emails',
        });
        continue;
      }

      try {
        await this.dataSource.transaction((manager) =>
          this.walletsService.createForUser(manager, owner.id, walletType.id, {
            purchaseTimeoutSeconds,
            restrictedCounterparties: restrictedCounterparties.length
              ? restrictedCounterparties
              : undefined,
            terminalId,
            acceptorCode,
          }),
        );
        created += 1;
      } catch (error) {
        errors.push({
          row: rowNumber,
          message: (error as Error).message || 'Failed to create this row',
        });
      }
    }

    return { totalRows: rows.length, created, errors };
  }
}
