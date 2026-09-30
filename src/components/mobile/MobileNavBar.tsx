/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MOBILE BOTTOM NAVIGATION BAR
 * 5 distinct trading surfaces with comfortable 48px+ touch targets and safe-area padding.
 */

import React from 'react';
import {
  ArrowLeftRight,
  BarChart2,
  Briefcase,
  History,
  List,
} from 'lucide-react';
import { useTradingStore } from '../../store/useTradingStore';

export const MobileNavBar: React.FC = () => {
  const mobileTab = useTradingStore((state) => state.mobileTab);
  const setMobileTab = useTradingStore((state) => state.setMobileTab);
  const openPositionsCount = useTradingStore(
    (state) => state.positions.filter((p) => p.status === 'OPEN').length
  );

  const tabs = [
    { id: 'quotes' as const, label: 'Quotes', icon: List },
    { id: 'chart' as const, label: 'Chart', icon: BarChart2 },
    { id: 'trade' as const, label: 'Trade', icon: ArrowLeftRight, highlight: true },
    { id: 'positions' as const, label: 'Positions', icon: Briefcase, badge: openPositionsCount },
    { id: 'history' as const, label: 'History', icon: History },
  ];

  return (
    <nav className="h-14 shrink-0 bg-zinc-950/95 backdrop-blur border-t border-zinc-800/80 flex items-stretch justify-around select-none z-30 pb-[env(safe-area-inset-bottom,0px)]">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = mobileTab === tab.id;

        return (
          <button
            key={tab.id}
            onClick={() => setMobileTab(tab.id)}
            className={`flex-1 flex flex-col items-center justify-center gap-1 min-h-[48px] cursor-pointer transition-colors relative ${
              isActive
                ? 'text-blue-400 font-semibold'
                : 'text-zinc-400 hover:text-zinc-200 active:text-zinc-100'
            }`}
          >
            {/* Active Top Glow Line */}
            {isActive && (
              <span className="absolute top-0 left-2 right-2 h-0.5 bg-blue-500 rounded-full shadow-sm shadow-blue-500/50" />
            )}

            <div className="relative">
              <Icon
                className={`w-5 h-5 transition-transform ${
                  isActive ? 'scale-110' : ''
                } ${tab.highlight && !isActive ? 'text-amber-400' : ''}`}
              />

              {/* Positions Count Badge */}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="absolute -top-1.5 -right-3 min-w-[16px] h-4 px-1 rounded-full bg-blue-600 text-white text-[10px] font-mono font-bold flex items-center justify-center">
                  {tab.badge}
                </span>
              )}
            </div>

            <span className="text-[10px] tracking-tight">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
