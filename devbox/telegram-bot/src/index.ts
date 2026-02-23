import TelegramBot from "node-telegram-bot-api";
import { ClaudeManager, ClaudeEvent } from "./claude";
import { ApprovalManager } from "./approval";

// --- Configuration ---
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const WORK_DIR = process.env.WORK_DIR || "/home/devuser/scout-quest";

if (!BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN not set");
  process.exit(1);
}

if (!ADMIN_CHAT_ID) {
  console.error("TELEGRAM_ADMIN_CHAT_ID not set");
  process.exit(1);
}

// --- Initialize ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const claude = new ClaudeManager();
const approvals = new ApprovalManager(bot, ADMIN_CHAT_ID);

// Rate limiter for message batching (avoid Telegram flood limits)
const MESSAGE_BATCH_INTERVAL_MS = 2000;
let messageBatch: string[] = [];
let batchTimer: NodeJS.Timeout | null = null;

function queueMessage(text: string): void {
  messageBatch.push(text);
  if (!batchTimer) {
    batchTimer = setTimeout(flushMessages, MESSAGE_BATCH_INTERVAL_MS);
  }
}

async function flushMessages(): Promise<void> {
  batchTimer = null;
  if (messageBatch.length === 0) return;

  const combined = messageBatch.join("\n\n");
  messageBatch = [];

  // Telegram max message length is 4096
  const chunks = splitMessage(combined, 4000);
  for (const chunk of chunks) {
    try {
      await bot.sendMessage(ADMIN_CHAT_ID!, chunk, { parse_mode: "Markdown" });
    } catch (err) {
      // Retry without markdown if parse fails
      try {
        await bot.sendMessage(ADMIN_CHAT_ID!, chunk);
      } catch (retryErr) {
        console.error("Failed to send message:", retryErr);
      }
    }
  }
}

// --- Auth guard: only respond to admin ---
function isAdmin(msg: TelegramBot.Message): boolean {
  return msg.chat.id.toString() === ADMIN_CHAT_ID;
}

// --- /start ---
bot.onText(/\/start/, async (msg) => {
  if (!isAdmin(msg)) return;

  await bot.sendMessage(
    msg.chat.id,
    `🤖 *DevBox Ready*\n\n` +
      `Available commands:\n` +
      `• /run \\<prompt\\> — Start a Claude session\n` +
      `• /status — Check current session\n` +
      `• /stop — Kill running session\n` +
      `• /log — Show recent output\n` +
      `• /help — Show this message\n\n` +
      `Working directory: \`${WORK_DIR}\``,
    { parse_mode: "Markdown" }
  );
});

// --- /help ---
bot.onText(/\/help/, async (msg) => {
  if (!isAdmin(msg)) return;

  await bot.sendMessage(
    msg.chat.id,
    `🤖 *DevBox Commands*\n\n` +
      `*/run* \\<prompt\\> — Start a Claude Code session with the given prompt\\. ` +
      `Claude runs in the scout\\-quest repo with your hooks and permissions\\.\n\n` +
      `*/status* — Is Claude running? How long? What prompt?\n\n` +
      `*/stop* — Kill the running Claude session\\.\n\n` +
      `*/log* — Show the last few events from the current/last session\\.\n\n` +
      `When Claude needs permission for a risky operation, you'll get an inline keyboard with Approve/Deny buttons\\.`,
    { parse_mode: "MarkdownV2" }
  );
});

// --- /run <prompt> ---
bot.onText(/\/run (.+)/, async (msg, match) => {
  if (!isAdmin(msg)) return;

  const prompt = match![1];

  if (claude.isRunning()) {
    await bot.sendMessage(
      msg.chat.id,
      "⚠️ A session is already running. Use /stop first."
    );
    return;
  }

  await bot.sendMessage(
    msg.chat.id,
    `▶️ Starting Claude session...\n\`${prompt.substring(0, 200)}\``,
    { parse_mode: "Markdown" }
  );

  const recentLog: string[] = [];
  const events = claude.run(prompt, WORK_DIR);

  events.on("event", (event: ClaudeEvent) => {
    const entry = formatEvent(event);
    recentLog.push(entry);
    // Keep only last 50 events
    if (recentLog.length > 50) recentLog.shift();

    switch (event.type) {
      case "text":
        // Batch text output to avoid flood
        queueMessage(entry);
        break;

      case "tool_use":
        // Always show tool usage immediately
        flushMessages();
        bot
          .sendMessage(ADMIN_CHAT_ID!, entry)
          .catch((e) => console.error("send error:", e));
        break;

      case "tool_result":
        // Batch tool results
        queueMessage(`📄 ${event.content}`);
        break;

      case "complete":
        flushMessages();
        bot
          .sendMessage(ADMIN_CHAT_ID!, `✅ *Session complete*\n\n${event.content}`, {
            parse_mode: "Markdown",
          })
          .catch(() =>
            bot
              .sendMessage(ADMIN_CHAT_ID!, `✅ Session complete\n\n${event.content}`)
              .catch((e) => console.error("send error:", e))
          );
        break;

      case "error":
        flushMessages();
        bot
          .sendMessage(ADMIN_CHAT_ID!, `❌ *Error*\n\n${event.content}`, {
            parse_mode: "Markdown",
          })
          .catch(() =>
            bot
              .sendMessage(ADMIN_CHAT_ID!, `❌ Error\n\n${event.content}`)
              .catch((e) => console.error("send error:", e))
          );
        break;
    }
  });

  // Store log reference for /log command
  (global as any).__recentLog = recentLog;
});

// --- /status ---
bot.onText(/\/status/, async (msg) => {
  if (!isAdmin(msg)) return;
  await bot.sendMessage(msg.chat.id, `📊 ${claude.getStatus()}`);
});

// --- /stop ---
bot.onText(/\/stop/, async (msg) => {
  if (!isAdmin(msg)) return;
  const result = claude.stop();
  await bot.sendMessage(msg.chat.id, `🛑 ${result}`);
});

// --- /log ---
bot.onText(/\/log/, async (msg) => {
  if (!isAdmin(msg)) return;

  const log: string[] = (global as any).__recentLog || [];
  if (log.length === 0) {
    await bot.sendMessage(msg.chat.id, "No recent log entries.");
    return;
  }

  // Show last 10 entries
  const recent = log.slice(-10).join("\n---\n");
  const chunks = splitMessage(recent, 4000);
  for (const chunk of chunks) {
    await bot.sendMessage(msg.chat.id, chunk).catch(console.error);
  }
});

// --- Handle inline keyboard callbacks (approval flow) ---
bot.on("callback_query", async (query) => {
  await approvals.handleCallback(query);
});

// --- Start approval watcher ---
approvals.start();

// --- Startup message ---
bot
  .sendMessage(ADMIN_CHAT_ID, "🤖 DevBox Telegram bot started. Send /help for commands.")
  .catch(() => console.log("Could not send startup message — check ADMIN_CHAT_ID"));

console.log("DevBox Telegram bot running...");

// --- Graceful shutdown ---
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down...");
  approvals.stop();
  claude.stop();
  bot.stopPolling();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down...");
  approvals.stop();
  claude.stop();
  bot.stopPolling();
  process.exit(0);
});

// --- Helpers ---

function formatEvent(event: ClaudeEvent): string {
  switch (event.type) {
    case "text":
      return event.content;
    case "tool_use":
      return event.content;
    case "tool_result":
      return `📄 ${event.content}`;
    case "complete":
      return `✅ ${event.content}`;
    case "error":
      return `❌ ${event.content}`;
    default:
      return event.content;
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline
    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx < maxLen / 2) splitIdx = maxLen; // No good newline, hard split
    chunks.push(remaining.substring(0, splitIdx));
    remaining = remaining.substring(splitIdx).trimStart();
  }
  return chunks;
}
