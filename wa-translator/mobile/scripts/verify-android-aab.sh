#!/usr/bin/env bash
set -euo pipefail

bundle="${1:-android/app/build/outputs/bundle/release/app-release.aab}"
if [[ ! -s "$bundle" ]]; then
  echo "Android bundle not found: $bundle" >&2
  exit 1
fi

# The Maven bundletool artifact pulled transitively by AGP is a library JAR and
# does not carry the executable Main-Class. Artifact inspection needs Google's
# standalone shadow JAR instead. Pin both version and digest so this release
# gate never executes an unverified mutable download.
bundletool_version="1.18.1"
bundletool_sha256="675786493983787ffa11550bdb7c0715679a44e1643f3ff980a529e9c822595c"
bundletool_dir="${XDG_CACHE_HOME:-$HOME/.cache}/lingua-relay/bundletool"
bundletool_jar="$bundletool_dir/bundletool-all-$bundletool_version.jar"
bundletool_url="https://github.com/google/bundletool/releases/download/$bundletool_version/bundletool-all-$bundletool_version.jar"

bundletool_valid() {
  [[ -s "$bundletool_jar" ]] \
    && printf '%s  %s\n' "$bundletool_sha256" "$bundletool_jar" | sha256sum -c - >/dev/null 2>&1
}

if ! bundletool_valid; then
  mkdir -p "$bundletool_dir"
  rm -f "$bundletool_jar"
  bundletool_tmp="$(mktemp "$bundletool_dir/.bundletool.XXXXXX")"
  if ! curl --fail --location --silent --show-error --retry 3 \
      --proto '=https' --tlsv1.2 "$bundletool_url" --output "$bundletool_tmp"; then
    rm -f "$bundletool_tmp"
    echo "Android artifact check: could not download pinned standalone bundletool." >&2
    exit 1
  fi
  if ! printf '%s  %s\n' "$bundletool_sha256" "$bundletool_tmp" | sha256sum -c - >/dev/null 2>&1; then
    rm -f "$bundletool_tmp"
    echo "Android artifact check: standalone bundletool checksum mismatch." >&2
    exit 1
  fi
  mv "$bundletool_tmp" "$bundletool_jar"
fi

manifest="$(java -jar "$bundletool_jar" dump manifest --bundle="$bundle" --module=base)"
for required in \
  'package="com.javin23863.linguarelay"' \
  'android:targetSdkVersion="36"' \
  'android:name="android.permission.CAMERA"' \
  'android:name="android.permission.RECORD_AUDIO"' \
  'android:allowBackup="false"' \
  'android:usesCleartextTraffic="false"'; do
  if ! grep -Fq "$required" <<<"$manifest"; then
    echo "Android artifact check: manifest is missing $required" >&2
    exit 1
  fi
done

expected_version_code="${LINGUA_ANDROID_VERSION_CODE:-}"
if [[ -n "$expected_version_code" ]]; then
  if [[ ! "$expected_version_code" =~ ^[1-9][0-9]*$ ]]; then
    echo "Android artifact check: LINGUA_ANDROID_VERSION_CODE is invalid." >&2
    exit 1
  fi
  if ! grep -Fq "android:versionCode=\"$expected_version_code\"" <<<"$manifest"; then
    echo "Android artifact check: packaged versionCode does not match the release build number." >&2
    exit 1
  fi
fi

# Credential-free CI intentionally produces an unsigned release bundle. When a
# release keystore is configured, the exact AAB intended for Play must both
# verify cryptographically and carry the same signer certificate as the
# configured upload-key alias. Direct fingerprint equality avoids depending on
# jarsigner's non-strict warning/exit-code behavior for alias mismatches.
if [[ -n "${LINGUA_ANDROID_KEYSTORE:-}${LINGUA_ANDROID_KEYSTORE_PASSWORD:-}${LINGUA_ANDROID_KEY_ALIAS:-}" ]]; then
  for value in LINGUA_ANDROID_KEYSTORE LINGUA_ANDROID_KEYSTORE_PASSWORD LINGUA_ANDROID_KEY_ALIAS; do
    if [[ -z "${!value:-}" ]]; then
      echo "Android artifact check: signed verification is missing $value." >&2
      exit 1
    fi
  done
  jarsigner -verify "$bundle" >/dev/null || {
    echo "Android artifact check: AAB signature integrity verification failed." >&2
    exit 1
  }
  expected_signer="$(
    keytool -exportcert \
      -alias "$LINGUA_ANDROID_KEY_ALIAS" \
      -keystore "$LINGUA_ANDROID_KEYSTORE" \
      -storepass:env LINGUA_ANDROID_KEYSTORE_PASSWORD \
      -rfc |
    openssl x509 -noout -fingerprint -sha256 |
    sed 's/^sha256 Fingerprint=//I' |
    tr '[:lower:]' '[:upper:]'
  )"
  actual_signer="$(
    keytool -printcert -jarfile "$bundle" -rfc |
    openssl x509 -noout -fingerprint -sha256 |
    sed 's/^sha256 Fingerprint=//I' |
    tr '[:lower:]' '[:upper:]'
  )"
  if [[ -z "$expected_signer" || "$actual_signer" != "$expected_signer" ]]; then
    echo "Android artifact check: AAB signer certificate does not match the configured release alias." >&2
    exit 1
  fi
fi

for entry in base/assets/public/room.html base/assets/public/room.css \
  base/assets/public/room-ui.css base/assets/public/room.js; do
  if ! unzip -Z1 "$bundle" | grep -Fxq "$entry"; then
    echo "Android artifact check: AAB is missing $entry" >&2
    exit 1
  fi
done

room="$(unzip -p "$bundle" base/assets/public/room.html)"
if grep -q 'id="participantCount" aria-live="polite">0 / 4 people<' <<<"$room"; then
  echo "Android artifact check: room still contains the retired four-person fallback." >&2
  exit 1
fi
grep -q 'id="participantCount" aria-live="polite">0 / 2 people<' <<<"$room" || {
  echo "Android artifact check: room is missing the two-person fallback." >&2
  exit 1
}
grep -q '<link rel="stylesheet" href="/room.css">' <<<"$room" || {
  echo "Android artifact check: room is missing external room.css." >&2
  exit 1
}
grep -q '<link rel="stylesheet" href="/room-ui.css">' <<<"$room" || {
  echo "Android artifact check: room is missing the Lingua room presentation layer." >&2
  exit 1
}
grep -q '<script src="/room.js"></script>' <<<"$room" || {
  echo "Android artifact check: room is missing external room.js." >&2
  exit 1
}
if grep -q '<style>' <<<"$room" || grep -q '<script>' <<<"$room"; then
  echo "Android artifact check: room still contains inline implementation." >&2
  exit 1
fi

unzip -p "$bundle" base/assets/public/room.css | grep -q '#stage{' || {
  echo "Android artifact check: room.css is incomplete." >&2
  exit 1
}
unzip -p "$bundle" base/assets/public/room-ui.css | grep -q -- '--accent:#64D4C3' || {
  echo "Android artifact check: room-ui.css is missing the Lingua presentation tokens." >&2
  exit 1
}
unzip -p "$bundle" base/assets/public/room-ui.css | grep -q 'prefers-reduced-motion:reduce' || {
  echo "Android artifact check: room-ui.css is missing reduced-motion handling." >&2
  exit 1
}
unzip -p "$bundle" base/assets/public/room.js | grep -q 'async function connect()' || {
  echo "Android artifact check: room.js is incomplete." >&2
  exit 1
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
unzip -q "$bundle" 'base/assets/public/*' -d "$tmp"
if grep -RInaE '127\.0\.0\.1|localhost:8788|test-only-|local-dev-only-|BEGIN PRIVATE KEY|google-play\.json|release\.keystore' \
    "$tmp/base/assets/public" >/dev/null; then
  echo "Android artifact check: packaged web assets contain a development/test credential marker." >&2
  exit 1
fi

if unzip -Z1 "$bundle" | grep -Ei '(^|/)(google-services\.json|google-play\.json|.*\.(p12|p8|keystore|jks|mobileprovision))$' | grep -q .; then
  echo "Android artifact check: AAB contains a forbidden credential file." >&2
  exit 1
fi

bash scripts/verify-android-16k.sh "$bundle"
echo "Android artifact check: identity, version, signing, permissions, transport security, room UI contract and secret hygiene verified."
