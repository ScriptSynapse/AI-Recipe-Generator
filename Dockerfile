# Build stage: compile the C++ engine and install Node dependencies.
FROM node:20-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends g++ libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build:cpp

# Runtime stage: only what is needed to run.
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libcurl4 ca-certificates util-linux \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
RUN chmod +x scripts/docker-entrypoint.sh
EXPOSE 3000
# The entrypoint starts as root only to fix ownership of the mounted disk, then runs the app as "node".
ENTRYPOINT ["scripts/docker-entrypoint.sh"]
