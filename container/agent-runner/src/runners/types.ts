export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  script?: string;
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

export interface RunnerOptions {
  prompt: string;
  sessionId?: string;
  containerInput: ContainerInput;
  mcpServerPath: string;
  sdkEnv: Record<string, string | undefined>;
  resumeAt?: string;
  onOutput: (output: ContainerOutput) => void;
  shouldClose: () => boolean;
  drainIpcInput: () => string[];
  log: (msg: string) => void;
}

export interface RunnerResult {
  newSessionId?: string;
  lastAssistantUuid?: string;
  closedDuringQuery: boolean;
}
