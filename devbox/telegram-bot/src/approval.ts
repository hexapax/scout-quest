import * as fs from "fs";
import * as path from "path";
import TelegramBot from "node-telegram-bot-api";

const APPROVAL_DIR = "/tmp/claude-approvals";
const POLL_INTERVAL_MS = 1000;

interface ApprovalRequest {
  uuid: string;
  tool_name: string;
  command: string;
  timestamp: string;
}

interface PendingApproval {
  request: ApprovalRequest;
  messageId: number;
}

/**
 * Watches for permission-gate.sh approval request files and forwards them
 * to Telegram as inline keyboard messages. Writes response files when the
 * user taps Approve/Deny.
 */
export class ApprovalManager {
  private bot: TelegramBot;
  private chatId: string;
  private pending: Map<string, PendingApproval> = new Map();
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(bot: TelegramBot, chatId: string) {
    this.bot = bot;
    this.chatId = chatId;
  }

  /**
   * Start watching for approval request files.
   */
  start(): void {
    // Ensure directory exists
    if (!fs.existsSync(APPROVAL_DIR)) {
      fs.mkdirSync(APPROVAL_DIR, { recursive: true });
    }

    // Clean up stale requests from previous runs
    this.cleanupStale();

    // Poll for new .request files
    this.pollTimer = setInterval(() => this.pollRequests(), POLL_INTERVAL_MS);
    console.log(`ApprovalManager: watching ${APPROVAL_DIR}`);
  }

  /**
   * Stop watching.
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Handle a callback query from an inline keyboard button.
   */
  async handleCallback(query: TelegramBot.CallbackQuery): Promise<void> {
    const data = query.data;
    if (!data) return;

    // Format: approve:{uuid} or deny:{uuid} or details:{uuid}
    const [action, uuid] = data.split(":");
    const pending = this.pending.get(uuid);

    if (!pending) {
      await this.bot.answerCallbackQuery(query.id, {
        text: "Request expired or already handled.",
      });
      return;
    }

    if (action === "details") {
      // Show full command details
      await this.bot.answerCallbackQuery(query.id);
      await this.bot.sendMessage(
        this.chatId,
        `📋 *Full command:*\n\`\`\`\n${escapeMarkdown(pending.request.command)}\n\`\`\``,
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (action === "approve" || action === "deny") {
      const decision = action;
      const responseFile = path.join(APPROVAL_DIR, `${uuid}.response`);

      // Write response file for the hook to read
      fs.writeFileSync(
        responseFile,
        JSON.stringify({
          decision,
          reason: decision === "deny" ? "Denied by human via Telegram" : undefined,
          timestamp: new Date().toISOString(),
        })
      );

      // Update the Telegram message
      const emoji = decision === "approve" ? "✅" : "❌";
      const label = decision === "approve" ? "Approved" : "Denied";

      await this.bot.editMessageText(
        `${emoji} *${label}*\n\`${truncate(pending.request.command, 100)}\``,
        {
          chat_id: this.chatId,
          message_id: pending.messageId,
          parse_mode: "Markdown",
        }
      );

      await this.bot.answerCallbackQuery(query.id, {
        text: `${label}!`,
      });

      this.pending.delete(uuid);
    }
  }

  /**
   * Poll the approval directory for new .request files.
   */
  private async pollRequests(): Promise<void> {
    try {
      const files = fs.readdirSync(APPROVAL_DIR);
      for (const file of files) {
        if (!file.endsWith(".request")) continue;

        const uuid = file.replace(".request", "");
        if (this.pending.has(uuid)) continue; // Already sent to Telegram

        const filePath = path.join(APPROVAL_DIR, file);
        const content = fs.readFileSync(filePath, "utf-8");

        let request: ApprovalRequest;
        try {
          request = JSON.parse(content);
        } catch {
          continue; // Malformed request
        }

        // Send approval message to Telegram
        const msg = await this.bot.sendMessage(
          this.chatId,
          `⚠️ *Permission Required*\n\n` +
            `Tool: \`${escapeMarkdown(request.tool_name)}\`\n` +
            `Command: \`${escapeMarkdown(truncate(request.command, 200))}\``,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "✅ Approve",
                    callback_data: `approve:${uuid}`,
                  },
                  {
                    text: "❌ Deny",
                    callback_data: `deny:${uuid}`,
                  },
                  {
                    text: "📋 Details",
                    callback_data: `details:${uuid}`,
                  },
                ],
              ],
            },
          }
        );

        this.pending.set(uuid, {
          request,
          messageId: msg.message_id,
        });
      }
    } catch (err) {
      // Don't crash on poll errors
      console.error("ApprovalManager poll error:", err);
    }
  }

  /**
   * Remove stale request/response files from previous sessions.
   */
  private cleanupStale(): void {
    try {
      const files = fs.readdirSync(APPROVAL_DIR);
      for (const file of files) {
        if (file.endsWith(".request") || file.endsWith(".response")) {
          fs.unlinkSync(path.join(APPROVAL_DIR, file));
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.substring(0, maxLen) + "...";
}

function escapeMarkdown(s: string): string {
  return s.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}
