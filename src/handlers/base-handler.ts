import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ApiClient } from '../api-client.js';
import { McpToolResponse } from '../types.js';

export type ProgressState = {
  token: string | number | undefined;
  last: number;
};

export abstract class BaseHandler {
  protected server: Server;
  protected apiClient: ApiClient;

  constructor(server: Server, apiClient: ApiClient) {
    this.server = server;
    this.apiClient = apiClient;
  }

  protected abstract handle(args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse>;

  protected sendProgress(
    progressToken: string | number | undefined,
    percentageComplete = 0
  ): void {
    if (progressToken === undefined) return;

    void this.server.notification({
      method: 'notifications/progress',
      params: {
        progressToken,
        progress: percentageComplete,
        total: 100,
      },
    }).catch(error => {
      console.error('Failed to send progress notification:', error);
    });
  }

  protected sendMonotonicProgress(state: ProgressState, percentageComplete = 0): void {
    if (state.token === undefined || percentageComplete <= state.last) return;

    state.last = percentageComplete;
    this.sendProgress(state.token, percentageComplete);
  }
}
