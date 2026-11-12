FROM node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS base

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

RUN corepack enable && corepack prepare pnpm@10.19.0 --activate

WORKDIR /app

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY . .
RUN export DATABASE_URL=postgresql://build.invalid/identity \
  && pnpm prisma:generate \
  && pnpm build

FROM dependencies AS migrate

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY prisma.config.ts ./
COPY prisma ./prisma
RUN DATABASE_URL=postgresql://build.invalid/identity pnpm prisma:generate \
  && schema_engine="$(find node_modules -type f -name 'schema-engine*' -perm /111 -print -quit)" \
  && test -n "$schema_engine" \
  && case "$schema_engine" in *schema-engine-debian-openssl-3.0.x) ;; *) echo "Unexpected Prisma schema-engine target: $schema_engine" >&2; exit 1 ;; esac \
  && echo "Prisma schema-engine included: $schema_engine"
CMD ["pnpm", "prisma:migrate:deploy"]

FROM build AS production-dependencies

RUN pnpm prune --prod

FROM node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS runtime

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

RUN groupadd --system --gid 10001 edupay \
  && useradd --system --uid 10001 --gid edupay --create-home --home-dir /home/edupay edupay

COPY --from=production-dependencies --chown=edupay:edupay /app/package.json ./package.json
COPY --from=production-dependencies --chown=edupay:edupay /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=edupay:edupay /app/dist ./dist

USER edupay

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/identity/health').then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
