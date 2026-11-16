import type * as vscode from "vscode";
import type { PlotState, WorkbookState } from "../shared/messages";

const KEY = "csvPlot.states";
/** Number of files whose choices are remembered (most recently used first). */
const LIMIT = 200;

type State = PlotState | WorkbookState;
type Entry = [uri: string, state: State];

/** Remembers the user's choices per file, across workspaces and restarts. */
export class StateStore {
  constructor(private readonly memento: vscode.Memento) {}

  get<T extends State>(uri: vscode.Uri): T {
    const entries = this.memento.get<Entry[]>(KEY, []);
    return (entries.find(([u]) => u === uri.toString())?.[1] ?? {}) as T;
  }

  async set(uri: vscode.Uri, state: State): Promise<void> {
    const key = uri.toString();
    const entries = this.memento.get<Entry[]>(KEY, []).filter(([u]) => u !== key);
    entries.unshift([key, state]);
    await this.memento.update(KEY, entries.slice(0, LIMIT));
  }
}
