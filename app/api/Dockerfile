FROM node:22-alpine
WORKDIR /app/api
COPY app/api/package.json app/api/package-lock.json ./
RUN npm ci
COPY app/api/ ./
COPY shared/ /app/shared/
# Pin the DigitalOcean Managed PG CA so db.ts gets fully-verified TLS in prod.
COPY deploy/do-ca-certificate.crt /app/deploy/do-ca-certificate.crt
ENV API_PORT=8080
ENV DATABASE_CA_CERT_PATH=/app/deploy/do-ca-certificate.crt
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["node","--import","tsx/esm","index.ts"]
