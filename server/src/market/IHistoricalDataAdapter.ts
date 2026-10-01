/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * STEP 6 — HISTORICAL DATA ADAPTER INTERFACE
 * Provider-agnostic contract for external historical OHLC feeds (e.g. Tiingo REST API, LP historical servers).
 */

import { HistoricalDataRequest, HistoricalDataResponse } from '../types/marketData';

export interface IHistoricalDataAdapter {
  readonly providerId: string;
  readonly providerName: string;
  readonly isRealProvider: boolean;

  /**
   * Returns true if this adapter supports historical data for the canonical symbol.
   */
  supportsSymbol(symbol: string): boolean;

  /**
   * Fetches and normalizes historical OHLC bars for the requested symbol and timeframe.
   */
  fetchHistoricalBars(request: HistoricalDataRequest): Promise<HistoricalDataResponse>;
}
