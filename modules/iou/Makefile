.DEFAULT_GOAL := build

NODE ?= node
NPM ?= npm
# Capture overrides before assigning defaults, including exported environment values.
PORT_OPTION := $(if $(filter undefined,$(origin PORT)),,--strictPort)
# Publishing rewrites this exact line (see publishing/snapshot-lib.mjs) in standalone snapshots: keep its shape.
PUBLISH_SCRIPT ?= scripts/prepare-shared.mjs
DEST ?=

.PHONY: all help node-check setup build run dev test typecheck lint format check preview prepare-shared

all: build

help:
	@printf '%s\n' \
	  'make build       Build the static PWA in dist/ (default)' \
	  'make run         Start the local development server (PORT=5173)' \
	  'make dev         Alias for make run' \
	  'make preview     Build and serve the production PWA locally (PORT=4173)' \
	  'Port override: append PORT=9000 to run, dev, or preview.' \
	  'Default ports advance when busy; explicit PORT stays fixed. Use the printed URL.' \
	  'make setup       Install missing npm dependencies (Node.js 24+)' \
	  'make test        Run automated behavior tests' \
	  'make typecheck   Check TypeScript without building assets' \
	  'make lint        Check formatting and lint rules with Biome (no changes)' \
	  'make format      Apply Biome formatting and safe lint fixes' \
	  'make check       Run TypeScript, Biome and automated tests' \
	  'make prepare-shared DEST=<Sites checkout>  Prepare a public source snapshot (used by publishing)' \
	  'Publishing: run make -C webapps/everydayapps/publishing publish from the development repository root' \
	  'Supabase settings: see webapps/everydayapps/AGENTS.md.'

node-check:
	@command -v "$(NODE)" >/dev/null 2>&1 || { printf '%s\n' 'Install Node.js 24 or newer; see README.md.' >&2; exit 1; }
	@"$(NODE)" -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("iou requires Node.js 24 or newer; see README.md."); process.exit(1); }'
	@command -v "$(NPM)" >/dev/null 2>&1 || { printf '%s\n' 'Install npm with Node.js; see README.md.' >&2; exit 1; }

setup: node-check
	@if [ ! -f node_modules/.package-lock.json ] || \
	    [ package.json -nt node_modules/.package-lock.json ] || \
	    [ package-lock.json -nt node_modules/.package-lock.json ] || \
	    [ ! -x node_modules/.bin/tsc ] || \
	    [ ! -x node_modules/.bin/biome ] || \
	    [ ! -x node_modules/.bin/vite ] || \
	    [ ! -x node_modules/.bin/vitest ]; then \
	  "$(NPM)" ci --include=dev; \
	fi

build: setup
	"$(NPM)" run build

run dev: PORT ?= 5173
run: setup
	"$(NPM)" run dev -- --host 127.0.0.1 --port "$(PORT)" $(PORT_OPTION)

dev: run

test: setup
	"$(NPM)" test

typecheck: setup
	"$(NPM)" exec tsc -- -b

lint: setup
	"$(NPM)" run lint

format: setup
	"$(NPM)" run format

check: typecheck lint test

preview: PORT ?= 4173
preview: build
	"$(NPM)" run preview -- --host 127.0.0.1 --port "$(PORT)" $(PORT_OPTION)

# Standalone preparation entry point for public source snapshots.
prepare-shared: node-check
	@test -n "$(DEST)" || { printf '%s\n' 'Set DEST to an existing shared Sites repository.' >&2; exit 1; }
	"$(NODE)" "$(PUBLISH_SCRIPT)" "$(DEST)" "$(CURDIR)"

.PHONY: check-site
check-site: node-check
	@test -n "$(SITE)" || { printf '%s\n' 'Set SITE to the prepared website folder.' >&2; exit 1; }
	"$(NODE)" scripts/check-cloud-build.mjs "$(SITE)"
