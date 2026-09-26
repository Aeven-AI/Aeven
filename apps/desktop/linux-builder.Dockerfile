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

ENV USE_SYSTEM_FPM=true
