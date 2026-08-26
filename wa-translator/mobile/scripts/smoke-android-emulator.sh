#!/usr/bin/env bash
set -euo pipefail

APP_ID="com.javin23863.linguarelay"
AVD_NAME="lingua-relay-api36"
SYSTEM_IMAGE="system-images;android-36;google_apis;x86_64"
SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"

if [[ -z "$SDK_ROOT" || ! -d "$SDK_ROOT" ]]; then
  echo "ANDROID_SDK_ROOT/ANDROID_HOME does not point to an Android SDK" >&2
  exit 1
fi

SDKMANAGER="$(find "$SDK_ROOT/cmdline-tools" -type f -name sdkmanager 2>/dev/null | sort | tail -n 1)"
AVDMANAGER="$(find "$SDK_ROOT/cmdline-tools" -type f -name avdmanager 2>/dev/null | sort | tail -n 1)"
for tool in "$SDKMANAGER" "$AVDMANAGER"; do
  if [[ -z "$tool" || ! -x "$tool" ]]; then
    echo "Required Android command-line tool is unavailable: ${tool:-<unset>}" >&2
    exit 1
  fi
done

packages=()
[[ -x "$SDK_ROOT/platform-tools/adb" ]] || packages+=("platform-tools")
[[ -x "$SDK_ROOT/emulator/emulator" ]] || packages+=("emulator")
[[ -d "$SDK_ROOT/system-images/android-36/google_apis/x86_64" ]] || packages+=("$SYSTEM_IMAGE")
if (( ${#packages[@]} )); then
  set +o pipefail
  yes | "$SDKMANAGER" --licenses >/dev/null
  license_status="${PIPESTATUS[1]}"
  set -o pipefail
  if [[ "$license_status" -ne 0 ]]; then
    echo "Could not accept Android SDK licenses for native smoke" >&2
    exit "$license_status"
  fi
  "$SDKMANAGER" --install "${packages[@]}" >/dev/null
fi

EMULATOR="$SDK_ROOT/emulator/emulator"
ADB="$SDK_ROOT/platform-tools/adb"
for tool in "$EMULATOR" "$ADB"; do
  if [[ ! -x "$tool" ]]; then
    echo "Required Android runtime tool is unavailable after SDK provisioning: $tool" >&2
    exit 1
  fi
done

"$AVDMANAGER" delete avd --name "$AVD_NAME" >/dev/null 2>&1 || true
set +o pipefail
echo no | "$AVDMANAGER" create avd --force --name "$AVD_NAME" --package "$SYSTEM_IMAGE" >/dev/null
avd_status="${PIPESTATUS[1]}"
set -o pipefail
if [[ "$avd_status" -ne 0 ]]; then
  echo "Could not create Android smoke AVD" >&2
  exit "$avd_status"
fi

if [[ -e /dev/kvm && ! -w /dev/kvm ]]; then
  sudo chmod 666 /dev/kvm
fi

log_file="${RUNNER_TEMP:-/tmp}/lingua-android-emulator.log"
"$EMULATOR" -avd "$AVD_NAME" -no-window -no-audio -no-boot-anim \
  -gpu swiftshader_indirect -camera-back none -camera-front none \
  -no-snapshot -wipe-data >"$log_file" 2>&1 &
emulator_pid=$!

cleanup() {
  "$ADB" emu kill >/dev/null 2>&1 || true
  kill "$emulator_pid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$ADB" start-server >/dev/null
if ! timeout 180 "$ADB" wait-for-device; then
  cat "$log_file" >&2 || true
  echo "Android emulator did not expose adb within 180 seconds" >&2
  exit 1
fi

booted=0
for _ in $(seq 1 120); do
  if [[ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; then
    booted=1
    break
  fi
  sleep 2
done
if [[ "$booted" -ne 1 ]]; then
  cat "$log_file" >&2 || true
  echo "Android emulator did not finish booting" >&2
  exit 1
fi

"$ADB" shell settings put global window_animation_scale 0
"$ADB" shell settings put global transition_animation_scale 0
"$ADB" shell settings put global animator_duration_scale 0
"$ADB" shell input keyevent 82 || true

chmod +x android/gradlew
(
  cd android
  ./gradlew :app:assembleDebug :app:assembleDebugAndroidTest
)

apk="android/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "$apk" ]]; then
  echo "Debug APK was not produced at $apk" >&2
  exit 1
fi

"$ADB" install -r "$apk" >/dev/null
launch_output="$("$ADB" shell am start -W -n "$APP_ID/.MainActivity" | tr -d '\r')"
printf '%s\n' "$launch_output"
if ! grep -q '^Status: ok$' <<<"$launch_output"; then
  echo "Android MainActivity did not report a successful launch" >&2
  exit 1
fi

sleep 3
app_pid="$("$ADB" shell pidof "$APP_ID" | tr -d '\r[:space:]')"
if [[ ! "$app_pid" =~ ^[0-9]+$ ]]; then
  cat "$log_file" >&2 || true
  echo "Android app process was not alive after launch" >&2
  exit 1
fi

(
  cd android
  ./gradlew :app:connectedDebugAndroidTest
)

echo "Android native smoke passed: $APP_ID launched on API 36 and connected instrumentation completed."
