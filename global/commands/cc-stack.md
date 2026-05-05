---
description: "(Conductor) Detect project stack and load the matching profile"
---

Detect the project stack by scanning for manifest files in the current directory:

- `package.json` → Node.js/JavaScript/TypeScript
- `pom.xml` or `build.gradle` → Java
- `go.mod` → Go
- `requirements.txt` or `pyproject.toml` → Python
- `Cargo.toml` → Rust
- `*.csproj` → C#/.NET
- `composer.json` → PHP
- `Gemfile` → Ruby
- `pubspec.yaml` → Dart/Flutter

**Infer framework from dependency contents**, not just file existence:
- `package.json`: check for react, next, angular, vue, nest, express, etc.
- `requirements.txt` / `pyproject.toml`: check for django, flask, fastapi
- `pom.xml`: check for spring-boot, quarkus

**If stack is already in `.claude/memory/project.md`:**
Load from there. Ask: "I see you're using [stack]. Has anything changed?"

**If multiple languages detected:**
Load `_multi-stack.md` as coordinator first, then each language/framework profile.

**Before loading any profile:**
List detected stack(s) and confirm: "I'll load the [profile] profile. Proceed?"

**Available profiles:** javascript, typescript, python, java, go, rust, react, angular, nextjs, nestjs, django, flask
