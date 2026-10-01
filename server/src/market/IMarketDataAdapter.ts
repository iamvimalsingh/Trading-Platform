/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MARKET DATA ADAPTER CONTRACT (STEP 4)
 * Provider-agnostic interface enabling multi-asset integration of external market feeds
 * (FX, Metals, Crypto, Indices) without tight coupling to any specific provider.
 */

import { NormalizedInternalQuote, ProviderStatusInfo } from '../types/marketData';

export type QuoteListener = (quote: NormalizedInternalQuote) => void;

export interface IMarketDataAdapter {
  readonly providerId: string;
  readonly providerName: string;

  /**
   * Starts the provider connection / lifecycle.
   */
  start(): Promise<void> | void;

  /**
   * Stops the provider connection cleanly.
   */
  stop(): Promise<void> | void;

  /**
   * Connect to upstream feed (alias/companion to start).
   */
  connect?(): Promise<void> | void;

  /**
   * Disconnect from upstream feed (alias/companion to stop).
   */
  disconnect?(): Promise<void> | void;

  /**
   * Subscribes to quotes for a list of canonical symbols.
   */
  subscribe(symbols: string[]): void;

  /**
   * Unsubscribes from quotes for a list of canonical symbols.
   */
  unsubscribe(symbols: string[]): void;

  /**
   * Returns current health, connection state, and metadata.
   */
  getStatus(): ProviderStatusInfo;

  /**
   * Returns whether the provider is currently connected and healthy.
   */
  isHealthy(): boolean;

  /**
   * Pure/adapter normalization from raw provider payload to canonical quote.
   */
  normalizeQuote?(rawPayload: unknown): NormalizedInternalQuote;

  /**
   * Registers a listener for normalized quote emissions from this provider.
   */
  onQuote(listener: QuoteListener): () => void;
}
