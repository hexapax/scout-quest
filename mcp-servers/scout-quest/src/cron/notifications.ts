import { cronLog } from "../db.js";
import type { QueuedNotification } from "./mechanicalChecks.js";

export async function sendNotifications(
  notifications: QueuedNotification[],
  ntfyTopic: string,
  parentTopic?: string,
): Promise<void> {
  const logCol = await cronLog();
  const now = new Date();

  for (const notif of notifications) {
    const topic = notif.target === "parent" && parentTopic ? parentTopic : ntfyTopic;

    try {
      await fetch(`https://ntfy.sh/${topic}`, {
        method: "POST",
        headers: { "Title": `Scout Quest: ${notif.type.replace(/_/g, " ")}`, "Priority": notif.priority },
        body: notif.message,
      });

      await logCol.insertOne({
        run_date: now,
        scout_email: notif.scout_email,
        action: "notification_sent",
        details: `${notif.type} → ${notif.target}: ${notif.message}`,
        created_at: now,
      });
    } catch (err) {
      console.error(`Failed to send notification for ${notif.scout_email}:`, err);
    }
  }
}
