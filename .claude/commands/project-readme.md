---
description: Generate or update a portfolio-ready project README
argument-hint: <path to project directory (defaults to cwd)>
---
**Always obey `.docs/guides/mcp-tools.md`. Read it now if not already in context.**

Generate (or update) a **project README** structured for optimal AI parsing and portfolio presentation. The output follows a strict section format designed to be machine-readable by AI tools that extract project metadata (name, description, architecture, technologies, use cases, and skills).

## Target: $ARGUMENTS

If no argument was provided, use the current working directory.

---

## Instructions

### 1. Discover project details

Explore the target project thoroughly using Serena MCP tools. Gather:

- **Project name** — from `package.json` name field, repo name, or top-level directory name.
- **Short description** — one-sentence elevator pitch. Pull from `package.json` description, existing README, or infer from the code.
- **Repository URL** — from `package.json` repository field, `.git/config`, or the argument if a URL was provided.
- **Architecture** — analyze the directory structure, key files, design patterns (MVC, event-driven, serverless, monorepo, etc.), and how major components interact. Summarize in 2-4 sentences.
- **Technologies** — enumerate every language, framework, runtime, database, major library/package, and infrastructure tool used. Check `package.json` dependencies, `requirements.txt`, `go.mod`, `Cargo.toml`, Dockerfiles, CI configs, etc. Be exhaustive — each technology becomes a badge in the portfolio.
- **Use cases** — what problems does this project solve? Who is the target user? Summarize in 2-4 sentences.
- **Skills demonstrated** — infer professional skills from the codebase (see "Skills Terminology" below for formatting rules).

### 2. Generate the README

Produce a complete markdown README with **exactly** these sections in this order. Use these exact headings — they are parsed by AI tools that map each section to structured project metadata:

```markdown
# {Project Name}

{One-sentence description.}

**Repository:** {repo URL or "N/A"}

## Description

{2-3 paragraph expanded description covering what the project does, why it exists, and who it's for.}

## Architecture

{2-4 sentences on architecture patterns, component interaction, data flow. Mention design decisions.}

## Technologies

{Bulleted list of every technology, framework, library, runtime, database, and infrastructure tool. Group by category if there are many.}

## Use Cases

{Bulleted list or short paragraphs describing the problems solved and target users.}

## Skills Demonstrated

{Bulleted list of professional skills demonstrated by building this project. See "Skills Terminology" below.}
```

### 3. Skills Terminology

The "Skills Demonstrated" section is used by downstream AI tools to propose individual skills to a portfolio. To produce the best results:

- **Use Dreyfus proficiency language** — when describing depth of experience, frame skills at the appropriate level:
  - *Novice*: basic awareness, can follow instructions
  - *Advanced Beginner*: can apply in familiar contexts
  - *Competent*: independent problem-solving, solid working knowledge
  - *Proficient*: deep understanding, can mentor others
  - *Expert*: authoritative, pushes the field forward
  You do NOT need to label each skill with a level — but write descriptions that imply the appropriate depth (e.g., "Designed and optimized PostgreSQL schemas" implies Proficient+, while "Used Redis for basic caching" implies Advanced Beginner).

- **Use ATS-friendly keywords** — write skill names the way they appear on job postings and applicant tracking systems. Prefer industry-standard terms:
  - "CI/CD Pipeline Configuration" not "automated deploys"
  - "RESTful API Design" not "built endpoints"
  - "Infrastructure as Code (Terraform)" not "server setup scripts"
  - "Real-time Data Streaming (WebSockets/SSE)" not "live updates"

- **Be specific** — include the technology in the skill name when relevant: "Database Schema Design (Prisma ORM + PostgreSQL)" is better than "database skills".

### 4. Quality checks

Before writing the final README:

- **Completeness**: Every section must be filled. Do not leave any section empty or with placeholder text.
- **Accuracy**: Only include technologies and skills actually evidenced in the codebase. Do not hallucinate packages or frameworks not present.
- **Specificity**: Prefer "Next.js 15 App Router" over "React framework". Prefer "SQLite schema design with Prisma ORM" over "database skills".
- **Length**: Aim for 80-200 lines. Enough detail for AI extraction, but not so long it overwhelms.

### 5. Write the file

- **Write** the generated README to `README.md` in the target project's root directory.
- If a `README.md` already exists, read it first, then overwrite it with the new content. Show the user a brief summary of what changed.
- If no `README.md` exists, create it.
- After writing, confirm the file path and print the full content so the user can review it.

---

## Why this structure matters

This README format is designed to be **both human-readable and machine-parseable**. AI portfolio tools consume READMEs and extract structured metadata from them. Each section maps to a specific field:

| README Section | Extracted As | Purpose |
|---|---|---|
| `# {Project Name}` | Project name | Primary identifier |
| First paragraph | Short description | Elevator pitch / summary card |
| `**Repository:**` line | Repo URL | Link to source code |
| `## Description` | Full description | Detailed context for the portfolio entry |
| `## Architecture` | Architecture summary | Shows system design ability |
| `## Technologies` | Technology list | Generates technology badges and tags |
| `## Use Cases` | Use case summary | Explains real-world impact and relevance |
| `## Skills Demonstrated` | Individual skill proposals | Each bullet becomes a separate skill entry with proficiency level |

The "Skills Demonstrated" section is especially important — each bullet is proposed as an individual skill with ATS-compatible naming, making the portfolio directly useful for job applications and resume building.
