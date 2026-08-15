FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/output-platform/package.json packages/output-platform/package.json
RUN npm ci

COPY . .
RUN npm run build --workspace @baseer-erp/contracts \
  && npm run build --workspace @baseer-erp/output-platform \
  && npm run build --workspace @baseer-erp/api

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app /app

USER node
EXPOSE 5200

CMD ["node", "apps/api/dist/main.js"]
