// Runs paper<->repository matching against whatever's currently in the
// database and writes Relationship rows (Phase 5). Safe to re-run any time
// new artifacts are ingested — updates existing matches rather than
// duplicating them.
//
// Usage: node scripts/matchRepos.js

const path = require("path");
require(path.join(__dirname, "..", "backend", "node_modules", "dotenv")).config({
  path: path.join(__dirname, "..", "backend", ".env"),
});

// resolver.js lives under backend/src/, so its own bare `require("@prisma/client")`
// resolves via Node's normal upward node_modules walk to backend/node_modules —
// same reason backend/src/database/client.js works without any path tricks.
const { run } = require("../backend/src/matching/resolver");

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});