#!/usr/bin/env bash
set -euo pipefail

APP_ID="com.javin23863.linguarelay"
DERIVED_DATA="build/ios-simulator"
APP_PATH="$DERIVED_DATA/Build/Products/Debug-iphonesimulator/App.app"
DEVICE_JSON="${RUNNER_TEMP:-/tmp}/lingua-sim-devices.json"

xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  build

if [[ ! -d "$APP_PATH" ]]; then
  echo "Simulator app bundle was not produced at $APP_PATH" >&2
  exit 1
fi

xcrun simctl list devices available -j > "$DEVICE_JSON"
udid="$(python3 - "$DEVICE_JSON" <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)

candidates = []
for runtime, devices in data.get("devices", {}).items():
    match = re.search(r"iOS-(\d+)(?:-(\d+))?", runtime)
    if not match:
        continue
    version = (int(match.group(1)), int(match.group(2) or 0))
    for device in devices:
        if not device.get("isAvailable", True):
            continue
        name = str(device.get("name", ""))
        udid = str(device.get("udid", ""))
        if "iPhone" in name and udid:
            candidates.append((version, name, udid))

if not candidates:
    raise SystemExit("No available iPhone simulator is installed")

candidates.sort(reverse=True)
print(candidates[0][2])
PY
)"

if [[ -z "$udid" ]]; then
  echo "Could not resolve an available iPhone simulator" >&2
  exit 1
fi

cleanup() {
  xcrun simctl terminate "$udid" "$APP_ID" >/dev/null 2>&1 || true
  xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

xcrun simctl boot "$udid" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$udid" -b
xcrun simctl install "$udid" "$APP_PATH"

if ! xcrun simctl listapps "$udid" | grep -Fq "$APP_ID"; then
  echo "Lingua Relay was not installed in the selected simulator" >&2
  exit 1
fi

launch_output="$(xcrun simctl launch "$udid" "$APP_ID")"
printf '%s\n' "$launch_output"
if [[ ! "$launch_output" =~ ^${APP_ID}:[[:space:]]+([0-9]+)$ ]]; then
  echo "Simulator did not return a Lingua Relay process id" >&2
  exit 1
fi
app_pid="${BASH_REMATCH[1]}"

sleep 3
if ! xcrun simctl spawn "$udid" /bin/sh -c "kill -0 $app_pid"; then
  echo "Lingua Relay simulator process exited immediately after launch" >&2
  exit 1
fi

xcrun simctl terminate "$udid" "$APP_ID"
echo "iOS native smoke passed: $APP_ID installed, launched, and remained alive in Simulator."
