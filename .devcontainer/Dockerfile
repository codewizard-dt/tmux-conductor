FROM ubuntu:24.04

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates git sudo nodejs npm python3 python3-venv rsync jq vim software-properties-common \
    && rm -rf /var/lib/apt/lists/*

# Install Chromium for puppeteer-mcp-claude (native arm64/amd64; avoids Puppeteer's
# broken auto-downloaded x86_64 binary on Apple Silicon). xtradeb PPA ships a
# snap-free chromium deb for both architectures on Ubuntu 24.04 (noble). The
# chromium .deb declares its own runtime deps, so apt resolves the GUI libs
# automatically — no need to enumerate libnss3/libatk*/etc.
RUN add-apt-repository -y ppa:xtradeb/apps \
    && apt-get update \
    && apt-get install -y --no-install-recommends chromium \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user (claude --dangerously-skip-permissions refuses root)
RUN useradd -m -s /bin/bash conductor

# Install Claude Code via native installer (not npm — avoids migration warning)
USER conductor
RUN curl -fsSL https://claude.ai/install.sh | bash

# Install uv (Python package/CLI runner used by many MCP servers)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/home/conductor/.local/bin:/home/conductor/.cargo/bin:${PATH}"

# Copy init script that seeds ~/.claude config from host copy (or generates defaults)
COPY --chown=conductor:conductor init-claude-config.sh /home/conductor/init-claude-config.sh
RUN chmod +x /home/conductor/init-claude-config.sh
