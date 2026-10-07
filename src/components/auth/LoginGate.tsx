/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * WEBTRADER ACCESS GATE
 * Provides gated authentication entry for direct WebTrader visits:
 * 1. Direct Trading Account login (account number + trading password)
 * 2. Login with Demo (DEMO-1001 canonical runtime)
 * 3. Shows informative errors for expired CRM sessions or failed credentials
 */

import React, { useState } from 'react';
import { useTradingStore } from '../../store/useTradingStore';
import {
  Lock,
  User,
  LogIn,
  Play,
  AlertTriangle,
  ShieldAlert,
  Loader2,
  Sun,
  Moon,
  Activity,
} from 'lucide-react';

export function LoginGate() {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const sessionAuthState = useTradingStore((state) => state.sessionAuthState);
  const sessionAuthError = useTradingStore((state) => state.sessionAuthError);
  const socketStatus = useTradingStore((state) => state.socketStatus);
  const theme = useTradingStore((state) => state.theme);
  const toggleTheme = useTradingStore((state) => state.toggleTheme);
  const loginTradingAccount = useTradingStore((state) => state.loginTradingAccount);
  const loginWithDemo = useTradingStore((state) => state.loginWithDemo);

  const isAuthenticating = sessionAuthState === 'TRADING_ACCOUNT_AUTHENTICATING';

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    const trimmedLogin = loginId.trim();
    const trimmedPass = password.trim();

    if (!trimmedLogin) {
      setLocalError('Please enter your Login ID or Account Number');
      return;
    }
    if (!trimmedPass) {
      setLocalError('Please enter your Trading Password');
      return;
    }

    try {
      await loginTradingAccount(trimmedLogin, trimmedPass);
    } catch (err: any) {
      setLocalError(err?.message || 'Login failed. Please check credentials.');
    }
  };

  const handleDemoClick = () => {
    setLocalError(null);
    loginWithDemo();
  };

  // Resolve current active error to display
  const activeError = localError || sessionAuthError || (
    sessionAuthState === 'EXTERNAL_EXPIRED'
      ? 'CRM Session Expired: Your launch session has expired. Please log in with your Trading Account or relaunch from your CRM panel.'
      : sessionAuthState === 'EXTERNAL_ERROR'
      ? 'CRM Launch Authentication Failed: Unable to verify launch token. Please log in directly or relaunch from CRM.'
      : null
  );

  return (
    <div className="min-h-screen min-h-[100dvh] w-screen flex flex-col items-center justify-center p-4 sm:p-6 bg-slate-100 dark:bg-zinc-950 text-slate-900 dark:text-zinc-100 select-none transition-colors">
      {/* Top Utility Bar */}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="p-2 rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 shadow-sm transition-colors cursor-pointer"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
        </button>
      </div>

      {/* Main Login Card */}
      <div className="w-full max-w-md bg-white dark:bg-zinc-900/90 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-xl shadow-slate-200/50 dark:shadow-black/50 p-6 sm:p-8 backdrop-blur-sm">
        {/* Header & Branding */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600 text-white font-bold text-lg mb-3 shadow-md shadow-blue-500/25">
            TT
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-zinc-100 uppercase">
            WEB TRADING
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-zinc-400 mt-1 font-medium">
            Trading Account Login
          </p>
        </div>

        {/* Informative Error / Session Notice */}
        {activeError && (
          <div className="mb-5 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800/80 text-rose-700 dark:text-rose-300 text-xs font-medium flex items-start gap-2.5 animate-in fade-in duration-150">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
            <div className="flex-1 leading-relaxed">
              {activeError}
            </div>
          </div>
        )}

        {/* Credentials Form */}
        <form onSubmit={handleLoginSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-1.5">
              Login ID / Account Number
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-zinc-500">
                <User className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                placeholder="Account Number (e.g. 20183235)"
                disabled={isAuthenticating}
                autoComplete="username"
                className="w-full pl-9 pr-3 py-2.5 text-sm bg-slate-50 dark:bg-zinc-950 border border-slate-300 dark:border-zinc-800 rounded-lg text-slate-900 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-colors disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-1.5">
              Trading Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-zinc-500">
                <Lock className="w-4 h-4" />
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={isAuthenticating}
                autoComplete="current-password"
                className="w-full pl-9 pr-3 py-2.5 text-sm bg-slate-50 dark:bg-zinc-950 border border-slate-300 dark:border-zinc-800 rounded-lg text-slate-900 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-colors disabled:opacity-50"
              />
            </div>
          </div>

          {/* Primary Login Button */}
          <button
            type="submit"
            disabled={isAuthenticating}
            className="w-full mt-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:bg-blue-600/50 text-white font-semibold text-sm rounded-lg shadow-md shadow-blue-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
          >
            {isAuthenticating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>AUTHENTICATING...</span>
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                <span>LOGIN</span>
              </>
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200 dark:border-zinc-800" />
          </div>
          <div className="relative flex justify-center text-xs uppercase font-semibold">
            <span className="bg-white dark:bg-zinc-900 px-3 text-slate-400 dark:text-zinc-500">
              OR
            </span>
          </div>
        </div>

        {/* Demo Button */}
        <button
          type="button"
          onClick={handleDemoClick}
          disabled={isAuthenticating}
          className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800/80 dark:hover:bg-zinc-800 text-slate-800 dark:text-zinc-200 font-semibold text-sm rounded-lg border border-slate-300 dark:border-zinc-700/80 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed group"
        >
          <Play className="w-4 h-4 text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform" />
          <span>LOGIN WITH DEMO</span>
        </button>

        {/* Footer Info */}
        <div className="mt-6 pt-4 border-t border-slate-100 dark:border-zinc-800/60 flex items-center justify-between text-[11px] text-slate-400 dark:text-zinc-500 font-mono">
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-blue-500" />
            <span>Trading Engine Runtime</span>
          </div>
          <div className="flex items-center gap-1">
            <span
              className={`w-2 h-2 rounded-full ${
                socketStatus === 'CONNECTED'
                  ? 'bg-emerald-500'
                  : socketStatus === 'CONNECTING'
                  ? 'bg-amber-500 animate-pulse'
                  : 'bg-rose-500'
              }`}
            />
            <span className="capitalize">{socketStatus.toLowerCase()}</span>
          </div>
        </div>
      </div>

      {/* Security Note */}
      <div className="mt-4 text-center text-xs text-slate-400 dark:text-zinc-500 max-w-sm">
        Authoritative trading platform session. Direct logins authenticated against broker server.
      </div>
    </div>
  );
}
