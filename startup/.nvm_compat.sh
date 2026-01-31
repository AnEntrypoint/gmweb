#!/bin/bash
# NVM Compatibility Shim - Source this before loading NVM anywhere
# NVM is incompatible with npm config vars and .npmrc prefix setting
# This script safely hides them during NVM operations, then restores them

# Save original npm config if set
export _SAVED_npm_config_cache="${npm_config_cache:-}"
export _SAVED_npm_config_prefix="${npm_config_prefix:-}"
export _SAVED_NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-}"
export _SAVED_NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-}"

# Unset all npm config environment variables
unset npm_config_cache npm_config_prefix NPM_CONFIG_CACHE NPM_CONFIG_PREFIX

# Hide .npmrc file (rename temporarily)
if [ -f "${HOME}/.npmrc" ]; then
  mv "${HOME}/.npmrc" "${HOME}/.npmrc.nvmbackup" 2>/dev/null || true
fi
