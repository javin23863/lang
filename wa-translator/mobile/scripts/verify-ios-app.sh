#!/usr/bin/env bash
set -euo pipefail

input="${1:-build/ios/Build/Products/Release-iphoneos/App.app}"
tmp=""
signed_ipa=false
cleanup() {
  if [[ -n "$tmp" ]]; then rm -rf "$tmp"; fi
}
trap cleanup EXIT

if [[ "$input" == *.ipa ]]; then
  signed_ipa=true
  if [[ ! -s "$input" ]]; then
    echo "iOS IPA not found: $input" >&2
    exit 1
  fi
  tmp="$(mktemp -d)"
  unzip -q "$input" -d "$tmp"
  app="$(find "$tmp/Payload" -maxdepth 1 -type d -name '*.app' -print -quit)"
else
  app="$input"
fi

if [[ -z "${app:-}" || ! -d "$app" ]]; then
  echo "iOS app bundle not found in: $input" >&2
  exit 1
fi

plist="$app/Info.plist"
exe="$app/App"
for required in "$plist" "$exe" "$app/PrivacyInfo.xcprivacy" \
  "$app/Frameworks/Capacitor.framework/PrivacyInfo.xcprivacy" \
  "$app/Frameworks/Cordova.framework/PrivacyInfo.xcprivacy" \
  "$app/public/room.html" "$app/public/room.css" "$app/public/room-ui.css" "$app/public/room.js"; do
  if [[ ! -e "$required" ]]; then
    echo "iOS artifact is missing required file: $required" >&2
    exit 1
  fi
done

plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$1" "$plist"
}

[[ "$(plist_value CFBundleIdentifier)" == "com.javin23863.linguarelay" ]] || {
  echo "Unexpected iOS bundle identifier." >&2
  exit 1
}
expected_build="${LINGUA_IOS_BUILD_NUMBER:-}"
if [[ -n "$expected_build" ]]; then
  if [[ ! "$expected_build" =~ ^[1-9][0-9]*$ ]]; then
    echo "iOS artifact check: LINGUA_IOS_BUILD_NUMBER is invalid." >&2
    exit 1
  fi
  if [[ "$(plist_value CFBundleVersion)" != "$expected_build" ]]; then
    echo "iOS artifact check: packaged CFBundleVersion does not match the release build number." >&2
    exit 1
  fi
fi
[[ "$(plist_value UIRequiredDeviceCapabilities:0)" == "arm64" ]] || {
  echo "iOS app must require arm64." >&2
  exit 1
}
[[ -n "$(plist_value NSCameraUsageDescription)" ]] || {
  echo "iOS camera usage description is missing." >&2
  exit 1
}
[[ -n "$(plist_value NSMicrophoneUsageDescription)" ]] || {
  echo "iOS microphone usage description is missing." >&2
  exit 1
}

archs="$(lipo -archs "$exe")"
if [[ " $archs " != *" arm64 "* || " $archs " == *" x86_64 "* ]]; then
  echo "Unexpected iOS executable architectures: $archs" >&2
  exit 1
fi

if [[ "$signed_ipa" == true ]]; then
  profile="$app/embedded.mobileprovision"
  [[ -f "$profile" ]] || {
    echo "Signed iOS IPA is missing embedded.mobileprovision." >&2
    exit 1
  }
  [[ "${APPLE_TEAM_ID:-}" =~ ^[A-Z0-9]{10}$ ]] || {
    echo "Signed iOS verification requires a valid APPLE_TEAM_ID." >&2
    exit 1
  }
  codesign --verify --deep --strict "$app" || {
    echo "Signed iOS IPA failed code-signature verification." >&2
    exit 1
  }
  profile_plist="$tmp/embedded-profile.plist"
  security cms -D -i "$profile" > "$profile_plist"
  profile_team="$(/usr/libexec/PlistBuddy -c 'Print :TeamIdentifier:0' "$profile_plist")"
  profile_app_id="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$profile_plist")"
  [[ "$profile_team" == "$APPLE_TEAM_ID" ]] || {
    echo "Signed iOS IPA provisioning Team ID does not match APPLE_TEAM_ID." >&2
    exit 1
  }
  [[ "$profile_app_id" == "$APPLE_TEAM_ID.com.javin23863.linguarelay" ]] || {
    echo "Signed iOS IPA provisioning profile does not match the Lingua Relay bundle identity." >&2
    exit 1
  }
  get_task_allow="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:get-task-allow' "$profile_plist" 2>/dev/null || echo false)"
  [[ "$get_task_allow" != "true" ]] || {
    echo "Signed iOS IPA uses a development/debug provisioning entitlement." >&2
    exit 1
  }
  if /usr/libexec/PlistBuddy -c 'Print :ProvisionedDevices' "$profile_plist" >/dev/null 2>&1; then
    echo "Signed iOS IPA uses a device-scoped provisioning profile instead of App Store distribution." >&2
    exit 1
  fi
  provisions_all_devices="$(/usr/libexec/PlistBuddy -c 'Print :ProvisionsAllDevices' "$profile_plist" 2>/dev/null || echo false)"
  [[ "$provisions_all_devices" != "true" ]] || {
    echo "Signed iOS IPA uses an enterprise provisioning profile instead of App Store distribution." >&2
    exit 1
  }
fi

tracking="$(/usr/libexec/PlistBuddy -c 'Print :NSPrivacyTracking' "$app/PrivacyInfo.xcprivacy")"
[[ "$tracking" == "false" ]] || {
  echo "App privacy manifest must declare tracking disabled." >&2
  exit 1
}

room="$app/public/room.html"
if grep -q 'id="participantCount" aria-live="polite">0 / 4 people<' "$room"; then
  echo "Packaged iOS room still contains the retired four-person fallback." >&2
  exit 1
fi
grep -q 'id="participantCount" aria-live="polite">0 / 2 people<' "$room" || {
  echo "Packaged iOS room is missing the two-person fallback." >&2
  exit 1
}
grep -q '<link rel="stylesheet" href="/room.css">' "$room" || {
  echo "Packaged iOS room is missing external room.css." >&2
  exit 1
}
grep -q '<link rel="stylesheet" href="/room-ui.css">' "$room" || {
  echo "Packaged iOS room is missing the Lingua room presentation layer." >&2
  exit 1
}
grep -q '<script src="/room.js"></script>' "$room" || {
  echo "Packaged iOS room is missing external room.js." >&2
  exit 1
}
if grep -q '<style>' "$room" || grep -q '<script>' "$room"; then
  echo "Packaged iOS room still contains inline room implementation." >&2
  exit 1
fi

grep -q '#stage{' "$app/public/room.css" || {
  echo "Packaged iOS room.css is incomplete." >&2
  exit 1
}
grep -q -- '--accent:#64D4C3' "$app/public/room-ui.css" || {
  echo "Packaged iOS room-ui.css is missing the Lingua presentation tokens." >&2
  exit 1
}
grep -q 'prefers-reduced-motion:reduce' "$app/public/room-ui.css" || {
  echo "Packaged iOS room-ui.css is missing reduced-motion handling." >&2
  exit 1
}
grep -q 'async function connect()' "$app/public/room.js" || {
  echo "Packaged iOS room.js is incomplete." >&2
  exit 1
}

if grep -RInaE '127\.0\.0\.1|localhost:8788|test-only-|local-dev-only-|BEGIN PRIVATE KEY|google-play\.json|release\.keystore' \
    "$app/public" "$app/capacitor.config.json" "$app/config.xml" >/dev/null; then
  echo "Packaged iOS web assets contain a development/test credential marker." >&2
  exit 1
fi

if find "$app" -type f \( -name '*.p12' -o -name '*.p8' -o -name '*.keystore' -o -name 'google-services.json' \) \
    -print -quit | grep -q .; then
  echo "Packaged iOS app contains a forbidden credential file." >&2
  exit 1
fi

echo "iOS artifact check: identity, version, signing, provisioning, privacy, architecture, room UI contract and secret hygiene verified."
