---
id: ROADMAP-011
title: Multi-user team accounts — organisations, memberships, and RBAC
status: active
created: 2026-06-13
updated: 2026-06-13
owner: David Taylor
linked_requirements: []
linked_decisions: []
tags: [team, multi-user, rbac]
---

# Roadmap 011: Multi-user team accounts — organisations, memberships, and RBAC

## Goal

Allow multiple team members to share a portal organisation with role-based access control over devices and agents, so conductor can be used by a whole engineering team rather than a single developer. Depends on ROADMAP-002 portal foundation (users, devices, JWT sessions) being deployed.

## Phase 1: Schema & Organisation

- [ ] Add `organisations` table to Postgres (`id` uuid pk, `name`, `created_at`)
- [ ] Add `memberships` table (`org_id`, `user_id`, `role` enum, `invited_at`, `accepted_at`)
- [ ] Add organisation creation flow in the portal UI (post-login onboarding step for new users)
- [ ] Add member invitation flow: generate invite token, display shareable link, allowlist-gate acceptance

## Phase 2: Access Control

- [ ] Implement RBAC: viewer (read terminal + status), operator (send tasks + interact), admin (full device + member management)
- [ ] Scope device and agent visibility to org membership in all `/api/devices` and relay endpoints
- [ ] Add org settings page: member list with roles, invite management, remove member, transfer ownership
- [ ] Add org context indicator to the portal dashboard header (org name + current user role)

## Notes
