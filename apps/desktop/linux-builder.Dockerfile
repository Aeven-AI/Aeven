# Linux build host for Desktop packaging, built and run by scripts/package-linux-container.ts.
# The image carries only tools; the repository arrives as a tar stream at run time.
FROM node:24-bookworm

ARG PNPM_VERSION

# electron-builder's bundled fpm is x64-only, so deb packaging uses a system fpm on every architecture.
# CMake builds the native speech worker (native/whisper-cpp); the image already carries gcc and g++.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ruby ruby-dev fakeroot cmake \
  && gem install --no-document fpm \
  && rm -rf /var/lib/apt/lists/*

RUN npm install --global "pnpm@${PNPM_VERSION}"

# Go builds the WhatsApp connector daemon (native/whatsapp-mcp); GOTOOLCHAIN=auto fetches the version its go.mod pins.
ARG GO_VERSION=1.26.0
RUN curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-$(dpkg --print-architecture).tar.gz" | tar -C /usr/local -xz
ENV PATH=/usr/local/go/bin:$PATH

ENV USE_SYSTEM_FPM=true
