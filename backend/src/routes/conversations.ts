/** Conversation persistence routes.
 *
 * GET    /api/conversations         — list user's conversations
 * POST   /api/conversations         — create new conversation
 * GET    /api/conversations/:id     — load full conversation
 * PUT    /api/conversations/:id/messages — append messages
 * PATCH  /api/conversations/:id     — update title
 * DELETE /api/conversations/:id     — delete conversation
 */

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { ObjectId } from "mongodb";
import { getScoutQuestDb } from "../db.js";
import { getUserFromCookie } from "./auth.js";

interface ConversationMessage {
  role: string;
  content: string;
  toolCalls?: unknown[];
  ts: Date;
}

interface ConversationDoc {
  _id: ObjectId;
  userEmail: string;
  title: string;
  model: string;
  messages: ConversationMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const COLLECTION = "conversations";
const MAX_LIST = 50;
const TITLE_MAX_LEN = 60;

/** Auto-generate a title from the first user message. */
function generateTitle(messages: ConversationMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first || typeof first.content !== "string") return "New conversation";
  const text = first.content.replace(/\s+/g, " ").trim();
  if (text.length <= TITLE_MAX_LEN) return text;
  return text.slice(0, TITLE_MAX_LEN - 1) + "\u2026";
}

export function createConversationsRouter(): Router {
  const router = createRouter();

  /** List user's conversations. */
  router.get("/api/conversations", async (req: Request, res: Response) => {
    const user = getUserFromCookie(req);
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const db = getScoutQuestDb();
      const docs = await db
        .collection<ConversationDoc>(COLLECTION)
        .find({ userEmail: user.email })
        .sort({ updatedAt: -1 })
        .limit(MAX_LIST)
        .project({
          _id: 1,
          title: 1,
          updatedAt: 1,
          messageCount: { $size: "$messages" },
        })
        .toArray();

      res.json(docs);
    } catch (err) {
      console.error("[conversations] list error:", err);
      res.status(500).json({ error: "Failed to list conversations" });
    }
  });

  /** Create new conversation. */
  router.post("/api/conversations", async (req: Request, res: Response) => {
    const user = getUserFromCookie(req);
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const db = getScoutQuestDb();
      const { title, model, messages } = req.body as {
        title?: string;
        model?: string;
        messages?: { role: string; content: string; toolCalls?: unknown[] }[];
      };

      const now = new Date();
      const msgDocs: ConversationMessage[] = (messages || []).map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCalls?.length ? { toolCalls: m.toolCalls } : {}),
        ts: now,
      }));

      const autoTitle =
        title || (msgDocs.length ? generateTitle(msgDocs) : "New conversation");

      const doc: Omit<ConversationDoc, "_id"> = {
        userEmail: user.email,
        title: autoTitle,
        model: model || "scout-coach",
        messages: msgDocs,
        createdAt: now,
        updatedAt: now,
      };

      const result = await db.collection(COLLECTION).insertOne(doc);
      res.status(201).json({ _id: result.insertedId, ...doc });
    } catch (err) {
      console.error("[conversations] create error:", err);
      res.status(500).json({ error: "Failed to create conversation" });
    }
  });

  /** Load full conversation. */
  router.get("/api/conversations/:id", async (req: Request, res: Response) => {
    const user = getUserFromCookie(req);
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    let oid: ObjectId;
    try {
      oid = new ObjectId(String(req.params.id));
    } catch {
      res.status(400).json({ error: "Invalid conversation ID" });
      return;
    }

    try {
      const db = getScoutQuestDb();
      const doc = await db
        .collection<ConversationDoc>(COLLECTION)
        .findOne({ _id: oid, userEmail: user.email });

      if (!doc) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }

      res.json(doc);
    } catch (err) {
      console.error("[conversations] load error:", err);
      res.status(500).json({ error: "Failed to load conversation" });
    }
  });

  /** Append messages to conversation. */
  router.put(
    "/api/conversations/:id/messages",
    async (req: Request, res: Response) => {
      const user = getUserFromCookie(req);
      if (!user) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      let oid: ObjectId;
      try {
        oid = new ObjectId(String(req.params.id));
      } catch {
        res.status(400).json({ error: "Invalid conversation ID" });
        return;
      }

      const { messages } = req.body as {
        messages?: { role: string; content: string; toolCalls?: unknown[] }[];
      };

      if (!Array.isArray(messages) || !messages.length) {
        res.status(400).json({ error: "messages array required" });
        return;
      }

      try {
        const db = getScoutQuestDb();
        const now = new Date();

        const msgDocs: ConversationMessage[] = messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.toolCalls?.length ? { toolCalls: m.toolCalls } : {}),
          ts: now,
        }));

        const result = await db.collection<ConversationDoc>(COLLECTION).updateOne(
          { _id: oid, userEmail: user.email },
          {
            $push: { messages: { $each: msgDocs } },
            $set: { updatedAt: now },
          }
        );

        if (result.matchedCount === 0) {
          res.status(404).json({ error: "Conversation not found" });
          return;
        }

        // Auto-update title if it's still "New conversation" and we now have a user message
        if (msgDocs.some((m) => m.role === "user")) {
          const doc = await db
            .collection<ConversationDoc>(COLLECTION)
            .findOne({ _id: oid });
          if (doc && doc.title === "New conversation") {
            const newTitle = generateTitle(doc.messages);
            if (newTitle !== "New conversation") {
              await db
                .collection(COLLECTION)
                .updateOne({ _id: oid }, { $set: { title: newTitle } });
            }
          }
        }

        res.json({ ok: true, added: msgDocs.length });
      } catch (err) {
        console.error("[conversations] append error:", err);
        res.status(500).json({ error: "Failed to append messages" });
      }
    }
  );

  /** Update conversation title. */
  router.patch(
    "/api/conversations/:id",
    async (req: Request, res: Response) => {
      const user = getUserFromCookie(req);
      if (!user) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      let oid: ObjectId;
      try {
        oid = new ObjectId(String(req.params.id));
      } catch {
        res.status(400).json({ error: "Invalid conversation ID" });
        return;
      }

      const { title } = req.body as { title?: string };
      if (!title || typeof title !== "string") {
        res.status(400).json({ error: "title string required" });
        return;
      }

      try {
        const db = getScoutQuestDb();
        const result = await db.collection<ConversationDoc>(COLLECTION).updateOne(
          { _id: oid, userEmail: user.email },
          { $set: { title: title.slice(0, TITLE_MAX_LEN), updatedAt: new Date() } }
        );

        if (result.matchedCount === 0) {
          res.status(404).json({ error: "Conversation not found" });
          return;
        }

        res.json({ ok: true });
      } catch (err) {
        console.error("[conversations] update title error:", err);
        res.status(500).json({ error: "Failed to update title" });
      }
    }
  );

  /** Delete conversation. */
  router.delete(
    "/api/conversations/:id",
    async (req: Request, res: Response) => {
      const user = getUserFromCookie(req);
      if (!user) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      let oid: ObjectId;
      try {
        oid = new ObjectId(String(req.params.id));
      } catch {
        res.status(400).json({ error: "Invalid conversation ID" });
        return;
      }

      try {
        const db = getScoutQuestDb();
        const result = await db
          .collection<ConversationDoc>(COLLECTION)
          .deleteOne({ _id: oid, userEmail: user.email });

        if (result.deletedCount === 0) {
          res.status(404).json({ error: "Conversation not found" });
          return;
        }

        res.json({ ok: true });
      } catch (err) {
        console.error("[conversations] delete error:", err);
        res.status(500).json({ error: "Failed to delete conversation" });
      }
    }
  );

  return router;
}
