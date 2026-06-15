# Build context = repo root (source_dir: / in deploy/app.yaml).
# The image MIRRORS the repo layout under /repo so that the source's relative
# imports resolve identically in the container as in dev — in particular
# app/api/relay/*.ts and app/api/routes/*.ts import '../../../shared/relay-protocol.ts'
# (three levels up to the repo root). Flattening app/api to /app/api collapses the
# 'app/' segment and breaks that path, so the nesting must be preserved.
FROM node:22-alpine
WORKDIR /repo/app/api
COPY app/api/package.json app/api/package-lock.json ./
RUN npm ci
COPY app/api/ ./
COPY shared/ /repo/shared/
# Pin the DigitalOcean Managed PG CA so db.ts gets fully-verified TLS in prod.
COPY deploy/do-ca-certificate.crt /repo/deploy/do-ca-certificate.crt
ENV API_PORT=8080
ENV DATABASE_CA_CERT_PATH=/repo/deploy/do-ca-certificate.crt
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["node","--import","tsx/esm","index.ts"]
