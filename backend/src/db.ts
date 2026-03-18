import { MongoClient, type Db } from "mongodb";

let client: MongoClient | null = null;
let scoutquestDb: Db | null = null;

export async function connectDb(): Promise<void> {
  const uri = process.env.MONGO_URI || "mongodb://mongodb:27017/scoutquest";
  client = new MongoClient(uri);
  await client.connect();
  scoutquestDb = client.db("scoutquest");
  console.log("MongoDB connected");
}

export function getScoutQuestDb(): Db {
  if (!scoutquestDb) throw new Error("DB not connected — call connectDb() first");
  return scoutquestDb;
}
