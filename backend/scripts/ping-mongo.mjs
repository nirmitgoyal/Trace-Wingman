import { MongoClient, ServerApiVersion } from "mongodb";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI not set");
  process.exit(1);
}

// Redact the password before logging so we don't leak the secret.
const redacted = uri.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@");
console.log(`Connecting to ${redacted}`);

const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

try {
  await client.connect();
  const admin = client.db("admin");
  const pong = await admin.command({ ping: 1 });
  console.log("Ping result:", pong);

  const target = client.db("sevak-dashboard");
  const collections = await target.listCollections().toArray();
  console.log(
    `Collections in sevak-dashboard (${collections.length}):`,
    collections.map((c) => c.name),
  );
} catch (err) {
  console.error("Mongo ping FAILED:", err.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
