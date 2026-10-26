export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogPayload {
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
  timestamp: string;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export class Logger {
  private contextName: string;

  constructor(contextName: string) {
    this.contextName = contextName;
  }

  private format(level: LogLevel, message: string, context?: Record<string, any>, err?: unknown): string {
    const payload: LogPayload = {
      level,
      message: `[${this.contextName}] ${message}`,
      context,
      timestamp: new Date().toISOString(),
    };

    if (err instanceof Error) {
      payload.error = {
        name: err.name,
        message: err.message,
        stack: err.stack,
      };
    } else if (err) {
      payload.error = {
        name: 'UnknownError',
        message: String(err),
      };
    }

    return JSON.stringify(payload);
  }

  debug(message: string, context?: Record<string, any>): void {
    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(this.format('debug', message, context));
    }
  }

  info(message: string, context?: Record<string, any>): void {
    console.info(this.format('info', message, context));
  }

  warn(message: string, context?: Record<string, any>, err?: unknown): void {
    console.warn(this.format('warn', message, context, err));
  }

  error(message: string, context?: Record<string, any>, err?: unknown): void {
    console.error(this.format('error', message, context, err));
  }
}
