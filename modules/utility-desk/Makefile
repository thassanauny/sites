.DEFAULT_GOAL := build

NPM ?= npm
NODE ?= node
# Capture overrides before assigning defaults, including exported environment values.
PORT_OPTION := $(if $(filter undefined,$(origin PORT)),,--strictPort)
PUBLISH_SCRIPT ?= scripts/prepare-shared.mjs
DEST ?=

.PHONY: all help runtime setup build run dev preview typecheck lint format test test-js check prepare-shared

all: build

help:
	@printf '%s\n' \
	  'make build           Build the static app in dist/ (default)' \
	  'make run             Start the local development server (PORT=5173)' \
	  'make dev             Alias for make run' \
	  'make preview         Build and serve the production app (PORT=4173)' \
	  'Port override: append PORT=9000 to run, dev, or preview.' \
	  'Default ports advance when busy; explicit PORT stays fixed. Use the printed URL.' \
	  'make setup           Install missing npm dependencies (Node.js 24+)' \
	  'make check           Run TypeScript checks, lint, format check, and tests' \
	  'make typecheck       Check TypeScript without building assets' \
	  'make lint            Run ESLint only' \
	  'make format          Run the Biome format and lint check (no changes written)' \
	  'make test            Run tests only' \
	  'Publishing: run make -C publishing publish from the development repository root'

runtime:
	@$(NODE) -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("Utility Desk Lite requires Node.js 24 or newer; see README.md."); process.exit(1); }'

setup: runtime
	@if [ ! -f node_modules/.package-lock.json ] || \
	    [ ! -x node_modules/.bin/vite ] || \
	    [ ! -x node_modules/.bin/tsc ] || \
	    [ ! -x node_modules/.bin/eslint ] || \
	    [ ! -x node_modules/.bin/biome ] || \
	    [ ! -x node_modules/.bin/vitest ] || \
	    [ package.json -nt node_modules/.package-lock.json ] || \
	    [ package-lock.json -nt node_modules/.package-lock.json ]; then \
	  $(NPM) ci --include=dev; \
	fi

build: setup
	$(NPM) run build

run dev: PORT ?= 5173
run: setup
	$(NPM) run dev -- --host 127.0.0.1 --port $(PORT) $(PORT_OPTION)

dev: run

preview: PORT ?= 4173
preview: build
	$(NPM) run preview -- --host 127.0.0.1 --port $(PORT) $(PORT_OPTION)

typecheck: setup
	$(NPM) exec tsc -- --noEmit

lint: setup
	$(NPM) run lint

format: setup
	$(NPM) run format

test: setup
	$(NPM) test

test-js: test

check: typecheck lint format test

# Standalone entry point of the publishing flow: prepare the public source snapshot in an existing Sites checkout
# (make prepare-shared DEST=<Sites checkout>). The publishing script retargets PUBLISH_SCRIPT and this target in its copy.
prepare-shared: runtime
	@test -n "$(DEST)" || { printf '%s\n' 'Set DEST to an existing shared Sites repository.' >&2; exit 1; }
	$(NODE) "$(PUBLISH_SCRIPT)" "$(DEST)" "$(CURDIR)"
