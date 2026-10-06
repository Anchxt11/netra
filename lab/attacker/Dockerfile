FROM debian:bookworm-slim

# Install attack tooling: hydra, sqlmap, ffuf, ab (apache2-utils), curl, jq
# nikto skipped — not packaged in bookworm; redundant with ffuf per plan
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        hydra \
        sqlmap \
        apache2-utils \
        curl \
        jq \
        ca-certificates \
        wget \
        dnsutils \
        procps \
    && rm -rf /var/lib/apt/lists/*

# Install ffuf (Go binary)
RUN ARCH=$(dpkg --print-architecture) && \
    wget -qO /tmp/ffuf.tar.gz \
      "https://github.com/ffuf/ffuf/releases/download/v2.1.0/ffuf_2.1.0_linux_${ARCH}.tar.gz" && \
    tar xzf /tmp/ffuf.tar.gz -C /usr/local/bin ffuf && \
    chmod +x /usr/local/bin/ffuf && \
    rm /tmp/ffuf.tar.gz

# Copy baked-in wordlists (the lab network has no internet)
COPY wordlists/ /wordlists/

# Copy attack runner script
COPY attack-runner.sh /usr/local/bin/attack-runner
RUN chmod +x /usr/local/bin/attack-runner

WORKDIR /work

# Keep container alive so we can exec into it
CMD ["sleep", "infinity"]
