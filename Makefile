SUPABASE ?= /opt/homebrew/bin/supabase
BUN      ?= $(HOME)/.bun/bin/bun

.PHONY: help \
        dev app-dev app-install app-typecheck app-build \
        bot-dev bot-install \
        engine-dev engine-install \
        sb-start sb-stop sb-status sb-reset sb-diff sb-seed \
        sb-migrate sb-migration sb-types sb-fn-serve sb-fn-deploy \
        deploy lint

help:
	@echo ""
	@echo "  Artisan — available targets"
	@echo ""
	@echo "  App (Next.js)"
	@echo "    app-install      Install app dependencies"
	@echo "    app-dev          Start Next.js dev server (port 3000)"
	@echo "    app-typecheck    TypeScript type-check"
	@echo "    app-build        Production build"
	@echo ""
	@echo "  Bot (Telegram)"
	@echo "    bot-install      Install bot dependencies"
	@echo "    bot-dev          Start Telegram bot (watches for changes)"
	@echo ""
	@echo "  Engine (trading)"
	@echo "    engine-install   Install engine dependencies"
	@echo "    engine-dev       Start trading engine (paper mode)"
	@echo ""
	@echo "  Supabase (local)"
	@echo "    sb-start         Start local Supabase stack"
	@echo "    sb-stop          Stop local Supabase stack"
	@echo "    sb-reset         Reset local DB (migrations + seed)"
	@echo "    sb-seed          Re-run seed only"
	@echo "    sb-diff          Diff local schema vs migrations"
	@echo "    sb-migration name=<name>   Create new migration file"
	@echo ""
	@echo "  Supabase (remote)"
	@echo "    sb-migrate       Push pending migrations to remote"
	@echo "    sb-types         Generate TypeScript types from remote"
	@echo "    sb-fn-serve      Serve edge functions locally"
	@echo "    sb-fn-deploy     Deploy all edge functions to remote"
	@echo ""
	@echo "  Top-level"
	@echo "    dev              sb-start + app-dev"
	@echo "    deploy           sb-migrate + sb-fn-deploy"
	@echo "    lint             Run type-check across all workspaces"
	@echo ""

# ── App ───────────────────────────────────────────────────────────────────────

app-install:
	cd app && $(BUN) install

app-dev:
	cd app && $(BUN) run dev

app-typecheck:
	cd app && $(BUN) tsc --noEmit

app-build:
	cd app && $(BUN) run build

# ── Bot ───────────────────────────────────────────────────────────────────────

bot-install:
	cd bot && $(BUN) install

bot-dev:
	cd bot && $(BUN) --watch src/index.ts

# ── Engine ────────────────────────────────────────────────────────────────────

engine-install:
	cd engine && $(BUN) install

engine-dev:
	cd engine && PAPER_TRADING=true $(BUN) --watch src/main.ts

# ── Supabase local ────────────────────────────────────────────────────────────

sb-start:
	$(SUPABASE) start

sb-stop:
	$(SUPABASE) stop

sb-status:
	$(SUPABASE) status

sb-reset:
	$(SUPABASE) db reset

sb-seed:
	$(SUPABASE) db reset --no-migrate

sb-diff:
	$(SUPABASE) db diff

sb-migration:
ifndef name
	$(error Usage: make sb-migration name=<migration_name>)
endif
	$(SUPABASE) migration new $(name)

# ── Supabase remote ───────────────────────────────────────────────────────────

sb-migrate:
	$(SUPABASE) db push

sb-types:
	$(SUPABASE) gen types typescript --linked > supabase/types.ts
	@echo "Types written to supabase/types.ts"

sb-fn-serve:
	$(SUPABASE) functions serve

sb-fn-deploy:
	$(SUPABASE) functions deploy

# ── Orchestration ─────────────────────────────────────────────────────────────

dev: sb-start app-dev

deploy: sb-migrate sb-fn-deploy
	@echo "Remote deploy complete."

lint:
	cd app && $(BUN) tsc --noEmit
	cd bot && $(BUN) tsc --noEmit
	cd engine && $(BUN) tsc --noEmit
