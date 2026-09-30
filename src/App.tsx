/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { TerminalHeader } from './components/layout/TerminalHeader';
import { WatchlistPanel } from './components/watchlist/WatchlistPanel';
import { ChartContainer } from './components/chart/ChartContainer';
import { OrderTicket } from './components/order/OrderTicket';
import { PositionsTable } from './components/positions/PositionsTable';
import { TradeHistoryTable } from './components/positions/TradeHistoryTable';
import { PerformanceLabModal } from './components/benchmark/PerformanceLabModal';
import { MobileNavBar } from './components/mobile/MobileNavBar';
import { MobileAccountDrawer } from './components/mobile/MobileAccountDrawer';
import { MobileQuotesView } from './components/mobile/MobileQuotesView';
import { MobileChartView } from './components/mobile/MobileChartView';
import { MobileTradeView } from './components/mobile/MobileTradeView';
import { MobilePositionsView } from './components/mobile/MobilePositionsView';
import { MobileHistoryView } from './components/mobile/MobileHistoryView';
import { useTradingStore } from './store/useTradingStore';
import { tradingSocket } from './services/tradingSocket';
import { ChevronDown, ChevronUp, Maximize2, Minimize2 } from 'lucide-react';

export default function App() {
  const activeTab = useTradingStore((state) => state.activeTab);
  const setActiveTab = useTradingStore((state) => state.setActiveTab);
  const mobileTab = useTradingStore((state) => state.mobileTab);
  const isPerfLabOpen = useTradingStore((state) => state.isPerfLabOpen);
  const theme = useTradingStore((state) => state.theme);
  const openPositionsCount = useTradingStore(
    (state) => state.positions.filter((p) => p.status === 'OPEN').length
  );
  const ordersCount = useTradingStore((state) => state.orders.length);
  const closedCount = useTradingStore((state) => state.closedTrades.length);

  // Sync theme class on document element and body
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
        if (document.body) document.body.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
        if (document.body) document.body.classList.remove('dark');
      }
    }
  }, [theme]);

  // Desktop Bottom Trading Dock Resizing & Layout State
  const [dockHeight, setDockHeight] = useState<number>(() => {
    if (typeof window === 'undefined') return 200;
    try {
      const saved = sessionStorage.getItem('trading_terminal_dock_height');
      if (saved) {
        const val = parseInt(saved, 10);
        if (!isNaN(val) && val >= 120 && val <= 600) return val;
      }
    } catch {
      // Fallback
    }
    return typeof window !== 'undefined' && window.innerHeight <= 768 ? 180 : 220;
  });

  const [isDockCollapsed, setIsDockCollapsed] = useState<boolean>(false);
  const [isDockMaximized, setIsDockMaximized] = useState<boolean>(false);
  const [preMaximizeHeight, setPreMaximizeHeight] = useState<number>(dockHeight);
  const [isDraggingDock, setIsDraggingDock] = useState<boolean>(false);

  const startYRef = useRef<number>(0);
  const startHeightRef = useRef<number>(dockHeight);

  const handleStartResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingDock(true);
    if (isDockCollapsed) setIsDockCollapsed(false);
    if (isDockMaximized) setIsDockMaximized(false);
    startYRef.current = e.clientY;
    startHeightRef.current = dockHeight;
  };

  useEffect(() => {
    if (!isDraggingDock) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = startYRef.current - e.clientY;
      const minH = 130;
      const maxH = Math.floor(window.innerHeight * 0.65);
      const newHeight = Math.max(minH, Math.min(maxH, startHeightRef.current + deltaY));
      setDockHeight(newHeight);
      try {
        sessionStorage.setItem('trading_terminal_dock_height', String(newHeight));
      } catch {
        // Ignore storage errors
      }
    };

    const handleMouseUp = () => {
      setIsDraggingDock(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingDock]);

  const toggleDockCollapse = () => {
    if (isDockMaximized) setIsDockMaximized(false);
    setIsDockCollapsed((prev) => !prev);
  };

  const toggleDockMaximize = () => {
    if (isDockCollapsed) setIsDockCollapsed(false);
    if (isDockMaximized) {
      setIsDockMaximized(false);
      setDockHeight(preMaximizeHeight);
    } else {
      setPreMaximizeHeight(dockHeight);
      setIsDockMaximized(true);
      const maxH = Math.min(520, Math.floor(window.innerHeight * 0.58));
      setDockHeight(maxH);
    }
  };

  const handleTabClick = (tab: typeof activeTab) => {
    setActiveTab(tab);
    if (isDockCollapsed) {
      setIsDockCollapsed(false);
    }
  };

  // Initialize and run server-authoritative WebSocket session
  useEffect(() => {
    tradingSocket.connect();

    const unsubStatus = tradingSocket.onStatusChange((status) => {
      useTradingStore.getState().setSocketStatus(status);
    });

    const unsubSession = tradingSocket.onSessionReady((data) => {
      useTradingStore.getState().initSessionFromSocket(data);
    });

    const unsubQuotes = tradingSocket.onQuotes((quotes) => {
      useTradingStore.getState().updateQuotesBatch(quotes);
    });

    const unsubAccount = tradingSocket.onAccountState((account) => {
      useTradingStore.getState().setAccountState(account);
    });

    const unsubPosUpdate = tradingSocket.onPositionUpdate((position) => {
      useTradingStore.getState().updatePosition(position);
    });

    const unsubPosClosed = tradingSocket.onPositionClosed(({ position, ledgerEntry }) => {
      useTradingStore.getState().handlePositionClosed(position, ledgerEntry);
    });

    const unsubOrderAck = tradingSocket.onOrderAck((result) => {
      useTradingStore.getState().handleOrderAck(result);
    });

    const unsubOrderUpdate = tradingSocket.onOrderUpdate((order) => {
      useTradingStore.getState().handleOrderUpdate(order);
    });

    const unsubExecution = tradingSocket.onExecution((execution) => {
      useTradingStore.getState().recordExecution(execution);
    });

    return () => {
      unsubStatus();
      unsubSession();
      unsubQuotes();
      unsubAccount();
      unsubPosUpdate();
      unsubPosClosed();
      unsubOrderAck();
      unsubOrderUpdate();
      unsubExecution();
      tradingSocket.disconnect();
    };
  }, []);

  // FPS Monitor via requestAnimationFrame (runs once on mount, no reactive re-renders)
  useEffect(() => {
    let frameCount = 0;
    let lastTime = performance.now();
    let animId: number;

    const measureLoop = (currentTime: number) => {
      frameCount++;
      if (currentTime - lastTime >= 1000) {
        const measuredFps = Math.round((frameCount * 1000) / (currentTime - lastTime));
        useTradingStore.getState().updateFps(measuredFps);
        frameCount = 0;
        lastTime = currentTime;
      }
      animId = requestAnimationFrame(measureLoop);
    };

    animId = requestAnimationFrame(measureLoop);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div
      data-theme={theme}
      className={`flex flex-col h-screen h-[100dvh] w-screen overflow-hidden bg-slate-100 dark:bg-zinc-950 text-slate-900 dark:text-zinc-100 font-sans select-none transition-colors ${
        theme === 'dark' ? 'dark' : ''
      }`}
    >
      {/* 1. Top Header with Live Real-time Balance / Equity / Free Margin */}
      <TerminalHeader />

      {/* ================================================================= */}
      {/* MOBILE COMPOSITION (< lg breakpoint)                             */}
      {/* Single-screen trading surface driven by bottom navigation bar      */}
      {/* ================================================================= */}
      <div className="flex-1 flex flex-col overflow-hidden lg:hidden min-h-0">
        {mobileTab === 'quotes' && <MobileQuotesView />}
        <div className={`flex-1 h-full w-full min-h-0 ${mobileTab === 'chart' ? 'flex flex-col' : 'hidden'}`}>
          <MobileChartView />
        </div>
        {mobileTab === 'trade' && <MobileTradeView />}
        {mobileTab === 'positions' && <MobilePositionsView />}
        {mobileTab === 'history' && <MobileHistoryView />}
      </div>

      {/* Mobile Bottom Navigation (Visible strictly on < lg) */}
      <div className="lg:hidden shrink-0">
        <MobileNavBar />
      </div>

      {/* Mobile Account Details Drawer / Sheet */}
      <MobileAccountDrawer />

      {/* ================================================================= */}
      {/* DESKTOP COMPOSITION (>= lg breakpoint)                            */}
      {/* Fully preserved 3-column workspace with bottom execution dock     */}
      {/* ================================================================= */}
      <div className="hidden lg:flex flex-1 flex-col overflow-hidden min-h-0">
        {/* 2. Middle Trading Workspace (Watchlist + Chart + Order Ticket) */}
        <div className="flex-1 flex overflow-hidden border-b border-slate-200 dark:border-zinc-800/80 min-h-0">
          {/* Left: Watchlist & Symbol Selector */}
          <aside className="w-64 xl:w-72 shrink-0 h-full">
            <WatchlistPanel />
          </aside>

          {/* Center: Dynamic Lightweight Chart Engine */}
          <main className="flex-1 h-full min-w-0">
            <ChartContainer />
          </main>

          {/* Right: Quick Buy/Sell Order Ticket */}
          <aside className="w-72 xl:w-80 shrink-0 h-full border-l border-slate-200 dark:border-zinc-800/80">
            <OrderTicket />
          </aside>
        </div>

        {/* Resize Divider Handle between Middle Workspace and Bottom Dock */}
        <div
          onMouseDown={handleStartResize}
          className={`h-1.5 shrink-0 bg-slate-200 dark:bg-zinc-900 hover:bg-blue-500 active:bg-blue-600 transition-colors cursor-row-resize flex items-center justify-center group select-none relative z-10 border-t border-slate-200 dark:border-zinc-800/80 ${
            isDraggingDock ? 'bg-blue-500 shadow-md shadow-blue-500/30' : ''
          }`}
          title="Drag up/down to resize bottom trading dock"
        >
          <div className="w-10 h-0.5 rounded-full bg-slate-400 dark:bg-zinc-600 group-hover:bg-white transition-colors" />
        </div>

        {/* 3. Bottom Execution & Portfolio Management Dock */}
        <div
          style={{ height: isDockCollapsed ? 36 : dockHeight }}
          className={`shrink-0 flex flex-col bg-white dark:bg-zinc-950 ${
            isDraggingDock ? 'select-none transition-none' : 'transition-[height] duration-150'
          }`}
        >
          {/* Bottom Tab Bar */}
          <div className="h-9 px-3 sm:px-4 bg-slate-50 dark:bg-zinc-950 border-b border-slate-200 dark:border-zinc-800/80 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleTabClick('positions')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t transition-colors cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'positions'
                    ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-500'
                    : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                }`}
              >
                <span>Positions</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 font-mono">
                  {openPositionsCount}
                </span>
              </button>

              <button
                onClick={() => handleTabClick('orders')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t transition-colors cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'orders'
                    ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-500'
                    : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                }`}
              >
                <span>Orders</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 font-mono">
                  {ordersCount}
                </span>
              </button>

              <button
                onClick={() => handleTabClick('history')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t transition-colors cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'history'
                    ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-500'
                    : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                }`}
              >
                <span>Trade History</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 font-mono">
                  {closedCount}
                </span>
              </button>

              <button
                onClick={() => handleTabClick('benchmark')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t transition-colors cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'benchmark'
                    ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-500'
                    : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                }`}
              >
                <span>Account Ledger</span>
              </button>
            </div>

            {/* Right: Dock Window Controls (Collapse / Maximize) */}
            <div className="flex items-center gap-1">
              <button
                onClick={toggleDockCollapse}
                className="px-2 py-1 rounded-md hover:bg-slate-200 dark:hover:bg-zinc-800 text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 transition-colors cursor-pointer text-xs flex items-center gap-1"
                title={isDockCollapsed ? 'Expand panel' : 'Collapse panel'}
              >
                {isDockCollapsed ? (
                  <>
                    <ChevronUp className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span className="text-[10px] hidden sm:inline">Expand</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3.5 h-3.5" />
                    <span className="text-[10px] hidden sm:inline">Collapse</span>
                  </>
                )}
              </button>

              <button
                onClick={toggleDockMaximize}
                disabled={isDockCollapsed}
                className="px-2 py-1 rounded-md hover:bg-slate-200 dark:hover:bg-zinc-800 text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 transition-colors cursor-pointer text-xs flex items-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed"
                title={isDockMaximized ? 'Restore normal height' : 'Maximize panel'}
              >
                {isDockMaximized ? (
                  <>
                    <Minimize2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span className="text-[10px] hidden sm:inline">Restore</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span className="text-[10px] hidden sm:inline">Maximize</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Tab Content Display */}
          {!isDockCollapsed && (
            <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-950 min-h-0">
              {activeTab === 'positions' && <PositionsTable />}
              {activeTab === 'orders' && <TradeHistoryTable view="orders" />}
              {activeTab === 'history' && <TradeHistoryTable view="history" />}
              {activeTab === 'benchmark' && <TradeHistoryTable view="ledger" />}
            </div>
          )}
        </div>
      </div>

      {/* 4. Performance Spike & Diagnostic Modal */}
      {isPerfLabOpen && <PerformanceLabModal />}
    </div>
  );
}
