FROM node:24-alpine

WORKDIR /app

# Copy pre-built artifacts (built locally before deploy)
COPY package*.json ./
COPY dist/ ./dist/
COPY knowledge/ ./knowledge/
COPY public/ ./public/

# Install production dependencies only
RUN npm ci --omit=dev

USER node

EXPOSE 3090

CMD ["node", "dist/index.js"]
