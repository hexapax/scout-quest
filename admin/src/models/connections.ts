import mongoose from "mongoose";

const MONGO_URI_SCOUT = process.env.MONGO_URI_SCOUT || "mongodb://localhost:27017/scoutquest";
const MONGO_URI_LIBRECHAT = process.env.MONGO_URI_LIBRECHAT || "mongodb://localhost:27017/LibreChat";

// Default connection for Scout Quest (read-write)
// AdminJS uses mongoose.model() which registers on the default connection
export async function connectScoutDb(): Promise<typeof mongoose> {
  return mongoose.connect(MONGO_URI_SCOUT);
}

// Separate connection for LibreChat (read-only in the admin UI)
export const libreChatDb = mongoose.createConnection(MONGO_URI_LIBRECHAT);

libreChatDb.on("connected", () => {
  console.log("Connected to LibreChat MongoDB");
});

libreChatDb.on("error", (err) => {
  console.error("LibreChat MongoDB connection error:", err);
});
