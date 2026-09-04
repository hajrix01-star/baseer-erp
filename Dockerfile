FROM node:24-alpine AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/output-platform/package.json packages/output-platform/package.json
# Package downloads can suffer a short registry or network reset. Keep the
# recovery deterministic: one 45-second request per attempt and at most three
# full installs. A persistent install error still fails this image build.
RUN set -eu; \
  attempt=1; \
  until npm ci --fetch-retries=0 --fetch-timeout=45000; do \
    if [ "$attempt" -ge 3 ]; then \
      echo "npm ci failed after $attempt attempts" >&2; \
      exit 1; \
    fi; \
    attempt=$((attempt + 1)); \
    echo "npm ci failed; retrying ($attempt/3) after 5 seconds" >&2; \
    sleep 5; \
  done

FROM dependencies AS build

WORKDIR /app

COPY . .
RUN npm run build --workspace @baseer-erp/contracts \
  && npm run build --workspace @baseer-erp/output-platform \
  && npm run build --workspace @baseer-erp/api

FROM node:24-alpine AS migrate

ENV NODE_ENV=production
WORKDIR /app

# Migrations retain Prisma CLI, but only run as an internal, short-lived job.
COPY --from=build --chown=node:node /app /app

USER node

CMD ["npx", "prisma", "migrate", "deploy", "--config", "apps/api/prisma.config.ts"]

FROM node:24-alpine AS runtime-dependencies

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/output-platform/package.json packages/output-platform/package.json

# Do not copy the build workspace wholesale: omit the Prisma CLI and all
# development-only packages from the public API runtime image.
RUN set -eu; \
  attempt=1; \
  until npm ci --omit=dev --omit=optional --omit=peer --ignore-scripts --fetch-retries=0 --fetch-timeout=45000; do \
    if [ "$attempt" -ge 3 ]; then \
      echo "runtime npm ci failed after $attempt attempts" >&2; \
      exit 1; \
    fi; \
    attempt=$((attempt + 1)); \
    echo "runtime npm ci failed; retrying ($attempt/3) after 5 seconds" >&2; \
    sleep 5; \
  done

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=runtime-dependencies --chown=node:node /app/node_modules /app/node_modules
COPY --from=build --chown=node:node /app/apps/api/package.json /app/apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist /app/apps/api/dist
COPY --from=build --chown=node:node /app/packages/contracts/package.json /app/packages/contracts/package.json
COPY --from=build --chown=node:node /app/packages/contracts/dist /app/packages/contracts/dist
COPY --from=build --chown=node:node /app/packages/output-platform/package.json /app/packages/output-platform/package.json
COPY --from=build --chown=node:node /app/packages/output-platform/dist /app/packages/output-platform/dist

# The advisory is in the Prisma CLI/configuration path. Fail the image build if
# it leaks into the public API image rather than relying on package manifests.
RUN node -e "for (const name of ['prisma', '@prisma/config', 'deepmerge-ts']) { try { require.resolve(name); process.stderr.write(name + ' must not exist in the API runtime image\\n'); process.exit(1); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; } }"

USER node
EXPOSE 5200

CMD ["node", "apps/api/dist/main.js"]
