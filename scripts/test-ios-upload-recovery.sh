#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
work_dir=$(mktemp -d /tmp/bash-upload-checks.XXXXXX)
trap 'rm -rf "$work_dir"' EXIT
# Isolate test footage from the installed app and from other test runs.
python3 - "$work_dir/RecordingLibrary.swift" <<'PY'
import sys
from pathlib import Path
source = Path('ios/BASH/Sources/Capture/RecordingLibrary.swift').read_text()
source = source.replace('URL.documentsDirectory.appending(path: "Recordings")', 'URL.temporaryDirectory.appending(path: "BASHUploadChecks-" + UUID().uuidString)')
Path(sys.argv[1]).write_text(source)
PY
sdk=$(xcrun --sdk iphonesimulator --show-sdk-path)
xcrun swiftc -swift-version 6 -parse-as-library -sdk "$sdk" -target arm64-apple-ios17.0-simulator \
  "$work_dir/RecordingLibrary.swift" ios/BASH/Sources/Capture/CaptureDiagnostics.swift ios/BASH/UploadRecoveryChecks/UploadRecoveryChecks.swift -o "$work_dir/checks"
xcrun simctl spawn booted "$work_dir/checks"
