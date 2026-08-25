#!/usr/bin/env bash
set -euo pipefail

bundle="${1:-android/app/build/outputs/bundle/release/app-release.aab}"
if [[ ! -s "$bundle" ]]; then
  echo "Android bundle not found: $bundle" >&2
  exit 1
fi

mapfile -t native_entries < <(unzip -Z1 "$bundle" | grep -E '(^|/)lib/[^/]+/[^/]+\.so$' || true)
if (( ${#native_entries[@]} == 0 )); then
  echo "16 KB check: bundle contains no native shared libraries."
  exit 0
fi

bundletool_root="$HOME/.gradle/caches/modules-2/files-2.1/com.android.tools.build/bundletool"
bundletool_jar="$(find "$bundletool_root" -type f -name 'bundletool-*.jar' -print 2>/dev/null | sort | tail -n 1 || true)"
if [[ -z "$bundletool_jar" ]]; then
  echo "16 KB check: bundletool was not found in the Gradle cache." >&2
  exit 1
fi

config="$(java -jar "$bundletool_jar" dump config --bundle="$bundle")"
if ! grep -q 'PAGE_ALIGNMENT_16K' <<<"$config"; then
  echo "16 KB check: AAB does not request PAGE_ALIGNMENT_16K." >&2
  echo "$config" >&2
  exit 1
fi

if ! command -v readelf >/dev/null 2>&1; then
  echo "16 KB check: readelf is required when native libraries are present." >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
for entry in "${native_entries[@]}"; do
  target="$tmp/${entry##*/}"
  unzip -p "$bundle" "$entry" > "$target"
  mapfile -t load_alignments < <(readelf -lW "$target" | awk '$1 == "LOAD" {print $NF}')
  if (( ${#load_alignments[@]} == 0 )); then
    echo "16 KB check: no ELF LOAD segments found in $entry." >&2
    exit 1
  fi
  for alignment in "${load_alignments[@]}"; do
    if (( alignment < 0x4000 )); then
      echo "16 KB check: $entry has LOAD alignment $alignment (< 0x4000)." >&2
      exit 1
    fi
  done
done

echo "16 KB check: ${#native_entries[@]} native libraries are bundle- and ELF-aligned."
