# Salesforce-NBA-Engine

A small, explainable **Next Best Action (NBA)** recommendation engine. Given a
customer/account profile (plan tier, engagement, churn risk, seat utilization,
support load, etc.), the engine returns a ranked list of the actions a revenue
team should take next — each with a transparent, rule-based score and the
reasons behind it.

It ships as a [FastAPI](https://fastapi.tiangolo.com/) service with a small
single-page demo UI.

## Architecture

```
app/
  models.py    # Pydantic domain models (CustomerProfile, Recommendation, ...)
  engine.py    # Rule-based scoring engine + action catalog
  data.py      # Sample customer accounts
  main.py      # FastAPI app + JSON API + demo UI
  static/      # Single-page demo UI
tests/         # pytest unit + API tests
```

## Requirements

- Python 3.12+

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Then open http://localhost:8000 for the demo UI, or explore the auto-generated
API docs at http://localhost:8000/docs.

## API

| Method | Path                                  | Description                              |
| ------ | ------------------------------------- | ---------------------------------------- |
| GET    | `/health`                             | Liveness probe.                          |
| GET    | `/api/customers`                      | List built-in sample accounts.           |
| GET    | `/api/customers/{id}/recommend`       | Recommendations for a sample account.    |
| POST   | `/api/recommend`                      | Recommendations for an ad-hoc profile.   |

Example:

```bash
curl -s http://localhost:8000/api/customers/globex/recommend | python3 -m json.tool
```

## Test

```bash
pytest
```

## Cloud Agent environment

This repository is configured for Cursor Cloud Agents via
[`.cursor/environment.json`](.cursor/environment.json): `install` creates a
virtualenv and installs pinned dependencies, and a `terminals` entry runs the
API server with reload for interactive development.
