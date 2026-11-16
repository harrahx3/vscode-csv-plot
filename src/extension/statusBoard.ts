import type * as vscode from "vscode";
import type { ViewStatus } from "../shared/messages";

/** Last status reported by each graph view, by file URI (read by the integration tests). */
export class StatusBoard {
  private readonly statuses = new Map<string, ViewStatus>();

  set(uri: vscode.Uri, status: ViewStatus): void {
    this.statuses.set(uri.toString(), status);
  }

  get(uri: vscode.Uri): ViewStatus | undefined {
    return this.statuses.get(uri.toString());
  }
}
