# ---- stage 1: build engine + console ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json tsconfig.json ./
COPY src ./src
RUN npm install --no-audit --no-fund && npm run build

COPY web/package.json web/vite.config.ts web/tsconfig.json ./web/
COPY web/index.html ./web/index.html
COPY web/src ./web/src
RUN cd web && npm install --no-audit --no-fund && npm run build

# ---- stage 2: runtime (zero runtime dependencies) ----
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/static ./static
COPY --from=build /app/examples ./examples
COPY package.json ./

RUN addgroup -S sp && adduser -S sp -G sp && chown -R sp:sp /app
USER sp

EXPOSE 8800
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8800)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/cli.js", "serve"]
