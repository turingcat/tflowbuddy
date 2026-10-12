---
kind: upgrade-guide
description: "TFlowBuddy sign-in replaces the TFlow provider configuration and removes the obsolete 9router provider."
---

# TFlowBuddy Refreshes Its Model Providers At Sign-In

English | [中文](guide.zh.md)

## Change

TFlowBuddy previously merged its gateway route into saved provider settings. Sign-in now replaces `llm-pi-ai.providers.tflow` with the current gateway configuration and model list, and removes `llm-pi-ai.providers.9router`. Custom fields on the TFlow route no longer survive sign-in. Other provider configurations and historical conversations remain unchanged.

## Migration

1. If you need an independently configured gateway, save it under a provider name other than `tflow` or `9router` in the Models settings before signing in. Those two names are reserved for the desktop account flow and obsolete route cleanup.
2. Sign in to TFlowBuddy, or restart it to restore your login. Confirm the model picker lists the current TFlow models and no 9router group.
3. Start a new conversation to use the refreshed default model. Existing conversations retain their logged model selections; change the model explicitly if an old route is no longer available.
