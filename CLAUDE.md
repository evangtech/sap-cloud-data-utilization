# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language Rules

- Match the user's language (Japanese or English) in responses
- Code comments, docstrings, error messages, and documentation must be in Japanese
- Variable/function names in English

## Project Overview

Global supply chain risk prediction system. Ingests earthquake data, runs graph-based impact analysis on Neptune Analytics, and provides a Vue 3 web UI for visualization, impact analysis, and what-if simulation.

## Architecture

Two separate deployment surfaces share the same repo:

**CDK Backend** (`infra/cdk/`) — Python CDK stacks deployed to us-west-2:
- `EarthquakeStack`: EventBridge-triggered Lambda that polls P2PQuake API, writes JSON to S3
- `NeptuneImpactAnalyzerStack`: S3-triggered Lambda that queries Neptune Analytics graph, generates impact analysis JSON, PNG graphs, and Leaflet HTML maps back to S3

**Amplify Gen2 Frontend** (`frontend/`) — Vue 3 SPA with its own serverless backend:
- AppSync GraphQL API backed by DynamoDB (schema in `frontend/amplify/data/resource.ts`)
- Three Lambda resolvers under `frontend/amplify/functions/`:
  - `neptune-query`: Direct openCypher queries against Neptune Analytics graph
  - `nl-query`: Natural language to openCypher via Bedrock (Claude)
  - `event-query`: Reads/writes to external DynamoDB `event-table`
- Pinia stores (`frontend/src/stores/`) drive simulation and supply chain state
- `frontend/src/services/api.ts` wraps all Amplify/AppSync calls

The Neptune Analytics graph (ID: `g-844qqbri1a`, us-west-2) is the shared data layer. Both CDK Lambdas and Amplify Lambdas query it via openCypher. Graph data is seeded by `scripts/load_neptune_data.py`.

## Common Commands

### Frontend (run from `frontend/`)
```bash
npm install                # install dependencies
npm run dev                # Vite dev server
npm run build              # production build
npm run type-check         # vue-tsc type checking
npm run test               # unit tests
npm run test:watch         # watch mode
npx ampx sandbox           # start Amplify sandbox (deploys backend)
```

### CDK Infrastructure (run from `infra/cdk/`)
```bash
pip install -r requirements.txt
cdk diff                   # preview changes
cdk deploy --all           # deploy all stacks
cdk destroy                # tear down
```

### Deployment Script
```bash
scripts/deploy.sh              # full deploy (7 steps)
scripts/deploy.sh --step 3     # resume from step 3
scripts/deploy.sh --only 5     # run only step 5
# Requires: scripts/env.sh configured with AWS_PROFILE, region, bucket, Neptune graph ID
```

### Neptune Data Seeding
```bash
python scripts/load_neptune_data.py   # seed graph with sample supply chain data
```

### Python Backend
```bash
pytest tests/              # run tests
mypy src/                  # type check
```

## Key Conventions

- Lambda functions (Python): `src/lambda/{feature_name}/`, handler in `__init__.py`
- CDK stacks: PascalCase names in `infra/cdk/stacks/`
- AWS resources: kebab-case names
- Python: PEP 8, type hints required, Python 3.13+
- Frontend: TypeScript strict, Vue 3 Composition API, Pinia for state

## Neptune Graph Schema

The graph models a supply chain with vertices (Supplier, Plant, Material, Product, Country, HSCode, Warehouse, Customer) connected by edges (SUPPLIES, SUPPLIES_TO, HAS_COMPONENT, PRODUCED_AT, LOCATED_IN, CLASSIFIED_AS, TARIFF_APPLIES, ALTERNATIVE_TO, ORDERED_BY). Queries use openCypher. The schema is defined implicitly by `scripts/load_neptune_data.py` and queried in `frontend/amplify/functions/neptune-query/handler.ts`.

## S3 Bucket Layout

```
s3://supply-chain-earthquake-data-{account}/
├── earthquakes/          # raw earthquake JSON (year=/month= partitions)
├── impact-analysis/      # analysis JSON + impact graph PNGs
├── maps/                 # Leaflet.js interactive HTML maps
└── lambda-layers/        # matplotlib, networkx layers
```
