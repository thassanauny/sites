.DEFAULT_GOAL := build
NODE ?= node
NPM ?= npm
# Capture overrides before assigning defaults, including exported environment values.
PORT_OPTION := $(if $(filter undefined,$(origin PORT)),,--strictPort)

.PHONY: help node-check setup build run dev preview test test-browser typecheck check

help:
	@printf '%s\n' \
	  'Browser only: Make, Node.js 24+ and npm; online Supabase required for shared boards.' \
	  'make setup      Install or refresh missing npm dependencies' \
	  'make build      Build static files into dist/ (default; no publishing)' \
	  'make run        Start the loopback development server (PORT=5173)' \
	  'make dev        Alias for run' \
	  'make preview    Build and serve dist/ on loopback (PORT=4173)' \
	  'Port override: append PORT=9000 to run, dev, or preview.' \
	  'Default ports advance when busy; explicit PORT stays fixed. Use the printed URL.' \
	  'make test       Run UI/client/config behavior and embedded Postgres tests' \
	  'make test-browser  Browser behavior tests; half the CPUs as workers, 2-4 (BROWSER_WORKERS=1 for lowest CPU); downloads Chromium if missing' \
	  'make typecheck  Check TypeScript' \
	  'make check      Run all applicable checks' \
	  'Supabase settings: see AGENTS.md for the shared defaults and their precedence.'

node-check:
	@command -v "$(NODE)" >/dev/null 2>&1 || { printf '%s\n' 'Install Node.js 24 or newer; see README.md.' >&2; exit 1; }
	@"$(NODE)" -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("Blueprint requires Node.js 24 or newer; see README.md."); process.exit(1); }'
	@command -v "$(NPM)" >/dev/null 2>&1 || { printf '%s\n' 'Install npm with Node.js; see README.md.' >&2; exit 1; }

setup: node-check
	@if [ ! -f node_modules/.package-lock.json ] || \
	    [ package.json -nt node_modules/.package-lock.json ] || \
	    [ package-lock.json -nt node_modules/.package-lock.json ] || \
	    [ ! -x node_modules/.bin/tsc ] || \
	    [ ! -x node_modules/.bin/vite ] || \
	    [ ! -x node_modules/.bin/vitest ] || \
	    [ ! -x node_modules/.bin/playwright ]; then \
	  "$(NPM)" ci --include=dev; \
	fi

build: setup
	"$(NPM)" run build

run dev: PORT ?= 5173
run: setup
	"$(NPM)" run dev -- --host 127.0.0.1 --port "$(PORT)" $(PORT_OPTION)

dev: run

preview: PORT ?= 4173
preview: build
	"$(NPM)" run preview -- --host 127.0.0.1 --port "$(PORT)" $(PORT_OPTION)

test: setup
	"$(NPM)" test

test-browser: setup
	"$(NPM)" exec playwright -- install chromium
	"$(NPM)" run test:e2e$(if $(BROWSER_WORKERS), -- --workers="$(BROWSER_WORKERS)")

typecheck: setup
	"$(NPM)" exec tsc -- -b

check: typecheck test test-browser

.PHONY: prepare-shared
prepare-shared: node-check
	"$(NODE)" scripts/prepare-shared.mjs "$(SITE_CHECKOUT)"

.PHONY: check-site
check-site: node-check
	@test -n "$(SITE)" || { printf '%s\n' 'Set SITE to the prepared website folder.' >&2; exit 1; }
	"$(NODE)" scripts/check-shared-build.mjs "$(SITE)" blueprint
