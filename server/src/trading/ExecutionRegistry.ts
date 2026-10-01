/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER-AUTHORITATIVE EXECUTION REGISTRY (T3C)
 * Records and indexes all fills (open executions and close executions).
 * Establishes strict separation: ORDER -> EXECUTION -> POSITION -> ACCOUNT/LEDGER.
 */

import { Execution } from '../types/trading';

export class ExecutionRegistry {
  private executions: Map<string, Execution> = new Map();
  private executionsByAccount: Map<string, Execution[]> = new Map();
  private executionsByOrder: Map<string, Execution[]> = new Map();
  private executionsByPosition: Map<string, Execution[]> = new Map();
  private nextExecutionId: number = 7000;

  public generateExecutionId(): string {
    return `exec_${++this.nextExecutionId}`;
  }

  public isDuplicate(executionId: string): boolean {
    return this.executions.has(executionId);
  }

  public recordExecution(execution: Execution): Execution {
    if (this.executions.has(execution.id)) {
      return this.executions.get(execution.id)!;
    }
    this.executions.set(execution.id, { ...execution });

    // Index by account
    let accList = this.executionsByAccount.get(execution.accountId);
    if (!accList) {
      accList = [];
      this.executionsByAccount.set(execution.accountId, accList);
    }
    accList.push({ ...execution });

    // Index by order if present
    if (execution.orderId) {
      let ordList = this.executionsByOrder.get(execution.orderId);
      if (!ordList) {
        ordList = [];
        this.executionsByOrder.set(execution.orderId, ordList);
      }
      ordList.push({ ...execution });
    }

    // Index by position if present
    if (execution.positionId) {
      let posList = this.executionsByPosition.get(execution.positionId);
      if (!posList) {
        posList = [];
        this.executionsByPosition.set(execution.positionId, posList);
      }
      posList.push({ ...execution });
    }

    return execution;
  }

  public getExecution(id: string): Execution | undefined {
    return this.executions.get(id);
  }

  public getExecutionsForAccount(accountId: string): Execution[] {
    return (this.executionsByAccount.get(accountId) || []).slice().sort((a, b) => b.timestamp - a.timestamp);
  }

  public getExecutionsForOrder(orderId: string): Execution[] {
    return (this.executionsByOrder.get(orderId) || []).slice();
  }

  public getExecutionsForPosition(positionId: string): Execution[] {
    return (this.executionsByPosition.get(positionId) || []).slice();
  }

  public getAllExecutions(): Execution[] {
    return Array.from(this.executions.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  public getExecutionCount(): number {
    return this.executions.size;
  }

  public hydrateExecutions(executions: Execution[]): void {
    for (const exec of executions) {
      this.recordExecution(exec);
    }
  }
}
