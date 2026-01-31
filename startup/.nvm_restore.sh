#!/bin/bash
# NVM Restore Shim - Source this after loading NVM to restore npm config
# This ensures npm continues using centralized cache after NVM is loaded

# Restore .npmrc file
if [ -f "${HOME}/.npmrc.nvmbackup" ]; then
  mv "${HOME}/.npmrc.nvmbackup" "${HOME}/.npmrc" 2>/dev/null || true
fi

# Restore npm config environment variables
export npm_config_cache="${_SAVED_npm_config_cache:-/config/.gmweb/npm-cache}"
export npm_config_prefix="${_SAVED_npm_config_prefix:-/config/.gmweb/npm-global}"
export NPM_CONFIG_CACHE="${_SAVED_NPM_CONFIG_CACHE:-/config/.gmweb/npm-cache}"
export NPM_CONFIG_PREFIX="${_SAVED_NPM_CONFIG_PREFIX:-/config/.gmweb/npm-global}"

# Clean up saved vars
unset _SAVED_npm_config_cache _SAVED_npm_config_prefix _SAVED_NPM_CONFIG_CACHE _SAVED_NPM_CONFIG_PREFIX
