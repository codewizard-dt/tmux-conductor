---
id: ROADMAP-009
title: Mobile & remote access — PWA, push notifications, voice input, share links
status: active
created: 2026-06-13
updated: 2026-06-13
owner: David Taylor
linked_requirements: []
linked_decisions: []
tags: [mobile, pwa, notifications, voice]
---

# Roadmap 009: Mobile & remote access — PWA, push notifications, voice input, share links

## Goal

Make the conductor dashboard fully usable from a phone — as a PWA that can be added to the home screen, receive background push notifications, accept voice dictation, and share read-only agent views with collaborators. Depends on ROADMAP-002 portal relay being deployed (provides the remote HTTPS endpoint the PWA connects to).

## Phase 1: PWA Foundation

- [ ] Audit and fix the agent card grid layout at 390px viewport
- [ ] Fix LogTail scroll area behaviour when the mobile keyboard is visible
- [ ] Fix task form inputs for mobile touch and on-screen keyboard
- [ ] Add `manifest.webmanifest` with icons, `display: standalone`, and theme colour
- [ ] Add service worker (app-shell caching) and verify "Add to Home Screen" on iOS Safari and Android Chrome

## Phase 2: Push Notifications

- [ ] Generate VAPID key pair and store in portal env config
- [ ] Add `push_subscriptions` table to Postgres (`device_id`, `subscription_json`, `created_at`)
- [ ] Add `POST /api/push/subscribe` and `DELETE /api/push/subscribe` endpoints in the portal
- [ ] Implement Web Push permission prompt and subscription flow in the dashboard frontend
- [ ] Fire push notifications on SSE events: task dispatched, agent waiting, agent stalled, schedule fired

## Phase 3: Voice & Sharing

- [ ] Add mic button to the Direct Input area in LogTail using the browser `SpeechRecognition` API
- [ ] Transcribed text populates the Direct Input field for user review before sending
- [ ] Add optional backend `POST /api/transcribe` routing to OpenAI Whisper for non-Chrome browsers
- [ ] Add `share_tokens` table to Postgres (`token` UUID, `device_id`, `agent_id`, `expires_at`)
- [ ] Add `POST /api/agents/:agent/share` to generate a time-limited (24 h default) share token
- [ ] Add `GET /relay/:deviceId/shared/:token` on the portal to serve read-only terminal output (no input relay)
- [ ] Add "Share" button on agent card that generates a share URL and copies it to clipboard

## Notes
