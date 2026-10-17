.DEFAULT_GOAL := build
NODE ?= node
NPM ?= npm
# Capture overrides before assigning defaults, including exported environment values.
PORT_OPTION := $(if $(filter undefined,$(origin PORT)),,--strictPort)

.PHONY: help node-check setup build run dev preview test test-postgres typecheck lint format check

help:
	@printf '%s\n' \
	  'Browser only: Make, Node.js 24+ and npm; online Supabase required for shared boards.' \
	  'make setup      Install or refresh missing npm dependencies' \
	  'make build      Build static files into dist/ (default; no publishing)' \
	  'make run        Start the loopback development server (PORT=5174)' \
	  'make dev        Alias for run' \
	  'make preview    Build and serve dist/ on loopback (PORT=4174)' \
	  'Port override: append PORT=9000 to run, dev, or preview.' \
	  'Default ports advance when busy; explicit PORT stays fixed. Use the printed URL.' \
	  'make test       Run UI/client/config behavior and embedded Postgres tests' \
	  'make test-postgres  Optional concurrency checks; requires running Docker and a local PostgreSQL 17 image' \
	  '                   POSTGRES_IMAGE environment override; default postgres:17-alpine, no image download' \
	  'make typecheck  Check TypeScript' \
	  'make lint       Check formatting and lint rules with Biome (no changes written)' \
	  '                make format applies the formatter and safe lint fixes' \
	  'make check      Run all applicable checks' \
	  'Supabase settings: see AGENTS.md for the shared defaults and their precedence.'

node-check:
	@command -v "$(NODE)" >/dev/null 2>&1 || { printf '%s\n' 'Install Node.js 24 or newer; see README.md.' >&2; exit 1; }
	@"$(NODE)" -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("Pinboard requires Node.js 24 or newer; see README.md."); process.exit(1); }'
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

run dev: PORT ?= 5174
run: setup
	"$(NPM)" run dev -- --host 127.0.0.1 --port "$(PORT)" $(PORT_OPTION)

dev: run

preview: PORT ?= 4174
preview: build
	"$(NPM)" run preview -- --host 127.0.0.1 --port "$(PORT)" $(PORT_OPTION)

test: setup
	"$(NPM)" test

test-postgres: setup
	"$(NODE)" supabase/postgres-check.mjs

typecheck: setup
	"$(NPM)" exec tsc -- -b

lint: setup
	"$(NPM)" exec biome -- check .

format: setup
	"$(NPM)" exec biome -- check --write .

check: typecheck lint test

.PHONY: prepare-shared
prepare-shared: node-check
	"$(NODE)" scripts/prepare-shared.mjs "$(SITE_CHECKOUT)"

.PHONY: check-site
check-site: node-check
	@test -n "$(SITE)" || { printf '%s\n' 'Set SITE to the prepared website folder.' >&2; exit 1; }
	"$(NODE)" scripts/check-shared-build.mjs "$(SITE)" pinboard
