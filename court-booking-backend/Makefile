.PHONY: install dev up down migrate makemigrations test test-concurrency lint fmt seed

install:
	pip install -e ".[dev]"

up:
	docker-compose up -d

down:
	docker-compose down

dev:
	uvicorn app.main:app --reload

migrate:
	alembic upgrade head

makemigrations:
	alembic revision --autogenerate -m "$(m)"

test:
	pytest -v --tb=short

test-concurrency:
	pytest tests/test_concurrency.py -v --tb=long

lint:
	ruff check app tests
	mypy app

fmt:
	ruff format app tests

seed:
	python -m app.seed
