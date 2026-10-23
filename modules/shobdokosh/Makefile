.DEFAULT_GOAL := build
NODE ?= node
NPM ?= npm
UV ?= uv
PORT_OPTION := $(if $(filter undefined,$(origin PORT)),,--port "$(PORT)")

.PHONY: help node-check setup build run dev test test-imports check
help:
	@printf '%s\n' 'Shobdokosh: Make, Node.js 24+, npm; checks also need uv (Python 3.10+).' 'No npm dependencies or compilation required.' 'make setup  Check prerequisites' 'make build  Validate ready-to-serve dist/ (default; no publishing)' 'make run    Start on loopback:4173; advance busy defaults' 'make dev    Alias for run' 'PORT=9000   Use an exact port; fail if busy' 'make test   Run browser-logic tests' 'make check  Syntax, behavior and dictionary-import tests'
node-check:
	@command -v "$(NODE)" >/dev/null
	@"$(NODE)" -e 'if (+process.versions.node.split(".")[0] < 24) { console.error("Shobdokosh requires Node.js 24 or newer."); process.exit(1); }'
	@command -v "$(NPM)" >/dev/null
setup: node-check
build: setup
	"$(NPM)" run check
	@printf '%s\n' 'Ready-to-serve source and approved assets: dist/ (no compilation or publishing).'
run: setup
	"$(NODE)" server.mjs $(PORT_OPTION)
dev: run
test: setup
	"$(NPM)" test
test-imports:
	"$(UV)" run --python '>=3.10' python -m unittest discover -s tests -p 'test_import_*.py'
check: build test test-imports
