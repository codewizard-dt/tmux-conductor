---
name: typecheck
description: Run strict-typecheck, fix the first error, repeat until clean
model: claude-sonnet-4-6
disable-model-invocation: false
user-invocable: true
---

# Run strict-typecheck and fix issues

IMPORTANT: Adhere to all rules in `.docs/guides/mcp-tools.md` if it exists.

## Step 1: find the problem

Run `make strict-typecheck 2>&1 | head -20`

If there are no errors, this task is done.

## Step 2: assess the problem

- Analyze the output for only the **first** error reported
- Use Serena to read the relevant code symbols where the error occurs
- Understand the root cause: type annotation issue, import problem, or genuine type mismatch?
- Use Context7 or Brave Search if you need more detail on the error

## Step 3: fix the root cause

- Fix the root cause of the first error using Serena's symbolic editing tools
- Re-run `make strict-typecheck 2>&1 | head -20` to verify the fix

## Step 4: repeat, one error at a time

- Repeat steps 1–3 until the output is empty
- Do not keep a to-do list of separate errors — just run the command again to get the next one