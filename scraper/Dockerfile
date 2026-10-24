FROM node:24-alpine3.24 AS build

ENV NODE_ENV=development

WORKDIR /app

COPY package.json package-lock.json ./

RUN attempts=0; \
    until [ "$attempts" -ge 5 ]; do \
        npm ci --include=dev --no-audit --no-fund --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=30000 && break; \
        attempts=$((attempts + 1)); \
        if [ "$attempts" -ge 5 ]; then exit 1; fi; \
        sleep 5; \
    done

COPY tsconfig.json tsconfig.build.json ./
COPY index.ts mongodb.ts ./
COPY models ./models
COPY domains ./domains
COPY shared ./shared

RUN node ./node_modules/typescript/lib/tsc.js -p tsconfig.build.json \
    && npm prune --omit=dev --no-audit --no-fund \
    && npm cache clean --force

FROM node:24-alpine3.24 AS runtime

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

RUN chown -R 1000:1000 /app

USER 1000:1000

EXPOSE 3000

CMD ["node", "dist/index.js"]
