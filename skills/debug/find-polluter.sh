#!/usr/bin/env bash
# find-polluter.sh: run test files one by one until a given path shows up,
# which names the test that leaves that file or directory behind.
#
# Arguments: <file_or_dir_to_check> <test_pattern>
# e.g. bash find-polluter.sh .git 'src/**/*.test.ts'
#
# Exit codes: 0 = no test created the path, 1 = polluter found (or bad usage).
# Each file is run with `npm test <file>` from the current directory.

set -e

usage() {
  echo "Usage: $0 <file_to_check> <test_pattern>"
  echo "Example: $0 '.git' 'src/**/*.test.ts'"
  exit 1
}

[ $# -eq 2 ] || usage

target="$1"
pattern="$2"

echo "🔍 Searching for test that creates: $target"
echo "Test pattern: $pattern"
echo ""

# find prints paths as ./x, so drop a leading ./ the caller may have typed.
pattern="${pattern#./}"
# find's -path never lets '**/' match zero directories; adding a second
# pattern with every '**/' removed picks up files sitting right at the base.
flat="${pattern//\*\*\//}"

candidates=()
while IFS= read -r path; do
  [ -n "$path" ] && candidates+=("$path")
done < <(find . \( -path "./$pattern" -o -path "./$flat" \) | sort -u)

total=${#candidates[@]}
echo "Found $total test files"
echo ""

n=0
for test_file in ${candidates[@]+"${candidates[@]}"}; do
  n=$((n + 1))

  # The path is already present, so this run could not show who made it.
  if [ -e "$target" ]; then
    echo "⚠️  Pollution already exists before test $n/$total"
    echo "   Skipping: $test_file"
    continue
  fi

  echo "[$n/$total] Testing: $test_file"
  npm test "$test_file" > /dev/null 2>&1 || true

  if [ -e "$target" ]; then
    echo ""
    echo "🎯 FOUND POLLUTER!"
    echo "   Test: $test_file"
    echo "   Created: $target"
    echo ""
    echo "Pollution details:"
    ls -la "$target"
    echo ""
    echo "To investigate:"
    echo "  npm test $test_file    # Run just this test"
    echo "  cat $test_file         # Review test code"
    exit 1
  fi
done

echo ""
echo "✅ No polluter found - all tests clean!"
exit 0
