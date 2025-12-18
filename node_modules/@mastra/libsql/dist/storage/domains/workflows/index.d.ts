import type { Client } from '@libsql/client';
import type { StorageListWorkflowRunsInput, WorkflowRun, WorkflowRuns } from '@mastra/core/storage';
import { WorkflowsStorage } from '@mastra/core/storage';
import type { WorkflowRunState, StepResult } from '@mastra/core/workflows';
import type { StoreOperationsLibSQL } from '../operations/index.js';
export declare class WorkflowsLibSQL extends WorkflowsStorage {
    operations: StoreOperationsLibSQL;
    client: Client;
    private readonly maxRetries;
    private readonly initialBackoffMs;
    constructor({ operations, client, maxRetries, initialBackoffMs, }: {
        operations: StoreOperationsLibSQL;
        client: Client;
        maxRetries?: number;
        initialBackoffMs?: number;
    });
    private setupPragmaSettings;
    private executeWithRetry;
    updateWorkflowResults({ workflowName, runId, stepId, result, runtimeContext, }: {
        workflowName: string;
        runId: string;
        stepId: string;
        result: StepResult<any, any, any, any>;
        runtimeContext: Record<string, any>;
    }): Promise<Record<string, StepResult<any, any, any, any>>>;
    updateWorkflowState({ workflowName, runId, opts, }: {
        workflowName: string;
        runId: string;
        opts: {
            status: string;
            result?: StepResult<any, any, any, any>;
            error?: string;
            suspendedPaths?: Record<string, number[]>;
            waitingPaths?: Record<string, number[]>;
        };
    }): Promise<WorkflowRunState | undefined>;
    persistWorkflowSnapshot({ workflowName, runId, resourceId, snapshot, }: {
        workflowName: string;
        runId: string;
        resourceId?: string;
        snapshot: WorkflowRunState;
    }): Promise<void>;
    loadWorkflowSnapshot({ workflowName, runId, }: {
        workflowName: string;
        runId: string;
    }): Promise<WorkflowRunState | null>;
    getWorkflowRunById({ runId, workflowName, }: {
        runId: string;
        workflowName?: string;
    }): Promise<WorkflowRun | null>;
    getWorkflowRuns({ workflowName, fromDate, toDate, limit, offset, resourceId, status, }?: StorageListWorkflowRunsInput): Promise<WorkflowRuns>;
}
//# sourceMappingURL=index.d.ts.map