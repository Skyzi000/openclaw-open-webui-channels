#!/usr/bin/env bash
# =============================================================================
# Open WebUI Plugin Test Runner
# =============================================================================
# Runs HURL integration tests against a live Open WebUI + OpenClaw instance.
#
# Commands:
#   --test [suite]    Run test suite (01, 02, 03, or all)
#   --status          Check if Open WebUI and OpenClaw are reachable
#   (no args)         Show help
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VARS_FILE="$SCRIPT_DIR/env.vars"

# Load base_url from env.vars
BASE_URL=$(grep "^base_url=" "$VARS_FILE" | cut -d= -f2-)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

log()  { echo -e "${CYAN}[TEST]${NC} $*"; }
ok()   { echo -e "${GREEN}  OK${NC}  $*"; }
err()  { echo -e "${RED}FAIL${NC}  $*"; }

cmd_help() {
    echo ""
    echo -e "${BOLD}Open WebUI Plugin Test Runner${NC}"
    echo ""
    echo -e "  ${CYAN}--test${NC}              Run all test suites"
    echo -e "  ${CYAN}--test 01${NC}           Suite 1: Auth & Channel Discovery"
    echo -e "  ${CYAN}--test 02${NC}           Suite 2: Messaging Basics"
    echo -e "  ${CYAN}--test 03${NC}           Suite 3: Mention Routing (E2E)"
    echo -e "  ${CYAN}--status${NC}            Check service reachability"
    echo ""
    echo -e "${DIM}Env vars: $VARS_FILE${NC}"
    echo ""
}

cmd_status() {
    echo ""
    echo -e "${BOLD}Status${NC}"
    echo ""

    if curl -sf "$BASE_URL" >/dev/null 2>&1; then
        echo -e "  Open WebUI:  ${GREEN}reachable${NC}  $BASE_URL"
    else
        echo -e "  Open WebUI:  ${RED}unreachable${NC}  $BASE_URL"
    fi

    # Check OpenClaw gateway (assume standard port)
    if curl -sf "http://localhost:18789" >/dev/null 2>&1; then
        echo -e "  OpenClaw:    ${GREEN}reachable${NC}  http://localhost:18789"
    else
        echo -e "  OpenClaw:    ${RED}unreachable${NC}  http://localhost:18789"
    fi

    echo ""
}

cmd_test() {
    local suite="${1:-all}"

    command -v hurl >/dev/null 2>&1 || { err "hurl not installed (https://hurl.dev)"; exit 1; }

    # Pre-flight: check Open WebUI is reachable
    if ! curl -sf "$BASE_URL" >/dev/null 2>&1; then
        err "Open WebUI not reachable at $BASE_URL"
        exit 1
    fi

    REPORT_DIR="$SCRIPT_DIR/.test-report"
    mkdir -p "$REPORT_DIR"

    HURL_OPTS="--variables-file $VARS_FILE --test --report-html $REPORT_DIR"

    run_suite_01() {
        log "Suite 1/3: Auth & Channel Discovery..."
        hurl $HURL_OPTS "$SCRIPT_DIR/01-auth-and-channels.hurl"
    }

    run_suite_02() {
        log "Suite 2/3: Messaging Basics..."
        hurl $HURL_OPTS "$SCRIPT_DIR/02-messaging-basics.hurl"
    }

    run_suite_03() {
        log "Suite 3/3: Mention Routing (E2E)..."
        hurl $HURL_OPTS "$SCRIPT_DIR/03-mention-routing.hurl"
    }

    case "$suite" in
        01) run_suite_01 ;;
        02) run_suite_02 ;;
        03) run_suite_03 ;;
        all)
            log "Running all test suites..."
            echo ""
            run_suite_01
            echo ""
            run_suite_02
            echo ""
            run_suite_03
            ;;
        *)
            err "Unknown suite: $suite (use 01, 02, 03, or omit for all)"
            exit 1
            ;;
    esac

    echo ""
    ok "Done. HTML report: $REPORT_DIR/index.html"
}

# ---- Main ----
case "${1:-}" in
    --test)   cmd_test "${2:-all}" ;;
    --status) cmd_status ;;
    *)        cmd_help ;;
esac
