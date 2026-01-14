#!/bin/bash
# Docker entrypoint for gmweb service
# Handles service startup, recovery, and graceful shutdown

set -o pipefail

# Configuration
readonly LOG_LEVEL="${LOG_LEVEL:-info}"
readonly SERVICE_STARTUP_TIMEOUT=30
readonly SERVICE_HEALTH_CHECK_INTERVAL=5
readonly MAX_STARTUP_RETRIES=3
readonly INTERRUPT_SIGNAL="TERM"

# Global state
declare -A SERVICES_PID
declare -i STARTUP_RETRY_COUNT=0
INTERRUPTED=0

# ============================================================================
# Logging Functions
# ============================================================================

log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[${timestamp}] [${level}] ${message}" >&2
}

log_info() { [[ "${LOG_LEVEL}" != "error" ]] && log "INFO" "$@"; }
log_debug() { [[ "${LOG_LEVEL}" == "debug" ]] && log "DEBUG" "$@"; }
log_warn() { log "WARN" "$@"; }
log_error() { log "ERROR" "$@"; }

# ============================================================================
# Signal Handling
# ============================================================================

handle_interrupt() {
    log_info "Received interrupt signal, initiating graceful shutdown..."
    INTERRUPTED=1
    shutdown_services
}

handle_exit() {
    local exit_code=$?
    if [[ ${INTERRUPTED} -eq 0 && ${exit_code} -ne 0 ]]; then
        log_error "Entrypoint exiting with code ${exit_code}"
    fi
    cleanup
    exit ${exit_code}
}

cleanup() {
    log_debug "Cleaning up resources..."
    shutdown_services
    log_info "Cleanup complete"
}

trap handle_interrupt SIGINT SIGTERM
trap handle_exit EXIT

# ============================================================================
# Service Management
# ============================================================================

start_service() {
    local service_name="$1"
    local command="$2"

    log_info "Starting service: ${service_name}"

    # Execute service in background
    eval "${command}" &
    local service_pid=$!
    SERVICES_PID[${service_name}]=${service_pid}

    log_debug "Service ${service_name} started with PID ${service_pid}"
    return 0
}

wait_service_startup() {
    local service_name="$1"
    local timeout="${2:-${SERVICE_STARTUP_TIMEOUT}}"
    local elapsed=0
    local interval=1

    log_debug "Waiting for service ${service_name} to stabilize (timeout: ${timeout}s)..."

    while [[ ${elapsed} -lt ${timeout} ]]; do
        if is_service_running "${service_name}"; then
            log_debug "Service ${service_name} is running"
            return 0
        fi

        sleep ${interval}
        ((elapsed += interval))
    done

    log_warn "Service ${service_name} startup verification timed out after ${timeout}s"
    return 1
}

is_service_running() {
    local service_name="$1"
    local pid=${SERVICES_PID[${service_name}]:-}

    if [[ -z "${pid}" ]]; then
        return 1
    fi

    if kill -0 "${pid}" 2>/dev/null; then
        return 0
    fi

    return 1
}

shutdown_services() {
    log_info "Shutting down services..."

    for service_name in "${!SERVICES_PID[@]}"; do
        local pid=${SERVICES_PID[${service_name}]}

        if kill -0 "${pid}" 2>/dev/null; then
            log_info "Stopping service ${service_name} (PID ${pid})..."
            kill -TERM "${pid}" 2>/dev/null || true

            # Wait for graceful shutdown
            local wait_count=0
            while kill -0 "${pid}" 2>/dev/null && [[ ${wait_count} -lt 10 ]]; do
                sleep 0.5
                ((wait_count++))
            done

            # Force kill if still running
            if kill -0 "${pid}" 2>/dev/null; then
                log_warn "Force killing service ${service_name} (PID ${pid})..."
                kill -9 "${pid}" 2>/dev/null || true
            fi
        fi

        unset 'SERVICES_PID[${service_name}]'
    done

    log_info "All services stopped"
}

monitor_services() {
    local all_running=1

    for service_name in "${!SERVICES_PID[@]}"; do
        if ! is_service_running "${service_name}"; then
            log_warn "Service ${service_name} is not running, initiating recovery..."

            if [[ ${STARTUP_RETRY_COUNT} -lt ${MAX_STARTUP_RETRIES} ]]; then
                ((STARTUP_RETRY_COUNT++))
                log_info "Attempting restart (${STARTUP_RETRY_COUNT}/${MAX_STARTUP_RETRIES})..."
                all_running=0
            else
                log_error "Service ${service_name} failed to restart after ${MAX_STARTUP_RETRIES} attempts"
                all_running=0
            fi
        fi
    done

    return ${all_running}
}

# ============================================================================
# System Preparation
# ============================================================================

prepare_system() {
    log_info "Preparing system..."

    # Fix any broken package installations
    if command -v apt-get &> /dev/null; then
        log_debug "Running apt-get fixes..."
        sudo apt-get --fix-broken install -y >/dev/null 2>&1 || true
        sudo dpkg --configure -a >/dev/null 2>&1 || true
    fi

    # Create necessary directories
    mkdir -p /home/kasm-user/Desktop/Uploads
    mkdir -p /home/kasm-user/.config/autostart
    mkdir -p /tmp/gmweb

    # Set up environment
    export NVM_DIR="/usr/local/nvm"
    if [[ -s "${NVM_DIR}/nvm.sh" ]]; then
        source "${NVM_DIR}/nvm.sh"
        log_debug "NVM initialized"
    fi

    # Verify Node.js availability
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not available"
        return 1
    fi

    log_info "System preparation complete"
    return 0
}

# ============================================================================
# Service Startup Orchestration
# ============================================================================

start_all_services() {
    log_info "Starting gmweb services..."

    # Start Kasm proxy
    if [[ "${ENABLE_PROXYPILOT:-true}" == "true" ]]; then
        start_service "proxypilot" "proxypilot || true"
        wait_service_startup "proxypilot" 5 || log_warn "ProxyPilot startup verification failed"
    fi

    # Start Kasm proxy service
    if [[ -x "${STARTUPDIR}/custom_startup.sh" ]]; then
        start_service "custom" "${STARTUPDIR}/custom_startup.sh || true"
        wait_service_startup "custom" 10 || log_warn "Custom startup verification failed"
    fi

    # Start SSH service if available
    if command -v sshd &> /dev/null && [[ "${ENABLE_SSH:-true}" == "true" ]]; then
        start_service "ssh" "sshd -D || true"
        wait_service_startup "ssh" 5 || log_warn "SSH startup verification failed"
    fi

    # Keep main process alive and monitor services
    log_info "Services started, entering monitoring mode..."
    return 0
}

# ============================================================================
# Health Monitoring Loop
# ============================================================================

health_monitoring_loop() {
    log_info "Entering health monitoring loop..."

    while [[ ${INTERRUPTED} -eq 0 ]]; do
        sleep ${SERVICE_HEALTH_CHECK_INTERVAL}

        # Check if any services have died
        for service_name in "${!SERVICES_PID[@]}"; do
            if ! is_service_running "${service_name}"; then
                log_warn "Service ${service_name} died, recovery needed"
                # Don't auto-restart, let supervisor handle it
            fi
        done
    done

    log_info "Health monitoring loop exited"
}

# ============================================================================
# Main Entrypoint
# ============================================================================

main() {
    log_info "gmweb entrypoint starting (PID $$)"
    log_debug "Log level: ${LOG_LEVEL}"

    # Prepare system
    if ! prepare_system; then
        log_error "System preparation failed"
        return 1
    fi

    # Start all services
    if ! start_all_services; then
        log_error "Service startup failed"
        return 1
    fi

    # Enter monitoring loop
    health_monitoring_loop

    log_info "gmweb entrypoint exiting gracefully"
    return 0
}

# Execute main function
main "$@"
exit $?
