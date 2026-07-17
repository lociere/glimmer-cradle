# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24.18.0-trixie-slim
ARG PYTHON_IMAGE=python:3.12.13-slim-trixie
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.11.28

FROM ${NODE_IMAGE} AS node-runtime
FROM ${UV_IMAGE} AS uv-runtime

FROM ${NODE_IMAGE} AS node-builder
WORKDIR /workspace
RUN apt-get update \
    && apt-get install --yes --no-install-recommends build-essential python3 pkg-config cmake libzmq3-dev \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.13.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY protocol/package.json protocol/package.json
COPY packages/extension-sdk/package.json packages/extension-sdk/package.json
COPY core/kernel/package.json core/kernel/package.json
COPY products/personal-server/package.json products/personal-server/package.json
RUN pnpm install --frozen-lockfile \
    --filter @glimmer-cradle/kernel... \
    --filter @glimmer-cradle/personal-server...
COPY . .
RUN pnpm --filter @glimmer-cradle/protocol build \
    && pnpm --filter @glimmer-cradle/extension-sdk build \
    && pnpm --filter @glimmer-cradle/kernel build \
    && pnpm --filter @glimmer-cradle/personal-server build \
    && pnpm deploy --filter @glimmer-cradle/kernel --prod /release/kernel \
    && pnpm deploy --filter @glimmer-cradle/personal-server --prod /release/personal-server \
    && pnpm deploy --filter @glimmer-cradle/extension-sdk --prod /release/extension-host/modules/@glimmer-cradle/extension-sdk

FROM ${PYTHON_IMAGE} AS python-builder
COPY --from=uv-runtime /uv /uvx /usr/local/bin/
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy
WORKDIR /opt/glimmer-cradle/app
COPY core/cognition core/cognition
COPY engines/audio engines/audio
RUN uv sync --project core/cognition --frozen --no-dev --no-editable \
    && uv sync --project engines/audio --frozen --no-dev --no-editable --extra tts

FROM ${PYTHON_IMAGE} AS personal-server
ARG APP_UID=10001
ARG APP_GID=10001
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates tini libatomic1 libstdc++6 libzmq5 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid ${APP_GID} glimmer \
    && useradd --uid ${APP_UID} --gid ${APP_GID} --home-dir /var/lib/glimmer-cradle --create-home --shell /usr/sbin/nologin glimmer
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=uv-runtime /uv /uvx /usr/local/bin/

WORKDIR /opt/glimmer-cradle/app
COPY --from=node-builder --chown=glimmer:glimmer /release/kernel core/kernel
COPY --from=node-builder --chown=glimmer:glimmer /release/personal-server products/personal-server
COPY --from=node-builder --chown=glimmer:glimmer /release/extension-host extension-host
COPY --from=python-builder --chown=glimmer:glimmer /opt/glimmer-cradle/app/core/cognition core/cognition
COPY --from=python-builder --chown=glimmer:glimmer /opt/glimmer-cradle/app/engines/audio engines/audio
COPY --chown=glimmer:glimmer products/personal-server/product.json products/personal-server/product.json
COPY --chown=glimmer:glimmer configs /opt/glimmer-cradle/default-config
COPY --chown=glimmer:glimmer deploy/personal-server/container /opt/glimmer-cradle/container

RUN install -d -o glimmer -g glimmer \
      /var/lib/glimmer-cradle/config \
      /var/lib/glimmer-cradle/data \
      /run/glimmer-cradle

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    UV_NO_SYNC=1 \
    UV_CACHE_DIR=/var/lib/glimmer-cradle/data/cache/uv \
    GLIMMER_CRADLE_APP_ROOT=/opt/glimmer-cradle/app \
    GLIMMER_CRADLE_CONFIG_ROOT=/var/lib/glimmer-cradle/config \
    GLIMMER_CRADLE_DATA_ROOT=/var/lib/glimmer-cradle/data \
    GLIMMER_CRADLE_RUN_ROOT=/run/glimmer-cradle \
    GLIMMER_CRADLE_EXTENSION_MODULE_ROOT=/opt/glimmer-cradle/app/extension-host/modules \
    GLIMMER_CRADLE_PRODUCT_MANIFEST=/opt/glimmer-cradle/app/products/personal-server/product.json \
    GLIMMER_CRADLE_SERVER_HOST=0.0.0.0 \
    GLIMMER_CRADLE_SERVER_PORT=3210

USER glimmer:glimmer
EXPOSE 3210
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/node", "/opt/glimmer-cradle/container/entrypoint.mjs"]
