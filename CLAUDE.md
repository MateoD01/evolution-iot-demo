# Evolution IoT Demo

Industrial telemetry and event processing MVP for PLC integration with Consuman.

## Goal

Build a demo platform capable of:

* simulating PLC industrial telemetry
* collecting telemetry signals
* persisting historical data
* processing industrial events
* visualizing telemetry and KPIs in Grafana

This MVP simulates the architecture proposed for UAA industrial integration with Consuman.

## Architecture

PLC Simulator
↓
Collector Service
↓
TimescaleDB
↓
Processor
↓
Processed Events
↓
Grafana

## Tech Stack

* Node.js
* TypeScript
* Docker Compose
* PostgreSQL
* TimescaleDB
* Grafana

## Current Scope

MVP only.

Do NOT implement:

* Kafka
* Kubernetes
* distributed messaging
* authentication systems
* enterprise microservices complexity

Focus on:

* maintainability
* observability
* modular services
* realistic telemetry
* event detection
* industrial monitoring

## Architectural Principles

* Services separated by responsibility
* Persistent local storage first
* Event-driven thinking
* Industrial telemetry patterns
* Simple and maintainable code
* Realistic industrial simulation
* Clear logging and debugging
