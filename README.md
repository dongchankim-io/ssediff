# ssediff

### High-performance, real-time visual diffing for Server-Sent Events (SSE) streams.

[![Docker](https://img.shields.io/badge/docker-stably--built-blue.svg)](https://json.org)
[![Go Version](https://img.shields.io/badge/go-1.24-blue.svg)](https://golang.org)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Traditional API diffing tools expect static payloads and fail when testing continuous, asynchronous data streams. **ssediff** bridges this gap. It is a standalone, production-ready developer utility designed to ingest, temporally align, and perform granular 1-to-1 structural diffs on live SSE streams without blocking your data pipelines or blowing up your RAM.

## Key Architecture Pillars

* **⚡ Blazing Fast Go Engine:** Leverages Go's native multi-threaded concurrency model (goroutines) to ingest multiple high-throughput API streams simultaneously across separate CPU threads.
* **🧠 Zero-Allocation ID Extraction:** Utilizes `gjson` to execute dynamic path extraction directly on raw byte streams, entirely avoiding generic, heavy JSON unmarshaling into maps.
* **🛡️ Anti-Memory Leak Infrastructure:** Implements a proactive background eviction ticker that safely clears stale unmatched events via a strict Time-To-Live (TTL) configuration, keeping the host container light and stateless.
* **🎨 Interactive Visual Diff Terminal:** A modern React + Tailwind web UI that maps incoming stream statuses (`MATCH`, `MISMATCH`, `ORPHAN`) in real-time, featuring a clean side-by-side git-style code diff viewer.
* **🐋 Zero-Friction Single Container:** Built as an ultra-lightweight multi-stage Docker image (~35MB). The compiled static Go binary serves the compiled React assets natively on a single exposed port—no external proxies or complex web servers required.
