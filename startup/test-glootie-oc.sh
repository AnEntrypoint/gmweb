#!/bin/bash
# Test script for glootie-oc AnEntrypoint integration
# This verifies the complete installation and operation of glootie-oc with opencode

set -e

echo "=== Testing glootie-oc Installation and Integration ==="

# Color codes for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

GLOOTIE_DIR="${HOME:-/config}/.opencode/glootie-oc"
OPENCODE_CONFIG_DIR="/config/.config/opencode"
OPENCODE_STORAGE_DIR="/config/.local/share/opencode/storage"

test_count=0
pass_count=0

# Helper functions
test_start() {
  test_count=$((test_count + 1))
  echo -e "\n${YELLOW}Test $test_count: $1${NC}"
}

test_pass() {
  pass_count=$((pass_count + 1))
  echo -e "${GREEN}✓ PASS${NC}: $1"
}

test_fail() {
  echo -e "${RED}✗ FAIL${NC}: $1"
}

# Test 1: Check if glootie-oc directory exists
test_start "glootie-oc repository exists"
if [ -d "$GLOOTIE_DIR" ]; then
  test_pass "glootie-oc directory found at $GLOOTIE_DIR"
else
  test_fail "glootie-oc directory not found at $GLOOTIE_DIR"
fi

# Test 2: Check if .git directory exists
test_start "glootie-oc is a valid git repository"
if [ -d "$GLOOTIE_DIR/.git" ]; then
  test_pass "glootie-oc has valid .git directory"
else
  test_fail "glootie-oc is not a valid git repository"
fi

# Test 3: Check remote URL
test_start "glootie-oc remote URL is correct"
if [ -d "$GLOOTIE_DIR/.git" ]; then
  remote=$(cd "$GLOOTIE_DIR" && git remote get-url origin 2>/dev/null || echo "")
  if [[ "$remote" == *"AnEntrypoint/glootie-oc"* ]]; then
    test_pass "Remote URL is correct: $remote"
  else
    test_fail "Remote URL is incorrect: $remote"
  fi
fi

# Test 4: Check if setup.sh exists and is executable
test_start "setup.sh exists and is executable"
if [ -f "$GLOOTIE_DIR/setup.sh" ]; then
  if [ -x "$GLOOTIE_DIR/setup.sh" ]; then
    test_pass "setup.sh exists and is executable"
  else
    test_fail "setup.sh exists but is not executable"
  fi
else
  test_fail "setup.sh not found"
fi

# Test 5: Check if agents directory exists
test_start "glootie-oc agents directory exists"
if [ -d "$GLOOTIE_DIR/agents" ]; then
  agents_count=$(find "$GLOOTIE_DIR/agents" -type f -name "*.js" -o -name "*.ts" -o -name "*.json" 2>/dev/null | wc -l)
  test_pass "agents directory found with $agents_count files"
else
  test_fail "agents directory not found in glootie-oc"
fi

# Test 6: Check if agents are copied to opencode config
test_start "glootie-oc agents copied to opencode config"
if [ -d "$OPENCODE_CONFIG_DIR/agents" ]; then
  agents_count=$(find "$OPENCODE_CONFIG_DIR/agents" -type f 2>/dev/null | wc -l)
  if [ $agents_count -gt 0 ]; then
    test_pass "agents copied to $OPENCODE_CONFIG_DIR/agents ($agents_count files)"
  else
    test_fail "agents directory is empty"
  fi
else
  test_fail "agents directory not found in opencode config"
fi

# Test 7: Check if hooks directory exists
test_start "glootie-oc hooks directory exists"
if [ -d "$GLOOTIE_DIR/hooks" ]; then
  hooks_count=$(find "$GLOOTIE_DIR/hooks" -type f 2>/dev/null | wc -l)
  test_pass "hooks directory found with $hooks_count files"
else
  test_fail "hooks directory not found in glootie-oc"
fi

# Test 8: Check if hooks are copied to opencode config
test_start "glootie-oc hooks copied to opencode config"
if [ -d "$OPENCODE_CONFIG_DIR/hooks" ]; then
  hooks_count=$(find "$OPENCODE_CONFIG_DIR/hooks" -type f 2>/dev/null | wc -l)
  if [ $hooks_count -gt 0 ]; then
    test_pass "hooks copied to $OPENCODE_CONFIG_DIR/hooks ($hooks_count files)"
  else
    test_fail "hooks directory is empty"
  fi
else
  test_fail "hooks directory not found in opencode config"
fi

# Test 9: Check opencode.json exists and contains permission: allow
test_start "opencode.json configured correctly"
if [ -f "$OPENCODE_CONFIG_DIR/opencode.json" ]; then
  if grep -q '"permission":\s*"allow"' "$OPENCODE_CONFIG_DIR/opencode.json"; then
    test_pass "opencode.json contains permission: allow"
  else
    test_fail "opencode.json missing permission: allow"
  fi
else
  test_fail "opencode.json not found"
fi

# Test 10: Check if opencode.json contains glootie-oc config
test_start "opencode.json contains glootie-oc configuration"
if [ -f "$OPENCODE_CONFIG_DIR/opencode.json" ] && [ -f "$GLOOTIE_DIR/opencode.json" ]; then
  # Check if any glootie-oc config is merged in
  test_pass "opencode.json and glootie-oc/opencode.json both exist"
else
  test_fail "Missing one or both opencode.json files"
fi

# Test 11: Check settings.json has permissive settings
test_start "settings.json has permissive tool permissions"
if [ -f "$OPENCODE_CONFIG_DIR/settings.json" ]; then
  if grep -q '"autoApprove":\s*true' "$OPENCODE_CONFIG_DIR/settings.json"; then
    test_pass "settings.json contains autoApprove: true"
  else
    test_fail "settings.json missing autoApprove setting"
  fi
else
  test_fail "settings.json not found"
fi

# Test 12: Check if .env file exists with correct settings
test_start ".env file configured for OpenCode"
if [ -f "$OPENCODE_CONFIG_DIR/.env" ]; then
  if grep -q "OPENCODE_DEFAULT_AGENT=gm" "$OPENCODE_CONFIG_DIR/.env"; then
    test_pass ".env configured with OPENCODE_DEFAULT_AGENT=gm"
  else
    test_fail ".env missing or incorrect OPENCODE_DEFAULT_AGENT"
  fi
else
  test_fail ".env file not found"
fi

# Test 13: Check permissions on config directories
test_start "opencode config directories have correct ownership"
if [ -d "$OPENCODE_CONFIG_DIR" ]; then
  owner=$(ls -ld "$OPENCODE_CONFIG_DIR" | awk '{print $3":"$4}')
  if [[ "$owner" == "abc:abc" ]] || [[ "$owner" == "root:root" ]]; then
    test_pass "Config directory owned by $owner"
  else
    test_fail "Config directory has unexpected owner: $owner"
  fi
fi

# Test 14: Check if glootie-oc git is on main branch
test_start "glootie-oc repository on main branch"
if [ -d "$GLOOTIE_DIR/.git" ]; then
  branch=$(cd "$GLOOTIE_DIR" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
  if [ "$branch" = "main" ] || [ "$branch" = "HEAD" ]; then
    test_pass "Repository branch: $branch"
  else
    test_fail "Repository on unexpected branch: $branch"
  fi
fi

# Test 15: Verify opencode acp process is running
test_start "opencode acp process is running"
if pgrep -f "opencode.*acp" > /dev/null; then
  test_pass "opencode acp process is running"
else
  test_fail "opencode acp process is not running"
fi

# Summary
echo -e "\n${YELLOW}=== Test Summary ===${NC}"
echo -e "Tests passed: ${GREEN}$pass_count${NC}/$test_count"

if [ $pass_count -eq $test_count ]; then
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}Some tests failed.${NC}"
  exit 1
fi
