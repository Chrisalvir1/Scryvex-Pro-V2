export interface PluginRuntime {
  name: string;
  version: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export class BaseRuntime implements PluginRuntime {
  constructor(public name: string, public version: string) {}
  async start(): Promise<void> { console.log(`[${this.name}] started v${this.version}`); }
  async stop(): Promise<void> { console.log(`[${this.name}] stopped`); }
}
