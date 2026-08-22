const { PrismaClient } = require("@prisma/client");

// Reuse a single client across the app (and across nodemon hot-reloads in dev).
const prisma = global.__retracePrisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") {
  global.__retracePrisma = prisma;
}

module.exports = { prisma };
