#!/usr/bin/env bash
# Sourced by .niteshift/setup, .niteshift/resume, and every service wrapper.
# Puts the mise-pinned toolchain (node 20.19, pnpm 10.19 — see .mise.toml) on
# PATH and installs mise itself on a fresh sandbox. The sandbox image ships
# Node 22 in /usr/local/bin; without this, every pnpm invocation warns
# `Unsupported engine` and dev servers run on a Node CI never sees.
#
# Idempotent: mise install is a no-op once the pinned versions are cached.

export MISE_DATA_DIR="${MISE_DATA_DIR:-$HOME/.local/share/mise}"
export PATH="$HOME/.local/bin:$MISE_DATA_DIR/shims:$PATH"

# Pinned mise release. SHA256 values are the upstream-published checksums from
#   https://github.com/jdx/mise/releases/download/v${MISE_VERSION}/SHASUMS256.txt
# Bump both VERSION and the matching SHA when upgrading; never replace this with
# `curl https://mise.run | sh`, which executes arbitrary code from an
# unauthenticated download.
MISE_VERSION="2025.10.10"
MISE_SHA256_LINUX_X64="046708144e13d918801511845b44cb5e2a4414d616741ce24720c34f7d370a7d"
MISE_SHA256_LINUX_ARM64="ef86eba7f8adba1160bd1df43b7549d1acaaf965567562cf77891295dd1e3fcf"

workshop_install_mise_pinned() {
  local arch tarball expected_sha tmp
  case "$(uname -m)" in
    x86_64|amd64) arch="linux-x64"; expected_sha="$MISE_SHA256_LINUX_X64" ;;
    aarch64|arm64) arch="linux-arm64"; expected_sha="$MISE_SHA256_LINUX_ARM64" ;;
    *) echo "unsupported architecture for pinned mise install: $(uname -m)" >&2; return 1 ;;
  esac
  tarball="mise-v${MISE_VERSION}-${arch}.tar.gz"
  tmp="$(mktemp -d)"
  curl -fsSL --retry 3 --retry-delay 2 \
    -o "$tmp/$tarball" \
    "https://github.com/jdx/mise/releases/download/v${MISE_VERSION}/${tarball}"
  printf '%s  %s\n' "$expected_sha" "$tmp/$tarball" | sha256sum -c - >/dev/null
  tar -xzf "$tmp/$tarball" -C "$tmp"
  mkdir -p "$HOME/.local/bin"
  install -m 0755 "$tmp/mise/bin/mise" "$HOME/.local/bin/mise"
  rm -rf "$tmp"
}

# `workshop_ensure_toolchain <repo-root>` — install mise + pinned tools.
workshop_ensure_toolchain() {
  local repo_root="$1"
  if ! command -v mise >/dev/null 2>&1; then
    workshop_install_mise_pinned
  fi
  mise trust --quiet "$repo_root/.mise.toml"
  mise install --quiet
}
