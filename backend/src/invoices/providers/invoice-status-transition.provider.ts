import { Injectable, BadRequestException } from '@nestjs/common';
import { InvoiceStatus } from '../enums/invoice-status.enum';

export interface StatusTransition {
  from: InvoiceStatus;
  to: InvoiceStatus;
}

/**
 * Allowed invoice lifecycle transitions keyed by the *current* state.
 * Anything not listed here is rejected. VOID is terminal.
 */
const VALID_TRANSITIONS: ReadonlyMap<InvoiceStatus, readonly InvoiceStatus[]> =
  new Map<InvoiceStatus, readonly InvoiceStatus[]>([
    [InvoiceStatus.PENDING, Object.freeze([InvoiceStatus.PAID, InvoiceStatus.VOID])],
    [InvoiceStatus.PAID, Object.freeze([InvoiceStatus.VOID])],
    [InvoiceStatus.VOID, Object.freeze([])],
  ]);

const KNOWN_STATUSES = new Set<string>(Object.values(InvoiceStatus));

@Injectable()
export class InvoiceStatusTransitionProvider {
  /**
   * Throws a BadRequestException unless `to` is reachable from the current
   * state `from`. Re-applying the current state is treated as an idempotent
   * no-op, but only for known statuses.
   */
  validateTransition(from: InvoiceStatus, to: InvoiceStatus): void {
    this.assertKnownStatus(from, 'current');
    this.assertKnownStatus(to, 'target');

    if (from === to) {
      return;
    }

    const allowed = this.getAllowedTransitions(from);
    if (!allowed.includes(to)) {
      throw new BadRequestException(
        `Invalid invoice status transition from ${from} to ${to}. Allowed: ${allowed.join(', ') || 'none'}`,
      );
    }
  }

  isValidTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
    if (!this.isKnownStatus(from) || !this.isKnownStatus(to)) return false;
    if (from === to) return true;
    return this.getAllowedTransitions(from).includes(to);
  }

  getAllowedTransitions(from: InvoiceStatus): InvoiceStatus[] {
    return [...(VALID_TRANSITIONS.get(from) ?? [])];
  }

  private isKnownStatus(status: unknown): status is InvoiceStatus {
    return typeof status === 'string' && KNOWN_STATUSES.has(status);
  }

  private assertKnownStatus(status: unknown, label: 'current' | 'target'): void {
    if (!this.isKnownStatus(status)) {
      throw new BadRequestException(
        `Unknown ${label} invoice status: ${String(status)}`,
      );
    }
  }
}
