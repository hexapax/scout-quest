import { ChildProcess, spawn } from "child_process";
import { EventEmitter } from "events";
import * as readline from "readline";

export interface ClaudeEvent {
  type: "text" | "tool_use" | "tool_result" | "complete" | "error" | "status";
  content: string;
  raw?: any;
}

export interface ClaudeSession {
  process: ChildProcess;
  prompt: string;
  startTime: Date;
  events: EventEmitter;
}

/**
 * Manages Claude Code child processes.
 * Spawns `claude -p` with stream-json output and emits parsed events.
 */
export class ClaudeManager {
  private currentSession: ClaudeSession | null = null;
  private nvmNodePath: string;

  constructor() {
    // nvm installs node here on the VM
    this.nvmNodePath =
      process.env.NODE_PATH ||
      `/home/devuser/.nvm/versions/node/v24.0.0/bin`;
  }

  isRunning(): boolean {
    return this.currentSession !== null && !this.currentSession.process.killed;
  }

  getStatus(): string {
    if (!this.currentSession) {
      return "No active session";
    }
    const elapsed = Math.round(
      (Date.now() - this.currentSession.startTime.getTime()) / 1000
    );
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    return `Running (${mins}m ${secs}s)\nPrompt: ${this.currentSession.prompt.substring(0, 100)}...`;
  }

  /**
   * Spawn a new Claude Code session with the given prompt.
   * Returns an EventEmitter that fires ClaudeEvents.
   */
  run(prompt: string, workDir: string): EventEmitter {
    if (this.isRunning()) {
      const events = new EventEmitter();
      events.emit("event", {
        type: "error",
        content: "A session is already running. Use /stop first.",
      } as ClaudeEvent);
      return events;
    }

    const events = new EventEmitter();
    const claudePath = `${this.nvmNodePath}/claude`;

    // Don't pass ANTHROPIC_API_KEY — Claude Code uses OAuth login (Max plan)
    const { ANTHROPIC_API_KEY: _, ...cleanEnv } = process.env;

    const proc = spawn(
      claudePath,
      ["-p", prompt, "--output-format", "stream-json"],
      {
        cwd: workDir,
        env: {
          ...cleanEnv,
          PATH: `${this.nvmNodePath}:${cleanEnv.PATH}`,
        },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    this.currentSession = {
      process: proc,
      prompt,
      startTime: new Date(),
      events,
    };

    // Parse JSON stream from stdout (one JSON object per line)
    const rl = readline.createInterface({ input: proc.stdout! });

    rl.on("line", (line) => {
      try {
        const data = JSON.parse(line);
        const event = this.parseStreamEvent(data);
        if (event) {
          events.emit("event", event);
        }
      } catch {
        // Non-JSON line — emit as text
        if (line.trim()) {
          events.emit("event", {
            type: "text",
            content: line,
          } as ClaudeEvent);
        }
      }
    });

    // Capture stderr
    const stderrChunks: string[] = [];
    proc.stderr?.on("data", (chunk) => {
      stderrChunks.push(chunk.toString());
    });

    proc.on("close", (code) => {
      if (code === 0) {
        events.emit("event", {
          type: "complete",
          content: "Session completed successfully.",
        } as ClaudeEvent);
      } else {
        const stderr = stderrChunks.join("");
        events.emit("event", {
          type: "error",
          content: `Session exited with code ${code}${stderr ? `\n${stderr.substring(0, 500)}` : ""}`,
        } as ClaudeEvent);
      }
      this.currentSession = null;
      events.emit("done");
    });

    proc.on("error", (err) => {
      events.emit("event", {
        type: "error",
        content: `Failed to spawn Claude: ${err.message}`,
      } as ClaudeEvent);
      this.currentSession = null;
      events.emit("done");
    });

    return events;
  }

  /**
   * Kill the current Claude session.
   */
  stop(): string {
    if (!this.currentSession) {
      return "No active session to stop.";
    }
    this.currentSession.process.kill("SIGTERM");
    // Force kill after 5s if still alive
    setTimeout(() => {
      if (this.currentSession?.process && !this.currentSession.process.killed) {
        this.currentSession.process.kill("SIGKILL");
      }
    }, 5000);
    return "Stopping session...";
  }

  /**
   * Parse a stream-json event into a ClaudeEvent.
   */
  private parseStreamEvent(data: any): ClaudeEvent | null {
    // Claude Code stream-json format varies by message type
    switch (data.type) {
      case "assistant":
        // Text output from Claude
        if (data.message?.content) {
          const textParts = data.message.content
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text);
          if (textParts.length > 0) {
            return { type: "text", content: textParts.join("\n"), raw: data };
          }
        }
        return null;

      case "content_block_delta":
        if (data.delta?.type === "text_delta" && data.delta?.text) {
          return { type: "text", content: data.delta.text, raw: data };
        }
        return null;

      case "tool_use":
        const toolName = data.tool_name || data.name || "unknown";
        const toolInput =
          typeof data.tool_input === "string"
            ? data.tool_input
            : JSON.stringify(data.tool_input || data.input || {}, null, 2);
        return {
          type: "tool_use",
          content: `🔧 ${toolName}\n${truncate(toolInput, 300)}`,
          raw: data,
        };

      case "tool_result":
        const output =
          typeof data.output === "string"
            ? data.output
            : JSON.stringify(data.output || {});
        return {
          type: "tool_result",
          content: truncate(output, 200),
          raw: data,
        };

      case "result":
        // Final result
        const resultText =
          typeof data.result === "string"
            ? data.result
            : data.result?.text || JSON.stringify(data.result || {});
        return {
          type: "complete",
          content: truncate(resultText, 1000),
          raw: data,
        };

      case "error":
        return {
          type: "error",
          content: data.error?.message || JSON.stringify(data),
          raw: data,
        };

      default:
        // Skip unknown event types silently
        return null;
    }
  }
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.substring(0, maxLen) + "...";
}
