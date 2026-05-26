# ==========================================
# Stage 1: Build the React Frontend SPA
# ==========================================
FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend

# Copy dependencies manifest
COPY frontend/package*.json ./
RUN npm install

# Copy source code and build production bundle
COPY frontend/ ./
RUN npm run build

# ==========================================
# Stage 2: Final Production Express Host
# ==========================================
FROM node:18-alpine AS final-runner
WORKDIR /app/backend

# Set production context
ENV NODE_ENV=production

# Copy backend dependencies manifest
COPY backend/package*.json ./
RUN npm install --only=production

# Copy backend source code
COPY backend/ ./

# Copy compiled frontend assets from Stage 1 into the designated serving folder
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Ensure persistent uploads directory exists
RUN mkdir -p uploads/avatars

# Expose HTTP listener port
EXPOSE 5000

# Start Express server
CMD ["node", "src/index.js"]
