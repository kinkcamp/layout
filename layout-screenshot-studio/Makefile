.PHONY: install dev-backend dev-frontend test build docker-up docker-down

install:
	python3 -m venv .venv
	.venv/bin/pip install -r backend/requirements.txt
	npm --prefix frontend ci

dev-backend:
	PYTHONPATH=backend:. .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

dev-frontend:
	npm --prefix frontend run dev

test:
	PYTHONPATH=backend:. .venv/bin/python -m pytest backend/tests -q

build:
	npm --prefix frontend run build

docker-up:
	docker compose --env-file .env up --build -d

docker-down:
	docker compose down
