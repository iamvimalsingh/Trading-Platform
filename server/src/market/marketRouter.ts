/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MARKET DATA HTTP ROUTER (STEP 6)
 * Server-authoritative REST endpoints for historical candle data and provider health status.
 */

import { Router, Request, Response } from 'express';
import { HistoricalMarketDataService } from './HistoricalMarketDataService';
import { HistoricalTimeframe } from '../types/marketData';
import { InstrumentRegistry } from './InstrumentRegistry';
import { TradingRuntime } from '../runtime/TradingRuntime';

export function createMarketRouter(
  historicalService: HistoricalMarketDataService,
  runtime?: TradingRuntime
): Router {
  const router = Router();
  const registry = InstrumentRegistry.getInstance();

  /**
   * GET /api/market/history
   * Retrieves server-authoritative historical OHLC bars.
   */
  router.get('/history', async (req: Request, res: Response) => {
    try {
      const symbol = (req.query.symbol as string)?.trim().toUpperCase() || 'EURUSD';
      const timeframe = ((req.query.timeframe as string)?.trim() || '1m') as HistoricalTimeframe;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 120;
      const from = req.query.from ? parseInt(req.query.from as string, 10) : undefined;
      const to = req.query.to ? parseInt(req.query.to as string, 10) : undefined;

      const response = await historicalService.getHistoricalBars({
        symbol,
        timeframe,
        limit,
        from,
        to,
      });

      res.json(response);
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to fetch historical market data',
        message: err?.message || 'Internal server error',
      });
    }
  });

  /**
   * GET /api/market/status
   * Returns authoritative status of providers, feeds, and instrument availability.
   */
  router.get('/status', (req: Request, res: Response) => {
    try {
      const symbols = registry.getAllSymbols().map((s) => {
        const liveQuote = runtime?.market?.getQuote(s.symbol);
        return {
          symbol: s.symbol,
          name: s.name,
          category: s.category,
          tradingStatus: s.tradingStatus,
          provider: s.marketDataProvider,
          hasLiveQuote: !!liveQuote,
          marketStatus: (liveQuote as any)?.marketStatus || (liveQuote ? 'LIVE' : 'WAITING_FOR_PROVIDER'),
        };
      });

      res.json({
        isRealMarketData: historicalService.isRealMarketData,
        totalSymbols: symbols.length,
        symbols,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to fetch market status' });
    }
  });

  /**
   * GET /api/market/symbols
   * Public list of canonical symbols.
   */
  router.get('/symbols', (_req: Request, res: Response) => {
    res.json(registry.getAllSymbols());
  });

  return router;
}
