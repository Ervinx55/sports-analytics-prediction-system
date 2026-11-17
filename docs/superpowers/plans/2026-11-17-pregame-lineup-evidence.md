# Pregame Lineup Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Capture actual official pregame evidence without treating projections, injury reports, or inactives as confirmed starters.

**Architecture:** A bounded collector returns immutable raw-source documents and event-scoped normalized observations. Pure source parsers enforce identity and chronology. The existing lineup normalizer admits one narrowly identified official receipt contract, with no model changes.

**Tech Stack:** Existing Node ESM, node:test, native fetch, SHA-256.

**Spec:** docs/evaluations/winner-collection-repair-2026-11-17/pregame-lineup-adapter.md

## Global Constraints

- No database writes or deployment in this subtask.
- Exact official game/team/kickoff mapping and receipt before start.
- Expected never confirms; gameStatus live/final never confirms; coefficients unchanged.
- Retain timezone-less player timestamps verbatim; publishedAt remains null.
- NFL inactive-name lists never imply an all-active roster or starting lineup.

## Review Focus

- Confirmed bench rows have no starter position and must not increase the starter count.
- An old or postgame response cannot gain a new pregame timestamp.
- Duplicate source identities, player IDs, or starter positions fail closed.
- NFL articles for another week/date cannot attach to an upcoming event.
- Network failures remain explicit unavailability and do not erase other valid observations.

## Tasks

- [x] Add recorded-format fixture facts and failing tests in tests/node/winner-lineup-evidence.test.mjs for NBA expected/confirmed identities, time, duplicates, injuries, and NFL inactive lists.
- [x] Implement sharp-service/lib/winner-lineup-evidence.js pure parsing plus bounded collector and rerun focused tests.
- [x] Extend only normalizeLineupEvidence in winner-capture-policy.js for the official receipt contract; test unknown publication time remains null and source hashes are retained.
- [x] Run combined lineup/policy tests, inspect current raw feeds through the parsers, and send the module contract and evidence to root for handler integration and independent review. Handler integration was subsequently authorized and completed with a source-archive/input regression; root owns deployment.
