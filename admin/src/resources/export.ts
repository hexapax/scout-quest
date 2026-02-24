import type { ActionResponse, Action } from "adminjs";
import type { Express, Request, Response } from "express";
import mongoose from "mongoose";

/**
 * Flatten a Mongoose document (or AdminJS record params) into a plain object,
 * resolving nested "dot-path" keys like "content.0.text" into proper structure.
 */
function unflatten(params: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    const parts = key.split(".");
    let current: Record<string, unknown> = result;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) {
        // If next part is numeric, create array; otherwise object
        current[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      }
      current = current[part] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
  }
  return result;
}

/**
 * Render a value as readable markdown text.
 */
function renderValue(value: unknown, indent = 0): string {
  const prefix = "  ".repeat(indent);
  if (value === null || value === undefined) return `${prefix}_(empty)_`;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return `${prefix}${String(value)}`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return `${prefix}_(empty list)_`;
    return value.map((item, i) => {
      if (typeof item === "object" && item !== null) {
        return `${prefix}- **[${i}]**\n${renderValue(item, indent + 1)}`;
      }
      return `${prefix}- ${String(item)}`;
    }).join("\n");
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => !k.startsWith("_"));
    if (keys.length === 0) return `${prefix}_(empty)_`;
    return keys.map((k) => {
      const v = obj[k];
      if (typeof v === "object" && v !== null) {
        return `${prefix}**${k}:**\n${renderValue(v, indent + 1)}`;
      }
      return `${prefix}**${k}:** ${String(v ?? "")}`;
    }).join("\n");
  }
  return `${prefix}${String(value)}`;
}

/**
 * Export actions to add to every resource's actions map.
 * These are record-level actions that link to the /api/export endpoint.
 */
export function exportActions(): Record<string, Partial<Action<ActionResponse>>> {
  return {
    exportJson: {
      actionType: "record",
      icon: "Code",
      component: false,
      handler: async (_request, _response, context) => {
        const { record, resource } = context;
        return {
          record: record!.toJSON(context.currentAdmin),
          redirectUrl: `/api/export/${record!.id()}?resource=${resource.id()}&format=json`,
        };
      },
    },
    exportText: {
      actionType: "record",
      icon: "Copy",
      component: false,
      handler: async (_request, _response, context) => {
        const { record, resource } = context;
        return {
          record: record!.toJSON(context.currentAdmin),
          redirectUrl: `/api/export/${record!.id()}?resource=${resource.id()}&format=text`,
        };
      },
    },
  };
}

/**
 * Register the /api/export/:id Express route.
 * Must be called before the AdminJS router is mounted.
 */
export function registerExportRoute(app: Express, adminResources: Array<{ resource: mongoose.Model<unknown>; options: { id?: string } }>) {
  app.get("/api/export/:id", async (req: Request, res: Response) => {
    // Auth check
    if (!req.isAuthenticated()) {
      res.status(401).send("Unauthorized");
      return;
    }

    const { id } = req.params;
    const resourceName = req.query.resource as string;
    const format = req.query.format as string;

    if (!resourceName || !format) {
      res.status(400).send("Missing resource or format query parameter");
      return;
    }

    // Find the Mongoose model by matching resource id or model name
    const entry = adminResources.find(
      (r) => (r.options.id || r.resource.modelName) === resourceName
    );
    if (!entry) {
      res.status(404).send(`Resource "${resourceName}" not found`);
      return;
    }

    try {
      const doc = await entry.resource.findById(id).lean();
      if (!doc) {
        res.status(404).send("Record not found");
        return;
      }

      if (format === "json") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.send(JSON.stringify(doc, null, 2));
      } else if (format === "text") {
        const plain = doc as Record<string, unknown>;
        const lines = [`# ${resourceName} — ${id}`, ""];
        for (const [key, value] of Object.entries(plain)) {
          if (key === "__v") continue;
          lines.push(`## ${key}`);
          lines.push(renderValue(value));
          lines.push("");
        }
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.send(lines.join("\n"));
      } else {
        res.status(400).send('Invalid format — use "json" or "text"');
      }
    } catch (err) {
      res.status(500).send(`Error: ${(err as Error).message}`);
    }
  });
}
