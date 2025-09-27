#!/usr/bin/env bash

set -euo pipefail


SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(pwd)

SCHEME=${SCHEME:-PdfiumKit}
PROJECT=${PROJECT:-PdfiumKit.xcodeproj}
CONFIGURATION=${CONFIGURATION:-Release}
OUTPUT_DIR=${OUTPUT_DIR:-$REPO_ROOT/build}
DERIVED_DATA="$OUTPUT_DIR/DerivedData"
PDFIUM_INCLUDE_DIR=${PDFIUM_INCLUDE_DIR:-}

IOS_ARCHIVE_DIR="$OUTPUT_DIR/archives/ios"
SIM_ARCHIVE_DIR="$OUTPUT_DIR/archives/ios-sim"
XCFRAMEWORK_OUT="$OUTPUT_DIR/${SCHEME}.xcframework"

echo "[i] Using:" \
  "\n   SCHEME=$SCHEME" \
  "\n   PROJECT=$PROJECT" \
  "\n   CONFIGURATION=$CONFIGURATION" \
  "\n   OUTPUT_DIR=$OUTPUT_DIR"

command -v xcodebuild >/dev/null 2>&1 || { echo "[!] xcodebuild not found. Install Xcode/Xcode CLT."; exit 1; }

mkdir -p "$OUTPUT_DIR"
rm -rf "$IOS_ARCHIVE_DIR.xcarchive" "$SIM_ARCHIVE_DIR.xcarchive" "$XCFRAMEWORK_OUT"

if [[ -z "${PDFIUM_INCLUDE_DIR:-}" ]]; then
  XCFRAMEWORK_PATH="lib/pdfium.xcframework" # $(rg -n "path = .*pdfium\\.xcframework;" "$REPO_ROOT/PdfiumKit.xcodeproj/project.pbxproj" -S | sed -E 's/.*path = ([^;]+);.*/\1/' | head -n1)
  if [[ -n "$XCFRAMEWORK_PATH" ]]; then
    if [[ "$XCFRAMEWORK_PATH" != /* ]]; then
      echo $REPO_ROOT
      echo $XCFRAMEWORK_PATH
      XCFRAMEWORK_PATH=$(cd "$REPO_ROOT/$(dirname "$XCFRAMEWORK_PATH")" && pwd)/$(basename "$XCFRAMEWORK_PATH")
    fi
    CANDIDATE="$XCFRAMEWORK_PATH/ios-arm64/Headers"
    if [[ -f "$CANDIDATE/public/fpdfview.h" ]]; then
      PDFIUM_INCLUDE_DIR="$CANDIDATE"
      echo "[i] Auto-detected PDFIUM_INCLUDE_DIR: $PDFIUM_INCLUDE_DIR"
    fi
  fi
fi

if [[ -z "${PDFIUM_INCLUDE_DIR:-}" ]]; then
  echo "[!] PDFIUM_INCLUDE_DIR not set. Set it to the folder that contains 'public/fpdfview.h' (e.g., /path/to/pdfium/include)."
  echo "    Example: PDFIUM_INCLUDE_DIR=/absolute/path/to/pdfium/include $0"
  exit 2
fi
if [[ ! -f "$PDFIUM_INCLUDE_DIR/public/fpdfview.h" ]]; then
  echo "[!] Could not find $PDFIUM_INCLUDE_DIR/public/fpdfview.h. Check PDFIUM_INCLUDE_DIR."
  exit 2
fi


INCLUDE_ROOT="$OUTPUT_DIR/PDFium/include"
mkdir -p "$INCLUDE_ROOT"
if [[ -e "$INCLUDE_ROOT/public" ]]; then rm -rf "$INCLUDE_ROOT/public"; fi
ln -s "$PDFIUM_INCLUDE_DIR/public" "$INCLUDE_ROOT/public"
MODULEMAP_PATH="$INCLUDE_ROOT/module.modulemap"
cat > "$MODULEMAP_PATH" <<EOF
module PDFium [system] {
  umbrella "public"
  exclude header "public/cpp/fpdf_deleters.h"
  exclude header "public/cpp/fpdf_scopers.h"
  export *
}
EOF
echo "[i] Using modulemap at: $MODULEMAP_PATH"

run_xcodebuild() {
  xcodebuild "$@"
}

echo "[i] Archiving iOS (device)…"
run_xcodebuild archive \
  -project "$REPO_ROOT/$PROJECT" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -destination 'generic/platform=iOS' \
  -archivePath "$IOS_ARCHIVE_DIR" \
  -derivedDataPath "$DERIVED_DATA" \
  SKIP_INSTALL=NO \
  BUILD_LIBRARY_FOR_DISTRIBUTION=YES \
  SUPPORTS_MACCATALYST=NO \
  HEADER_SEARCH_PATHS=\"$INCLUDE_ROOT\" \
  SWIFT_INCLUDE_PATHS=\"$INCLUDE_ROOT\" \
  CLANG_ENABLE_MODULES=YES \
  ENABLE_MODULE_VERIFIER=NO \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  DEVELOPMENT_TEAM=

echo "[i] Archiving iOS Simulator…"
run_xcodebuild archive \
  -project "$REPO_ROOT/$PROJECT" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -destination 'generic/platform=iOS Simulator' \
  -archivePath "$SIM_ARCHIVE_DIR" \
  -derivedDataPath "$DERIVED_DATA" \
  SKIP_INSTALL=NO \
  BUILD_LIBRARY_FOR_DISTRIBUTION=YES \
  SUPPORTS_MACCATALYST=NO \
  HEADER_SEARCH_PATHS=\"$INCLUDE_ROOT\" \
  SWIFT_INCLUDE_PATHS=\"$INCLUDE_ROOT\" \
  CLANG_ENABLE_MODULES=YES \
  ENABLE_MODULE_VERIFIER=NO \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  DEVELOPMENT_TEAM=

IOS_FRAMEWORK="$IOS_ARCHIVE_DIR.xcarchive/Products/Library/Frameworks/${SCHEME}.framework"
SIM_FRAMEWORK="$SIM_ARCHIVE_DIR.xcarchive/Products/Library/Frameworks/${SCHEME}.framework"

if [[ ! -d "$IOS_FRAMEWORK" || ! -d "$SIM_FRAMEWORK" ]]; then
  echo "[!] Expected framework not found after archive." \
       "\niOS: $IOS_FRAMEWORK" \
       "\nSim: $SIM_FRAMEWORK"
  exit 1
fi

echo "[i] Creating XCFramework…"
xcodebuild -create-xcframework \
  -framework "$IOS_FRAMEWORK" \
  -framework "$SIM_FRAMEWORK" \
  -output "$XCFRAMEWORK_OUT"

echo "[✓] XCFramework created at: $XCFRAMEWORK_OUT"

TEST_DIR="$OUTPUT_DIR/test"
mkdir -p "$TEST_DIR"
cat > "$TEST_DIR/TestImport.swift" <<'SWIFT'
import Foundation
import PdfiumKit
struct _PdfiumKitImportSmoke { }
SWIFT

SIM_SDK=$(xcrun --sdk iphonesimulator --show-sdk-path)
MODULE_CACHE_DIR="$OUTPUT_DIR/modulecache"
mkdir -p "$MODULE_CACHE_DIR"

SIM_VARIANT_DIR=$(find "$XCFRAMEWORK_OUT" -type d -name '*simulator*' -maxdepth 1 2>/dev/null | head -n1)
if [[ -z "${SIM_VARIANT_DIR:-}" ]]; then
  SIM_VARIANT_DIR=$(find "$XCFRAMEWORK_OUT" -type d -name '*simulator*' 2>/dev/null | head -n1)
fi

if [[ -z "${SIM_VARIANT_DIR:-}" ]]; then
  echo "[!] Could not locate simulator slice in $XCFRAMEWORK_OUT"
  exit 1
fi

echo "[i] Typechecking Swift import against simulator slice…"
swiftc -typecheck \
  -target arm64-apple-ios13.0-simulator \
  -sdk "$SIM_SDK" \
  -F "$SIM_VARIANT_DIR" \
  -framework "$SCHEME" \
  -I "$INCLUDE_ROOT" \
  -module-cache-path "$MODULE_CACHE_DIR" \
  "$TEST_DIR/TestImport.swift"

echo "[✓] Swift import/typecheck succeeded for simulator."

echo "[i] Done. Output: $XCFRAMEWORK_OUT"
