#!/usr/bin/env bash
set -euo pipefail

version="${STELLAR_CLI_VERSION:-26.1.0}"
install_dir="${STELLAR_CLI_INSTALL_DIR:-/usr/local/bin}"

if [[ -n "${STELLAR_CLI_TARGET:-}" ]]; then
  target="$STELLAR_CLI_TARGET"
else
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) target="x86_64-unknown-linux-gnu" ;;
    Linux-aarch64|Linux-arm64) target="aarch64-unknown-linux-gnu" ;;
    Darwin-x86_64) target="x86_64-apple-darwin" ;;
    Darwin-arm64) target="aarch64-apple-darwin" ;;
    *)
      echo "Unsupported Stellar CLI install target: $(uname -s)-$(uname -m)" >&2
      exit 1
      ;;
  esac
fi

archive="stellar-cli-${version}-${target}.tar.gz"
url="https://github.com/stellar/stellar-cli/releases/download/v${version}/${archive}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$install_dir"
curl -fsSL "$url" -o "$tmp_dir/$archive"
tar -xzf "$tmp_dir/$archive" -C "$tmp_dir"
install -m 0755 "$tmp_dir/stellar" "$install_dir/stellar"
"$install_dir/stellar" --version
