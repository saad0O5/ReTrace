# ReTrace Backend + Frontend — single container
# Build: docker build -t retrace .
# Run:   docker run -p 5000:5000 retrace

FROM node:20-alpine AS base
WORKDIR /app

# ── Backend dependencies ────────────────────────────────────────
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --production

# ── Frontend dependencies + build ───────────────────────────────
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci

# ── Copy source code ────────────────────────────────────────────
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# ── Build frontend ─────────────────────────────────────────────
RUN cd frontend && npm run build

# ── Generate Prisma client ─────────────────────────────────────
RUN cd backend && npx prisma generate

# ── Runtime ─────────────────────────────────────────────────────
ENV NODE_ENV=production
ENV PORT=5000
ENV DATABASE_URL=file:./dev.db

EXPOSE 5000

# Start the backend, which also serves the built frontend via express.static.
# Single-origin: API at /api/* and React SPA at /* are served from :5000.
CMD ["node", "backend/src/server.js"]
