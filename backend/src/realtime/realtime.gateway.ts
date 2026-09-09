import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/entities/user.entity';
import {
  GlPostingCreatedEvent,
  InstallmentActivityEvent,
  RealtimeEvent,
  SettlementActivityEvent,
  TransactionCreatedEvent,
  TransactionStatusChangedEvent,
  WalletBalanceChangedEvent,
} from './events';

const ADMIN_LIVE_ROOM = 'admin-live';

// Pushes the events in ./events.ts to every connected admin. Auth mirrors
// AdminGuard + SectionGuard over REST: the JWT is verified with the same
// secret, the user is re-fetched from the DB on every connect attempt (not
// trusted from a role claim baked into the token), and a regular ADMIN
// additionally needs 'liveActivity' among their PanelRole permissions —
// SUPER_ADMIN bypasses that check. Re-checking on connect (rather than once
// at login) means revoking access takes effect on the client's next
// reconnect, consistent with how the REST guards behave per-request.
@WebSocketGateway({
  namespace: '/admin-live',
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private readonly server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) {
        client.disconnect(true);
        return;
      }
      const payload = this.jwtService.verify<{ sub: string }>(token);
      const user = await this.usersService.findById(payload.sub);
      if (!user) {
        client.disconnect(true);
        return;
      }
      const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;
      const isAdmin = user.role === UserRole.ADMIN;
      const hasSection =
        isSuperAdmin ||
        (isAdmin &&
          (user.panelRole?.permissions ?? []).includes('liveActivity'));
      if (!hasSection) {
        client.disconnect(true);
        return;
      }
      await client.join(ADMIN_LIVE_ROOM);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(): void {
    // Nothing to clean up — the shared room membership goes away with the
    // socket itself, and no per-connection state is tracked server-side.
  }

  @OnEvent(RealtimeEvent.TRANSACTION_CREATED)
  onTransactionCreated(payload: TransactionCreatedEvent): void {
    this.emit(RealtimeEvent.TRANSACTION_CREATED, payload);
  }

  @OnEvent(RealtimeEvent.TRANSACTION_STATUS_CHANGED)
  onTransactionStatusChanged(payload: TransactionStatusChangedEvent): void {
    this.emit(RealtimeEvent.TRANSACTION_STATUS_CHANGED, payload);
  }

  @OnEvent(RealtimeEvent.WALLET_BALANCE_CHANGED)
  onWalletBalanceChanged(payload: WalletBalanceChangedEvent): void {
    this.emit(RealtimeEvent.WALLET_BALANCE_CHANGED, payload);
  }

  @OnEvent(RealtimeEvent.GL_POSTING_CREATED)
  onGlPostingCreated(payload: GlPostingCreatedEvent): void {
    this.emit(RealtimeEvent.GL_POSTING_CREATED, payload);
  }

  @OnEvent(RealtimeEvent.SETTLEMENT_ACTIVITY)
  onSettlementActivity(payload: SettlementActivityEvent): void {
    this.emit(RealtimeEvent.SETTLEMENT_ACTIVITY, payload);
  }

  @OnEvent(RealtimeEvent.INSTALLMENT_ACTIVITY)
  onInstallmentActivity(payload: InstallmentActivityEvent): void {
    this.emit(RealtimeEvent.INSTALLMENT_ACTIVITY, payload);
  }

  private emit(event: RealtimeEvent, payload: unknown): void {
    if (!this.server) {
      // Gateway not yet initialized (e.g. an event fires before Nest
      // finishes bootstrapping) — drop it rather than throw, this is a
      // best-effort live feed, not a queue.
      this.logger.warn(`Dropped ${event}: server not initialized`);
      return;
    }
    this.server.to(ADMIN_LIVE_ROOM).emit(event, payload);
  }
}
